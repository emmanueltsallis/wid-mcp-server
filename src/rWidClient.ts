import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { METRIC_DEFINITIONS } from "./constants.js";
import {
  candidateIndicatorsForQuery,
  isExactVariableCode,
  metricDefinitionFromCandidate,
  metricDefinitionFromVariableCode,
  metricResolutionErrorMessage,
  rankMetricCandidates,
  resolveRankedMetricCandidates
} from "./metricResolver.js";
import {
  normalizeCountry,
  resolveMetric as resolveBuiltInMetric
} from "./widClient.js";
import {
  availableVariablesToFallbackCandidates,
  buildSeriesFallback,
  sameConceptFallbackCandidates
} from "./seriesFallback.js";
import type {
  FetchDataInput,
  GetMetadataInput,
  GetSeriesInput,
  ListVariablesInput,
  MetricCandidate,
  MetricDefinition,
  MetricResolveResult,
  PaginatedResult,
  ResolveMetricInput,
  SearchMetricsInput,
  WidAvailableVariable,
  WidDataProvider,
  WidDataRow,
  WidMetadataRecord,
  WidSeriesResult
} from "./types.js";

const execFileAsync = promisify(execFile);

type RunRScript = (script: string, inputJson: string, rscriptBin: string) => Promise<string>;

interface RwidClientOptions {
  rscriptBin?: string;
  runRScript?: RunRScript;
}

interface RBridgeResponse {
  rows?: unknown;
  metadata?: unknown;
  items?: unknown;
}

export class RwidClient implements WidDataProvider {
  private readonly rscriptBin: string;
  private readonly runRScript: RunRScript;

  constructor(options: RwidClientOptions = {}) {
    this.rscriptBin =
      options.rscriptBin ?? process.env.WID_RSCRIPT_BIN?.trim() ?? "Rscript";
    this.runRScript = options.runRScript ?? defaultRunRScript;
  }

  async getSeries(input: GetSeriesInput): Promise<WidSeriesResult> {
    const country = normalizeCountry(input.country);
    let { metric, resolution } = await this.resolveSeriesMetric(
      country,
      input.metric,
      input.context,
      input.assumptionPolicy
    );
    const response = await this.downloadSeries(
      country,
      metric.variableCode,
      input.includeExtrapolations
    );

    let rows = parseRDownloadRows(response.rows, {
      startYear: input.startYear,
      endYear: input.endYear
    });
    let metadata = parseRMetadataRows(response.metadata);
    let fallback;

    if (rows.length === 0) {
      const fallbackResult = await this.tryNoRowsFallback({
        country,
        metric,
        metricInput: input.metric,
        resolution,
        startYear: input.startYear,
        endYear: input.endYear,
        includeExtrapolations: input.includeExtrapolations
      });
      if (fallbackResult) {
        metric = fallbackResult.metric;
        rows = fallbackResult.rows;
        metadata = fallbackResult.metadata;
        fallback = fallbackResult.fallback;
      }
    }

    const data = paginate(rows, input.limit, input.offset);

    return {
      metric,
      ...(resolution ? { resolution } : {}),
      ...(fallback ? { fallback } : {}),
      country,
      data: { ...data, rows: data.items },
      metadata
    };
  }

  private async downloadSeries(
    country: string,
    variableCode: string,
    includeExtrapolations: boolean | undefined
  ): Promise<RBridgeResponse> {
    return this.runBridge({
      action: "download",
      countries: [country],
      variable_codes: [variableCode],
      include_extrapolations: includeExtrapolations ?? true,
      metadata: true
    });
  }

  async fetchData(
    input: FetchDataInput
  ): Promise<PaginatedResult<WidDataRow> & { rows: WidDataRow[] }> {
    const response = await this.runBridge({
      action: "download",
      countries: input.countries.map(normalizeCountry),
      variable_codes: input.variableCodes,
      include_extrapolations: input.includeExtrapolations ?? true,
      metadata: false
    });
    const rows = parseRDownloadRows(response.rows, {
      startYear: input.startYear,
      endYear: input.endYear
    });
    const data = paginate(rows, input.limit, input.offset);
    return { ...data, rows: data.items };
  }

