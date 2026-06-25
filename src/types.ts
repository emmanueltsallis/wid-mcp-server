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
