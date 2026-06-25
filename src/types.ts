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
  startYear?: number;
  endYear?: number;
  includeExtrapolations?: boolean;
  limit?: number;
  offset?: number;
}

export interface WidSeriesResult {
  metric: MetricDefinition;
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
}