  async getMetadata(
    input: GetMetadataInput
  ): Promise<PaginatedResult<WidMetadataRecord> & { records: WidMetadataRecord[] }> {
    const response = await this.runBridge({
      action: "metadata",
      countries: input.countries.map(normalizeCountry),
      variable_codes: input.variableCodes,
      include_extrapolations: true,
      metadata: true
    });
    const records = parseRMetadataRows(response.metadata);
    const data = paginate(records, input.limit, input.offset);
    return { ...data, records: data.items };
  }

  async searchMetrics(input: SearchMetricsInput): Promise<PaginatedResult<MetricCandidate>> {
    const country = normalizeCountry(input.country);
    const variables = await this.fetchAvailableVariables(
      [country],
      candidateIndicatorsForQuery(input)
    );
    const firstPass = rankMetricCandidates({
      ...input,
      country,
      availableVariables: variables,
      limit: input.assumptionPolicy === "wid_default" ? 3 : 8,
      offset: 0
    });
    const variableCodes = unique(firstPass.items.map((candidate) => candidate.variableCode));
    const metadata =
      variableCodes.length > 0
        ? (
            await this.getMetadata({
              countries: [country],
              variableCodes,
              limit: 1000,
              offset: 0
            })
          ).records
        : [];

    return rankMetricCandidates({
      ...input,
      country,
      availableVariables: variables,
      metadata
    });
  }

  async resolveMetric(input: ResolveMetricInput): Promise<MetricResolveResult> {
    const country = normalizeCountry(input.country);
    const candidates = await this.searchMetrics({
      ...input,
      country,
      limit: Math.max(input.limit ?? 10, 10),
      offset: 0
    });

    return resolveRankedMetricCandidates({
      country,
      query: input.query,
      context: input.context,
      candidates: candidates.items,
      assumptionPolicy: input.assumptionPolicy,
      confidenceThreshold: input.confidenceThreshold
    });
  }

  async listAvailableVariables(
    input: ListVariablesInput
  ): Promise<PaginatedResult<WidAvailableVariable>> {
    const items = await this.fetchAvailableVariables(
      input.countries.map(normalizeCountry),
      input.indicators
    );
    return paginate(items, input.limit, input.offset);
  }

  private async resolveSeriesMetric(
    country: string,
    metricInput: string,
    context: GetSeriesInput["context"],
    assumptionPolicy: GetSeriesInput["assumptionPolicy"]
  ): Promise<{ metric: MetricDefinition; resolution?: MetricResolveResult }> {
    const trimmed = metricInput.trim();
    if (isExactVariableCode(trimmed)) {
      return { metric: metricDefinitionFromVariableCode(trimmed.toLowerCase()) };
    }

    try {
      return { metric: resolveBuiltInMetric(metricInput) };
    } catch {
      const resolution = await this.resolveMetric({
        country,
        query: metricInput,
        context,
        assumptionPolicy,
        limit: 10,
        offset: 0
      });
      if (resolution.status !== "resolved" || !resolution.selected) {
        throw new Error(metricResolutionErrorMessage(resolution));
      }
      return {
        metric: metricDefinitionFromCandidate(resolution.selected, metricInput),
        resolution
      };
    }
  }

  private async tryNoRowsFallback(input: {
    country: string;
    metric: MetricDefinition;
    metricInput: string;
    resolution?: MetricResolveResult;
    startYear?: number;
    endYear?: number;
    includeExtrapolations?: boolean;
  }): Promise<
    | {
        metric: MetricDefinition;
        rows: WidDataRow[];
        metadata: WidMetadataRecord[];
        fallback: WidSeriesResult["fallback"];
      }
    | undefined
  > {
    const resolutionCandidates = sameConceptFallbackCandidates(
      input.metric.variableCode,
      input.resolution?.candidates ?? []
    );
    const fromResolution = await this.tryFallbackCandidates(input, resolutionCandidates);
    if (fromResolution) {
      return fromResolution;
    }

    const variables = await this.fetchAvailableVariables(
      [input.country],
      [input.metric.indicator]
    );
    return this.tryFallbackCandidates(
      input,
      availableVariablesToFallbackCandidates(input.metric.variableCode, variables)
    );
  }

