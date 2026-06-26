import {
  COUNTRY_ALIASES,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  METRIC_DEFINITIONS,
  WID_API_BASE_URL
} from "./constants.js";
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

type FetchFn = typeof fetch;

interface WidClientOptions {
  apiKeyBase64?: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetchFn?: FetchFn;
  env?: Record<string, string | undefined>;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export function createApiKeyHeader(
  env: Record<string, string | undefined> = process.env
): string {
  const base64 = env.WID_API_KEY_BASE64?.trim();
  if (base64) {
    return base64;
  }

  const hex = env.WID_API_KEY_HEX?.trim();
  if (hex) {
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error("WID_API_KEY_HEX must be an even-length hex string.");
    }
    return Buffer.from(hex, "hex").toString("base64");
  }

  throw new Error(
    "Missing WID API credential. Set WID_API_KEY_BASE64, or set WID_API_KEY_HEX if you extracted the official WID key as hex."
  );
}

export function normalizeCountry(country: string): string {
  const trimmed = country.trim();
  if (/^[A-Za-z]{2}(-[A-Za-z]{2,3})?$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
  const alias = COUNTRY_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  throw new Error(
    `Unknown country "${country}". Use a WID/ISO country code such as BR, FR, US, or add a supported country alias.`
  );
}

export function resolveMetric(metric: string): MetricDefinition {
  const normalized = metric.trim().toLowerCase().replace(/\s+/g, " ");
  const match = METRIC_DEFINITIONS.find(
    (definition) =>
      definition.id === normalized ||
      definition.aliases.some((alias) => alias.toLowerCase() === normalized)
  );

  if (!match) {
    throw new Error(
      `Unknown metric "${metric}". Supported metrics: ${METRIC_DEFINITIONS.map((definition) => definition.id).join(", ")}. Use wid_search_indicators for exact WID codes.`
    );
  }

  return match;
}

export function parseWidDataResponse(
  payload: unknown,
  options: {
    startYear?: number;
    endYear?: number;
    includeExtrapolations?: boolean;
  } = {}
): WidDataRow[] {
  const response = unwrapSingleton(payload);
  if (!isRecord(response)) {
    throw new Error("WID data response was not an object.");
  }

  const rows: WidDataRow[] = [];
  for (const [variableCode, countryPayload] of Object.entries(response)) {
    const entries = normalizeCountryEntries(countryPayload);
    for (const [country, series] of entries) {
      if (!isRecord(series)) {
        continue;
      }
      const meta = isRecord(series.meta) ? series.meta : {};
      const unit = stringValue(meta.unit);
      const extrapolationRanges = parseExtrapolationRanges(meta.extrapolation);
      const dataPointYears = parseDataPointYears(meta.data_points);
      const values = Array.isArray(series.values) ? series.values : [];

      for (const valueEntry of values) {
        const parsed = parseValueEntry(valueEntry);
        if (!parsed) {
          continue;
        }
        const { year, value } = parsed;
        if (options.startYear !== undefined && year < options.startYear) {
          continue;
        }
        if (options.endYear !== undefined && year > options.endYear) {
          continue;
        }

        const isExtrapolated = isYearExtrapolated(
          year,
          extrapolationRanges,
          dataPointYears
        );
        if (options.includeExtrapolations === false && isExtrapolated) {
          continue;
        }

        const codeParts = splitVariableCode(variableCode);
        rows.push({
          country,
          variableCode,
          indicator: codeParts.indicator,
          percentile: codeParts.percentile,
          age: codeParts.age,
          population: codeParts.population,
          year,
          value,
          ...(unit ? { unit } : {}),
          isExtrapolated
        });
      }
    }
  }

  return rows.sort((a, b) => {
    const countrySort = a.country.localeCompare(b.country);
    if (countrySort !== 0) return countrySort;
    const variableSort = a.variableCode.localeCompare(b.variableCode);
    if (variableSort !== 0) return variableSort;
    return a.year - b.year;
  });
}

export function parseWidMetadataResponse(payload: unknown): WidMetadataRecord[] {
  const root = unwrapSingleton(payload);
  const metadataFunc = isRecord(root) ? root.metadata_func : undefined;
  if (!Array.isArray(metadataFunc)) {
    throw new Error("WID metadata response did not include metadata_func.");
  }

  const records: WidMetadataRecord[] = [];
  for (const variableWrapper of metadataFunc) {
    if (!isRecord(variableWrapper)) {
      continue;
    }

    for (const [variableCode, parts] of Object.entries(variableWrapper)) {
      if (!Array.isArray(parts)) {
        continue;
      }

      const name = getNestedRecord(parts, 0, "name");
      const type = getNestedRecord(parts, 1, "type");
      const pop = getNestedRecord(parts, 2, "pop");
      const age = getNestedRecord(parts, 3, "age");
      const units = getNestedArray(parts, 4, "units");
      const notes = getNestedArray(parts, 5, "notes");

      for (const unitEntry of units) {
        if (!isRecord(unitEntry)) {
          continue;
        }
        const country = stringValue(unitEntry.country);
        if (!country) {
          continue;
        }

        const note = findNoteForCountry(notes, country);
        const unitMetadata = isRecord(unitEntry.metadata)
          ? unitEntry.metadata
          : {};

        records.push({
          variableCode,
          country,
          ...(stringValue(unitEntry.country_name)
            ? { countryName: stringValue(unitEntry.country_name) }
            : {}),
          ...(stringValue(name.shortname)
            ? { shortName: stringValue(name.shortname) }
            : {}),
          ...(stringValue(name.simpledes)
            ? { shortDescription: stringValue(name.simpledes) }
            : {}),
          ...(stringValue(name.technicaldes)
            ? { technicalDescription: stringValue(name.technicaldes) }
            : {}),
          ...(stringValue(type.shortdes) ? { type: stringValue(type.shortdes) } : {}),
          ...(stringValue(type.longdes)
            ? { typeDescription: stringValue(type.longdes) }
            : {}),
          ...(stringValue(pop.shortdes)
            ? { population: stringValue(pop.shortdes) }
            : {}),
          ...(stringValue(age.shortname) ? { age: stringValue(age.shortname) } : {}),
          ...(stringValue(unitMetadata.unit)
            ? { unit: stringValue(unitMetadata.unit) }
            : {}),
          ...(stringValue(note.method) ? { method: stringValue(note.method) } : {}),
          ...(stringValue(note.source) ? { source: stringValue(note.source) } : {}),
          ...(stringValue(note.data_quality)
            ? { quality: stringValue(note.data_quality) }
            : {}),
          ...(stringValue(note.imputation)
            ? { imputation: stringValue(note.imputation) }
            : {})
        });
      }
    }
  }

  return records.sort((a, b) => {
    const variableSort = a.variableCode.localeCompare(b.variableCode);
    if (variableSort !== 0) return variableSort;
    return a.country.localeCompare(b.country);
  });
}

export function parseAvailableVariablesResponse(
  payload: unknown
): WidAvailableVariable[] {
  const response = unwrapSingleton(payload);
  if (!isRecord(response)) {
    throw new Error("WID variable response was not an object.");
  }

  const variables: WidAvailableVariable[] = [];
  for (const [indicator, byCountry] of Object.entries(response)) {
    if (!isRecord(byCountry)) {
      continue;
    }
    for (const [country, combos] of Object.entries(byCountry)) {
      if (!Array.isArray(combos)) {
        continue;
      }
      for (const combo of combos) {
        if (!Array.isArray(combo) || combo.length < 3) {
          continue;
        }
        const percentile = String(combo[0]);
        const age = String(combo[1]);
        const population = String(combo[2]);
        variables.push({
          indicator,
          country,
          percentile,
          age,
          population,
          variableCode: `${indicator}_${percentile}_${age}_${population}`
        });
      }
    }
  }

  return variables.sort((a, b) => a.variableCode.localeCompare(b.variableCode));
}

export class WidClient implements WidDataProvider {
  private readonly apiKeyBase64: string;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetchFn: FetchFn;

  constructor(options: WidClientOptions = {}) {
    this.apiKeyBase64 =
      options.apiKeyBase64 ?? createApiKeyHeader(options.env ?? process.env);
    this.baseUrl = options.baseUrl ?? WID_API_BASE_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async listAvailableVariables(
    input: ListVariablesInput
  ): Promise<PaginatedResult<WidAvailableVariable>> {
    const variables = await this.fetchAvailableVariables(
      input.countries.map(normalizeCountry),
      input.indicators
    );
    return paginate(variables, input.limit, input.offset);
  }

  async fetchData(input: FetchDataInput): Promise<PaginatedResult<WidDataRow> & { rows: WidDataRow[] }> {
    const payload = await this.requestJson("countries-variables", {
      countries: input.countries.map(normalizeCountry).join(","),
      variables: input.variableCodes.join(","),
      years: "all"
    });

    const finalPayload =
      isRecord(payload) && payload.status === "payload_too_large"
        ? await this.requestDownloadPayload(payload.download_url)
        : payload;

    const rows = parseWidDataResponse(finalPayload, {
      startYear: input.startYear,
      endYear: input.endYear,
      includeExtrapolations: input.includeExtrapolations
    });
    const page = paginate(rows, input.limit, input.offset);
    return { ...page, rows: page.items };
  }

  async getMetadata(
    input: GetMetadataInput
  ): Promise<PaginatedResult<WidMetadataRecord> & { records: WidMetadataRecord[] }> {
    const payload = await this.requestJson("countries-variables-metadata", {
      countries: input.countries.map(normalizeCountry).join(","),
      variables: input.variableCodes.join(",")
    });
    const records = parseWidMetadataResponse(payload);
    const page = paginate(records, input.limit, input.offset);
    return { ...page, records: page.items };
  }

  async searchMetrics(input: SearchMetricsInput): Promise<PaginatedResult<MetricCandidate>> {
    const country = normalizeCountry(input.country);
    const indicators = candidateIndicatorsForQuery(input);
    const variables = await this.fetchAvailableVariables([country], indicators);
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

  async getSeries(input: GetSeriesInput): Promise<WidSeriesResult> {
    const country = normalizeCountry(input.country);
    let { metric, resolution } = await this.resolveSeriesMetric(
      country,
      input.metric,
      input.context,
      input.assumptionPolicy
    );
    let data = await this.fetchData({
      countries: [country],
      variableCodes: [metric.variableCode],
      startYear: input.startYear,
      endYear: input.endYear,
      includeExtrapolations: input.includeExtrapolations,
      limit: input.limit,
      offset: input.offset
    });
    let fallback;

    if (data.total === 0) {
      const fallbackResult = await this.tryNoRowsFallback({
        country,
        metric,
        metricInput: input.metric,
        resolution,
        startYear: input.startYear,
        endYear: input.endYear,
        includeExtrapolations: input.includeExtrapolations,
        limit: input.limit,
        offset: input.offset
      });
      if (fallbackResult) {
        metric = fallbackResult.metric;
        data = fallbackResult.data;
        fallback = fallbackResult.fallback;
      }
    }

    const metadata = await this.getMetadata({
      countries: [country],
      variableCodes: [metric.variableCode],
      limit: 10,
      offset: 0
    });

    return {
      metric,
      ...(resolution ? { resolution } : {}),
      ...(fallback ? { fallback } : {}),
      country,
      data,
      metadata: metadata.records
    };
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
      return { metric: resolveMetric(metricInput) };
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
    limit?: number;
    offset?: number;
  }): Promise<
    | {
        metric: MetricDefinition;
        data: PaginatedResult<WidDataRow> & { rows: WidDataRow[] };
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
      limit?: number;
      offset?: number;
    },
    candidates: MetricCandidate[]
  ): Promise<
    | {
        metric: MetricDefinition;
        data: PaginatedResult<WidDataRow> & { rows: WidDataRow[] };
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

      const data = await this.fetchData({
        countries: [input.country],
        variableCodes: [candidate.variableCode],
        startYear: input.startYear,
        endYear: input.endYear,
        includeExtrapolations: input.includeExtrapolations,
        limit: input.limit,
        offset: input.offset
      });
      if (data.total === 0) {
        continue;
      }

      return {
        metric: metricDefinitionFromCandidate(candidate, input.metricInput),
        data,
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
    const payload = await this.requestJson("countries-available-variables", {
      countries: countries.join(","),
      variables: indicators.join(",")
    });
    return parseAvailableVariablesResponse(payload);
  }

  private async requestJson(
    endpoint: string,
    params: Record<string, string>
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const cacheKey = url.toString();
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const response = await this.fetchFn(cacheKey, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "x-api-key": this.apiKeyBase64
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `WID request failed with HTTP ${response.status}. ${body.slice(0, 300)}`
      );
    }

    const payload = (await response.json()) as unknown;
    this.setCached(cacheKey, payload);
    return payload;
  }

  private async requestDownloadPayload(downloadUrl: unknown): Promise<unknown> {
    const url = stringValue(downloadUrl);
    if (!url) {
      throw new Error("WID returned a large payload response without download_url.");
    }

    const cached = this.getCached(url);
    if (cached !== undefined) {
      return cached;
    }

    const response = await this.fetchFn(url, {
      method: "GET",
      headers: { "accept": "application/json" }
    });
    if (!response.ok) {
      throw new Error(`WID large payload download failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as unknown;
    this.setCached(url, payload);
    return payload;
  }

  private getCached(cacheKey: string): unknown | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    return entry.value;
  }

  private setCached(cacheKey: string, value: unknown): void {
    if (this.cacheTtlMs <= 0) {
      return;
    }
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value
    });
  }
}

function paginate<T>(
  items: T[],
  requestedLimit: number | undefined,
  requestedOffset: number | undefined
): PaginatedResult<T> {
  const offset = Math.max(0, requestedOffset ?? 0);
  const limit = Math.min(Math.max(1, requestedLimit ?? DEFAULT_LIMIT), MAX_LIMIT);
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

function unwrapSingleton(payload: unknown): unknown {
  if (Array.isArray(payload) && payload.length === 1) {
    return payload[0];
  }
  return payload;
}

function normalizeCountryEntries(payload: unknown): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  const containers = Array.isArray(payload) ? payload : [payload];
  for (const container of containers) {
    if (!isRecord(container)) {
      continue;
    }
    for (const [country, series] of Object.entries(container)) {
      entries.push([country, series]);
    }
  }
  return entries;
}

function parseValueEntry(entry: unknown): { year: number; value: number } | null {
  let yearRaw: unknown;
  let valueRaw: unknown;
  if (Array.isArray(entry)) {
    yearRaw = entry[0];
    valueRaw = entry[1];
  } else if (isRecord(entry)) {
    yearRaw = entry.y ?? entry.year;
    valueRaw = entry.v ?? entry.value;
  } else {
    return null;
  }

  const year = Number(yearRaw);
  const value = Number(valueRaw);
  if (!Number.isFinite(year) || !Number.isFinite(value)) {
    return null;
  }
  return { year, value };
}

function parseExtrapolationRanges(value: unknown): Array<[number, number]> {
  const raw = stringValue(value);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((range) => {
      if (!Array.isArray(range) || range.length < 2) {
        return [];
      }
      const start = Number(range[0]);
      const end = Number(range[1]);
      return Number.isFinite(start) && Number.isFinite(end) ? [[start, end]] : [];
    });
  } catch {
    return [];
  }
}

function parseDataPointYears(value: unknown): Set<number> {
  const raw = stringValue(value);
  if (!raw) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
    );
  } catch {
    return new Set();
  }
}

function isYearExtrapolated(
  year: number,
  ranges: Array<[number, number]>,
  dataPointYears: Set<number>
): boolean {
  if (dataPointYears.has(year)) {
    return false;
  }
  return ranges.some(([start, end]) => year > start && year <= end);
}

function getNestedRecord(parts: unknown[], index: number, key: string): Record<string, unknown> {
  const part = parts[index];
  if (!isRecord(part)) {
    return {};
  }
  const value = part[key];
  return isRecord(value) ? value : {};
}

function getNestedArray(parts: unknown[], index: number, key: string): unknown[] {
  const part = parts[index];
  if (!isRecord(part)) {
    return [];
  }
  const value = part[key];
  return Array.isArray(value) ? value : [];
}

function findNoteForCountry(notes: unknown[], country: string): Record<string, unknown> {
  for (const noteGroup of notes) {
    if (!isRecord(noteGroup)) {
      continue;
    }
    for (const value of Object.values(noteGroup)) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (isRecord(candidate) && candidate.alpha2 === country) {
          return candidate;
        }
      }
    }
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
