export interface WidDataRow {
  country: string;
  variableCode: string;
  indicator: string;
  percentile: string;
  age: string;
  population: string;
  year: number;
  value: number;
  unit?: string;
  isExtrapolated: boolean;
}

export type WidSeriesFallbackReason = "no_rows_for_requested_window";

export interface WidSeriesFallback {
  requestedVariableCode: string;
  selectedVariableCode: string;
  reason: WidSeriesFallbackReason;
  changedDimensions: string[];
  message: string;
}

export interface WidMetadataRecord {
  variableCode: string;
  country: string;
  countryName?: string;
  shortName?: string;
  shortDescription?: string;
  technicalDescription?: string;
  type?: string;
  typeDescription?: string;
  population?: string;
  age?: string;
  unit?: string;
  method?: string;
  source?: string;
  quality?: string;
  imputation?: string;
}

export interface WidAvailableVariable {
  indicator: string;
  country: string;
  percentile: string;
  age: string;
  population: string;
  variableCode: string;
}

export interface MetricDefinition {
  id: string;
  aliases: string[];
  variableCode: string;
  indicator: string;
  description: string;
  unitHint: string;
}

export type MetricConfidence = "high" | "medium" | "low";
export type AssumptionPolicy = "strict" | "wid_default";

export interface MetricCandidate {
  country: string;
  variableCode: string;
  indicator: string;
  percentile: string;
  age: string;
  population: string;
  score: number;
  confidence: MetricConfidence;
  description: string;
  matchedFields: string[];
  metadata?: WidMetadataRecord;
}

export interface SearchMetricsInput {
  country: string;
  query: string;
  context?: string;
  percentile?: string;
  age?: string;
  population?: string;
  assumptionPolicy?: AssumptionPolicy;
  limit?: number;
  offset?: number;
}

export interface ResolveMetricInput extends SearchMetricsInput {
  confidenceThreshold?: number;
}

export interface MetricResolveResult {
  status: "resolved" | "ambiguous" | "not_found";
  country: string;
  query: string;
  context?: string;
  selected?: MetricCandidate;
  candidates: MetricCandidate[];
  assumptionPolicy: AssumptionPolicy;
  assumptions: string[];
  alternatives: MetricResolutionAlternative[];
  clarifyingQuestion?: string;
  message: string;
}

export interface MetricResolutionAlternative {
  label: string;
  description: string;
  variableCodeHint?: string;
}

export interface PaginatedResult<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  hasMore: boolean;
  nextOffset?: number;
}

export interface FetchDataInput {
  countries: string[];
  variableCodes: string[];
  startYear?: number;
  endYear?: number;
  includeExtrapolations?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListVariablesInput {
  countries: string[];
  indicators: string[];
  limit?: number;
  offset?: number;
}

export interface GetMetadataInput {
  countries: string[];
  variableCodes: string[];
  limit?: number;
  offset?: number;
}

export interface GetSeriesInput {
  country: string;
  metric: string;
  context?: string;
  startYear?: number;
  endYear?: number;
  includeExtrapolations?: boolean;
  assumptionPolicy?: AssumptionPolicy;
  limit?: number;
  offset?: number;
}

export interface WidSeriesResult {
  metric: MetricDefinition;
  resolution?: MetricResolveResult;
  fallback?: WidSeriesFallback;
  country: string;
  data: PaginatedResult<WidDataRow> & { rows: WidDataRow[] };
  metadata: WidMetadataRecord[];
}

export interface WidDataProvider {
  getSeries(input: GetSeriesInput): Promise<WidSeriesResult>;
  fetchData(input: FetchDataInput): Promise<
    PaginatedResult<WidDataRow> & { rows: WidDataRow[] }
  >;
  listAvailableVariables(
    input: ListVariablesInput
  ): Promise<PaginatedResult<WidAvailableVariable>>;
  getMetadata(input: GetMetadataInput): Promise<
    PaginatedResult<WidMetadataRecord> & { records: WidMetadataRecord[] }
  >;
  searchMetrics(input: SearchMetricsInput): Promise<PaginatedResult<MetricCandidate>>;
  resolveMetric(input: ResolveMetricInput): Promise<MetricResolveResult>;
}