  private async tryFallbackCandidates(
    input: {
      country: string;
      metric: MetricDefinition;
      metricInput: string;
      startYear?: number;
      endYear?: number;
      includeExtrapolations?: boolean;
    },
    candidates: MetricCandidate[]
  ): Promise<
    | {
        metric: MetricDefinition;
        rows: WidDataRow[];
        metadata: WidMetadataRecord[];
        fallback: WidSeriesResult["fallback"];
      }
    | undefined
  > {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.variableCode)) {
        continue;
      }
      seen.add(candidate.variableCode);

      const response = await this.downloadSeries(
        input.country,
        candidate.variableCode,
        input.includeExtrapolations
      );
      const rows = parseRDownloadRows(response.rows, {
        startYear: input.startYear,
        endYear: input.endYear
      });
      if (rows.length === 0) {
        continue;
      }

      return {
        metric: metricDefinitionFromCandidate(candidate, input.metricInput),
        rows,
        metadata: parseRMetadataRows(response.metadata),
        fallback: buildSeriesFallback(
          input.metric.variableCode,
          candidate.variableCode
        )
      };
    }

    return undefined;
  }

  private async fetchAvailableVariables(
    countries: string[],
    indicators: string[]
  ): Promise<WidAvailableVariable[]> {
    const response = await this.runBridge({
      action: "available_variables",
      countries,
      indicators
    });
    return parseRAvailableVariables(response.items);
  }

  private async runBridge(input: Record<string, unknown>): Promise<RBridgeResponse> {
    const stdout = await this.runRScript(
      R_BRIDGE_SCRIPT,
      JSON.stringify(input),
      this.rscriptBin
    );
    const jsonPayload = extractJsonPayload(stdout);
    if (!jsonPayload) {
      throw new Error("R WID backend returned no output.");
    }

    try {
      return JSON.parse(jsonPayload) as RBridgeResponse;
    } catch (error) {
      throw new Error(
        `R WID backend returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

function extractJsonPayload(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return trimmed;
  }
  return trimmed.slice(start, end + 1);
}

export function parseRDownloadRows(
  payload: unknown,
  options: { startYear?: number; endYear?: number } = {}
): WidDataRow[] {
  const rows = toArray(payload).flatMap((row) => {
    if (!isRecord(row)) {
      return [];
    }
    const variableCode = stringValue(row.variable_code);
    const country = stringValue(row.country);
    const year = numberValue(row.year);
    const value = numberValue(row.value);
    if (!variableCode || !country || year === undefined || value === undefined) {
      return [];
    }
    if (options.startYear !== undefined && year < options.startYear) {
      return [];
    }
    if (options.endYear !== undefined && year > options.endYear) {
      return [];
    }
    const codeParts = splitVariableCode(variableCode);
    const unit = stringValue(row.unit);
    return [
      {
        country,
        variableCode,
        indicator: stringValue(row.indicator) ?? codeParts.indicator,
        percentile: stringValue(row.percentile) ?? codeParts.percentile,
        age: stringValue(row.age_code) ?? codeParts.age,
        population: stringValue(row.pop_code) ?? codeParts.population,
        year,
        value,
        ...(unit ? { unit } : {}),
        isExtrapolated: booleanValue(row.is_extrapolated) ?? false
      }
    ];
  });

  return rows.sort((a, b) => {
    const countrySort = a.country.localeCompare(b.country);
    if (countrySort !== 0) return countrySort;
    const variableSort = a.variableCode.localeCompare(b.variableCode);
    if (variableSort !== 0) return variableSort;
    return a.year - b.year;
  });
}

export function parseRMetadataRows(payload: unknown): WidMetadataRecord[] {
  const seen = new Set<string>();
  const records: WidMetadataRecord[] = [];

  for (const row of toArray(payload)) {
    if (!isRecord(row)) {
      continue;
    }
    const variableCode = stringValue(row.variable_code);
    const country = stringValue(row.country);
    if (!variableCode || !country) {
      continue;
    }
    const key = `${variableCode}:${country}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    records.push({
      variableCode,
      country,
      ...(stringValue(row.countryname)
        ? { countryName: stringValue(row.countryname) }
        : {}),
      ...(stringValue(row.shortname)
        ? { shortName: stringValue(row.shortname) }
        : {}),
      ...(stringValue(row.shortdes)
        ? { shortDescription: stringValue(row.shortdes) }
        : {}),
      ...(stringValue(row.technicaldes)
        ? { technicalDescription: stringValue(row.technicaldes) }
        : {}),
      ...(stringValue(row.shorttype) ? { type: stringValue(row.shorttype) } : {}),
      ...(stringValue(row.longtype)
        ? { typeDescription: stringValue(row.longtype) }
        : {}),
      ...(stringValue(row.pop) ? { population: stringValue(row.pop) } : {}),
      ...(stringValue(row.age) ? { age: stringValue(row.age) } : {}),
      ...(stringValue(row.unit) ? { unit: stringValue(row.unit) } : {}),
      ...(stringValue(row.source) ? { source: stringValue(row.source) } : {}),
      ...(stringValue(row.imputation)
        ? { imputation: stringValue(row.imputation) }
        : {}),
      ...(stringValue(row.quality) ? { quality: stringValue(row.quality) } : {}),
      ...(stringValue(row.method) ? { method: stringValue(row.method) } : {})
    });
  }

  return records.sort((a, b) => {
    const variableSort = a.variableCode.localeCompare(b.variableCode);
    if (variableSort !== 0) return variableSort;
    return a.country.localeCompare(b.country);
  });
}

function parseRAvailableVariables(payload: unknown): WidAvailableVariable[] {
  return toArray(payload)
    .flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const indicator = stringValue(item.indicator);
      const country = stringValue(item.country);
      const percentile = stringValue(item.percentile);
      const age = stringValue(item.age);
      const population = stringValue(item.population);
      const variableCode =
        stringValue(item.variableCode) ??
        (indicator && percentile && age && population
          ? `${indicator}_${percentile}_${age}_${population}`
          : undefined);
      if (!indicator || !country || !percentile || !age || !population || !variableCode) {
        return [];
      }
      return [{ indicator, country, percentile, age, population, variableCode }];
    })
    .sort((a, b) => a.variableCode.localeCompare(b.variableCode));
}

