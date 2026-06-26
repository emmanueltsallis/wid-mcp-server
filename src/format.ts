import type {
  MetricDefinition,
  MetricCandidate,
  MetricResolveResult,
  PaginatedResult,
  WidAvailableVariable,
  WidDataRow,
  WidMetadataRecord
} from "./types.js";

export type ResponseFormat = "markdown" | "json";

export interface ToolResponse<T extends Record<string, unknown>> {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
}

export function makeToolResponse<T extends Record<string, unknown>>(
  structuredContent: T,
  markdown: string,
  responseFormat: ResponseFormat = "markdown"
): ToolResponse<T> {
  return {
    content: [
      {
        type: "text",
        text:
          responseFormat === "json"
            ? JSON.stringify(structuredContent, null, 2)
            : markdown
      }
    ],
    structuredContent
  };
}

export function formatSeriesMarkdown(input: {
  country: string;
  metric: MetricDefinition;
  rows: WidDataRow[];
  metadata: WidMetadataRecord[];
  pagination: Pick<PaginatedResult<WidDataRow>, "total" | "count" | "hasMore" | "nextOffset">;
}): string {
  const countryName =
    input.metadata.find((record) => record.countryName)?.countryName ??
    input.country;
  const lines = [
    `# ${input.metric.description} - ${countryName} (${input.country})`,
    "",
    `Variable: \`${input.metric.variableCode}\``,
    `Rows returned: ${input.pagination.count} of ${input.pagination.total}`,
    ""
  ];

  if (input.metadata.length > 0) {
    const first = input.metadata[0];
    if (first.unit) lines.push(`Unit: ${first.unit}`);
    if (first.shortName) lines.push(`Series: ${first.shortName}`);
    if (first.source) lines.push(`Source: ${first.source}`);
    lines.push("");
  }

  lines.push("| Year | Value | Extrapolated |");
  lines.push("| ---: | ---: | :--- |");
  for (const row of input.rows) {
    lines.push(
      `| ${row.year} | ${formatNumber(row.value)} | ${row.isExtrapolated ? "yes" : "no"} |`
    );
  }

  if (input.pagination.hasMore) {
    lines.push("");
    lines.push(`More rows available. Use offset ${input.pagination.nextOffset}.`);
  }

  return lines.join("\n");
}

export function formatRowsMarkdown(input: {
  title: string;
  rows: WidDataRow[];
  pagination: Pick<PaginatedResult<WidDataRow>, "total" | "count" | "hasMore" | "nextOffset">;
}): string {
  const lines = [
    `# ${input.title}`,
    "",
    `Rows returned: ${input.pagination.count} of ${input.pagination.total}`,
    "",
    "| Country | Variable | Year | Value | Unit | Extrapolated |",
    "| :--- | :--- | ---: | ---: | :--- | :--- |"
  ];

  for (const row of input.rows) {
    lines.push(
      `| ${row.country} | \`${row.variableCode}\` | ${row.year} | ${formatNumber(row.value)} | ${row.unit ?? ""} | ${row.isExtrapolated ? "yes" : "no"} |`
    );
  }

  if (input.pagination.hasMore) {
    lines.push("");
    lines.push(`More rows available. Use offset ${input.pagination.nextOffset}.`);
  }

  return lines.join("\n");
}

export function formatAvailableVariablesMarkdown(input: {
  variables: WidAvailableVariable[];
  pagination: Pick<
    PaginatedResult<WidAvailableVariable>,
    "total" | "count" | "hasMore" | "nextOffset"
  >;
}): string {
  const lines = [
    "# WID Available Variables",
    "",
    `Rows returned: ${input.pagination.count} of ${input.pagination.total}`,
    "",
    "| Country | Variable code | Indicator | Percentile | Age | Population |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |"
  ];

  for (const variable of input.variables) {
    lines.push(
      `| ${variable.country} | \`${variable.variableCode}\` | ${variable.indicator} | ${variable.percentile} | ${variable.age} | ${variable.population} |`
    );
  }

  if (input.pagination.hasMore) {
    lines.push("");
    lines.push(`More rows available. Use offset ${input.pagination.nextOffset}.`);
  }

  return lines.join("\n");
}

export function formatMetadataMarkdown(input: {
  records: WidMetadataRecord[];
  pagination: Pick<
    PaginatedResult<WidMetadataRecord>,
    "total" | "count" | "hasMore" | "nextOffset"
  >;
}): string {
  const lines = [
    "# WID Metadata",
    "",
    `Rows returned: ${input.pagination.count} of ${input.pagination.total}`,
    ""
  ];

  for (const record of input.records) {
    lines.push(`## ${record.shortName ?? record.variableCode} (${record.country})`);
    lines.push(`- Variable: \`${record.variableCode}\``);
    if (record.countryName) lines.push(`- Country: ${record.countryName}`);
    if (record.type) lines.push(`- Type: ${record.type}`);
    if (record.unit) lines.push(`- Unit: ${record.unit}`);
    if (record.quality) lines.push(`- Quality: ${record.quality}`);
    if (record.imputation) lines.push(`- Imputation: ${record.imputation}`);
    if (record.source) lines.push(`- Source: ${record.source}`);
    if (record.method) lines.push(`- Method: ${record.method}`);
    lines.push("");
  }

  if (input.pagination.hasMore) {
    lines.push(`More records available. Use offset ${input.pagination.nextOffset}.`);
  }

  return lines.join("\n").trimEnd();
}

export function formatMetricCandidatesMarkdown(input: {
  title?: string;
  candidates: MetricCandidate[];
  pagination: Pick<
    PaginatedResult<MetricCandidate>,
    "total" | "count" | "hasMore" | "nextOffset"
  >;
}): string {
  const lines = [
    `# ${input.title ?? "WID Metric Candidates"}`,
    "",
    `Candidates returned: ${input.pagination.count} of ${input.pagination.total}`,
    "",
    "| Variable code | Score | Confidence | Description | Matched fields |",
    "| :--- | ---: | :--- | :--- | :--- |"
  ];

  for (const candidate of input.candidates) {
    lines.push(
      `| \`${candidate.variableCode}\` | ${candidate.score} | ${candidate.confidence} | ${candidate.description} | ${candidate.matchedFields.join(", ")} |`
    );
  }

  if (input.pagination.hasMore) {
    lines.push("");
    lines.push(`More candidates available. Use offset ${input.pagination.nextOffset}.`);
  }

  return lines.join("\n");
}

export function formatMetricResolutionMarkdown(result: MetricResolveResult): string {
  const lines = [
    `# WID Metric Resolution: ${result.status}`,
    "",
    result.message,
    ""
  ];

  if (result.selected) {
    lines.push(`Selected variable: \`${result.selected.variableCode}\``);
    lines.push(`Description: ${result.selected.description}`);
    lines.push("");
  }

  if (result.candidates.length > 0) {
    lines.push("| Variable code | Score | Confidence | Description |");
    lines.push("| :--- | ---: | :--- | :--- |");
    for (const candidate of result.candidates) {
      lines.push(
        `| \`${candidate.variableCode}\` | ${candidate.score} | ${candidate.confidence} | ${candidate.description} |`
      );
    }
  }

  return lines.join("\n").trimEnd();
}

export function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("en-US", { maximumSignificantDigits: 8 });
}