async function defaultRunRScript(
  script: string,
  inputJson: string,
  rscriptBin: string
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(rscriptBin, ["-e", script, inputJson], {
      maxBuffer: 20 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to run the R WID backend. Install R and the wid package with install.packages("wid"), or configure WID_API_KEY_BASE64 for direct API mode. Details: ${message}`
    );
  }
}

function paginate<T>(
  items: T[],
  requestedLimit: number | undefined,
  requestedOffset: number | undefined
): PaginatedResult<T> {
  const offset = Math.max(0, requestedOffset ?? 0);
  const limit = Math.min(Math.max(1, requestedLimit ?? 100), 1000);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    total: items.length,
    count: pageItems.length,
    offset,
    items: pageItems,
    hasMore: nextOffset < items.length,
    ...(nextOffset < items.length ? { nextOffset } : {})
  };
}

function splitVariableCode(variableCode: string): {
  indicator: string;
  percentile: string;
  age: string;
  population: string;
} {
  const [indicator = "", percentile = "", age = "", population = ""] =
    variableCode.split("_");
  return { indicator, percentile, age, population };
}

function toArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

const R_BRIDGE_SCRIPT = String.raw`
suppressPackageStartupMessages({
  library(wid)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
input <- jsonlite::fromJSON(args[[1]], simplifyVector = FALSE)

split_code <- function(code) {
  strsplit(code, "_", fixed = TRUE)[[1]]
}

empty_frame <- function() {
  data.frame(stringsAsFactors = FALSE)
}

download_code <- function(code, metadata) {
  parts <- split_code(code)
  if (length(parts) != 4) {
    stop(paste("Invalid WID variable code:", code))
  }
  result <- wid::download_wid(
    indicators = parts[[1]],
    areas = unlist(input$countries),
    years = "all",
    perc = parts[[2]],
    ages = parts[[3]],
    pop = parts[[4]],
    metadata = metadata,
    include_extrapolations = isTRUE(input$include_extrapolations),
    verbose = FALSE
  )
  if (is.null(result) || nrow(result) == 0) {
    return(empty_frame())
  }
  result$variable_code <- code
  result$indicator <- parts[[1]]
  result$age_code <- parts[[3]]
  result$pop_code <- parts[[4]]
  result$is_extrapolated <- FALSE
  result
}

download_all <- function(metadata) {
  frames <- lapply(unlist(input$variable_codes), download_code, metadata = metadata)
  frames <- frames[vapply(frames, nrow, integer(1)) > 0]
  if (length(frames) == 0) {
    return(empty_frame())
  }
  do.call(rbind, frames)
}

metadata_from_rows <- function(rows) {
  if (is.null(rows) || nrow(rows) == 0) {
    return(empty_frame())
  }
  keep <- intersect(
    c("country", "countryname", "variable_code", "shortname", "shortdes", "pop", "age", "source", "imputation", "quality", "method"),
    names(rows)
  )
  unique(rows[, keep, drop = FALSE])
}

bind_frames_fill <- function(frames) {
  frames <- frames[!vapply(frames, is.null, logical(1))]
  frames <- frames[vapply(frames, nrow, integer(1)) > 0]
  if (length(frames) == 0) {
    return(empty_frame())
  }
  cols <- unique(unlist(lapply(frames, names), use.names = FALSE))
  normalized <- lapply(frames, function(frame) {
    missing <- setdiff(cols, names(frame))
    for (column in missing) {
      frame[[column]] <- NA
    }
    frame[, cols, drop = FALSE]
  })
  do.call(rbind, normalized)
}

metadata_variables <- function() {
  frames <- lapply(unlist(input$variable_codes), function(variable_code) {
    result <- wid:::get_metadata_variables(
      unlist(input$countries),
      variable_code,
      report_missing = FALSE
    )
    table <- result$response_table
    if (is.null(table) || nrow(table) == 0) {
      return(empty_frame())
    }
    names(table)[names(table) == "variable"] <- "variable_code"
    table
  })
  bind_frames_fill(frames)
}

available_variables <- function() {
  frames <- list()
  for (indicator in unlist(input$indicators)) {
    table <- wid:::get_variables_areas(unlist(input$countries), indicator)
    if (!is.null(table) && nrow(table) > 0) {
      names(table)[names(table) == "variable"] <- "indicator"
      names(table)[names(table) == "pop"] <- "population"
      table$variableCode <- paste(table$indicator, table$percentile, table$age, table$population, sep = "_")
      frames[[length(frames) + 1]] <- table[, c("indicator", "country", "percentile", "age", "population", "variableCode")]
    }
  }
  bind_frames_fill(frames)
}

if (identical(input$action, "available_variables")) {
  output <- list(items = available_variables())
} else if (identical(input$action, "metadata")) {
  output <- list(metadata = metadata_variables())
} else if (identical(input$action, "download")) {
  rows <- download_all(isTRUE(input$metadata))
  output <- list(rows = rows, metadata = if (isTRUE(input$metadata)) metadata_from_rows(rows) else empty_frame())
} else {
  stop(paste("Unsupported action:", input$action))
}

cat(jsonlite::toJSON(output, dataframe = "rows", auto_unbox = TRUE, na = "null", null = "null"))
`;

export const BUILT_IN_R_METRICS = METRIC_DEFINITIONS;
