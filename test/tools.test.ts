import { describe, expect, it, vi } from "vitest";

import { createWidToolHandlers } from "../src/tools.js";
import type {
  MetricDefinition,
  MetricResolveResult,
  MetricCandidate,
  PaginatedResult,
  WidAvailableVariable,
  WidDataRow,
  WidMetadataRecord
} from "../src/types.js";

const metric: MetricDefinition = {
  id: "wealth_income_ratio",
  aliases: ["wealth/income ratio"],
  variableCode: "wnweal_p0p100_999_i",
  indicator: "wnweal",
  description: "Market-value national wealth as a percentage of national income.",
  unitHint: "% of national income"
};

const dataRow: WidDataRow = {
  country: "BR",
  variableCode: "wnweal_p0p100_999_i",
  indicator: "wnweal",
  percentile: "p0p100",
  age: "999",
  population: "i",
  year: 1980,
  value: 2.3,
  unit: "% of national income",
  isExtrapolated: false
};

const metadataRecord: WidMetadataRecord = {
  variableCode: "wnweal_p0p100_999_i",
  country: "BR",
  countryName: "Brazil",
  shortName: "Market-value national wealth",
  type: "% of NNI",
  unit: "% of national income",
  source: "WID source note"
};

const metricCandidate: MetricCandidate = {
  country: "BR",
  variableCode: "wnweal_p0p100_999_i",
  indicator: "wnweal",
  percentile: "p0p100",
  age: "999",
  population: "i",
  score: 220,
  confidence: "high",
  description: "Market-value national wealth as a percentage of national income.",
  matchedFields: ["series type: wealth-to-income ratio", "concept: national wealth"],
  metadata: metadataRecord
};

function page<T>(items: T[]): PaginatedResult<T> {
  return {
    total: items.length,
    count: items.length,
    offset: 0,
    items,
    hasMore: false
  };
}

describe("WID MCP tool handlers", () => {
  it("gets a high-level WID series for Brazil wealth income ratio", async () => {
    const client = {
      getSeries: vi.fn(async () => ({
        metric,
        country: "BR",
        data: { ...page([dataRow]), rows: [dataRow] },
        metadata: [metadataRecord]
      }))
    };
    const handlers = createWidToolHandlers(client);

    const result = await handlers.wid_get_series({
      country: "Brazil",
      metric: "wealth/income ratio",
      start_year: 1980
    });

    expect(client.getSeries).toHaveBeenCalledWith({
      country: "Brazil",
      metric: "wealth/income ratio",
      startYear: 1980,
      endYear: undefined,
      includeExtrapolations: true,
      limit: 100,
      offset: 0
    });
    expect(result.structuredContent.rows).toEqual([dataRow]);
    expect(result.content[0].text).toContain("Brazil");
    expect(result.content[0].text).toContain("1980");
  });

  it("fetches exact WID variable codes", async () => {
    const client = {
      fetchData: vi.fn(async () => ({ ...page([dataRow]), rows: [dataRow] }))
    };
    const handlers = createWidToolHandlers(client);

    const result = await handlers.wid_fetch_data({
      countries: ["BR"],
      variable_codes: ["wnweal_p0p100_999_i"],
      start_year: 1980,
      response_format: "json"
    });

    expect(client.fetchData).toHaveBeenCalledWith({
      countries: ["BR"],
      variableCodes: ["wnweal_p0p100_999_i"],
      startYear: 1980,
      endYear: undefined,
      includeExtrapolations: true,
      limit: 100,
      offset: 0
    });
    expect(result.structuredContent.rows).toEqual([dataRow]);
    expect(result.content[0].text).toContain("\"variableCode\"");
  });

  it("searches available WID variable combinations", async () => {
    const available: WidAvailableVariable = {
      indicator: "wnweal",
      country: "BR",
      percentile: "p0p100",
      age: "999",
      population: "i",
      variableCode: "wnweal_p0p100_999_i"
    };
    const client = {
      listAvailableVariables: vi.fn(async () => page([available]))
    };
    const handlers = createWidToolHandlers(client);

    const result = await handlers.wid_search_indicators({
      countries: ["Brazil"],
      indicators: ["wnweal"]
    });

    expect(client.listAvailableVariables).toHaveBeenCalledWith({
      countries: ["Brazil"],
      indicators: ["wnweal"],
      limit: 100,
      offset: 0
    });
    expect(result.structuredContent.items).toEqual([available]);
    expect(result.content[0].text).toContain("wnweal_p0p100_999_i");
  });

  it("fetches metadata for exact variable codes", async () => {
    const client = {
      getMetadata: vi.fn(async () => ({
        ...page([metadataRecord]),
        records: [metadataRecord]
      }))
    };
    const handlers = createWidToolHandlers(client);

    const result = await handlers.wid_get_metadata({
      countries: ["BR"],
      variable_codes: ["wnweal_p0p100_999_i"]
    });

    expect(client.getMetadata).toHaveBeenCalledWith({
      countries: ["BR"],
      variableCodes: ["wnweal_p0p100_999_i"],
      limit: 100,
      offset: 0
    });
    expect(result.structuredContent.records).toEqual([metadataRecord]);
    expect(result.content[0].text).toContain("Market-value national wealth");
  });

  it("searches natural-language WID metrics", async () => {
    const client = {
      searchMetrics: vi.fn(async () => page([metricCandidate]))
    };
    const handlers = createWidToolHandlers(client);

    const result = await handlers.wid_search_metrics({
      country: "Brazil",
      query: "wealth/income ratio"
    });

    expect(client.searchMetrics).toHaveBeenCalledWith({
      country: "Brazil",
      query: "wealth/income ratio",
      percentile: undefined,
      age: undefined,
      population: undefined,
      limit: 100,
      offset: 0
    });
    expect(result.structuredContent.items).toEqual([metricCandidate]);
    expect(result.content[0].text).toContain("wnweal_p0p100_999_i");
  });

  it("resolves natural-language WID metrics without fetching data", async () => {
    const resolution: MetricResolveResult = {
      status: "resolved",
      country: "BR",
      query: "wealth/income ratio",
      selected: metricCandidate,
      candidates: [metricCandidate],
      message: "Resolved to wnweal_p0p100_999_i."
    };
    const client = {
      resolveMetric: vi.fn(async () => resolution)
    };
    const handlers = createWidToolHandlers(client);

    const result = await handlers.wid_resolve_metric({
      country: "Brazil",
      query: "wealth/income ratio"
    });

    expect(client.resolveMetric).toHaveBeenCalledWith({
      country: "Brazil",
      query: "wealth/income ratio",
      percentile: undefined,
      age: undefined,
      population: undefined,
      confidenceThreshold: undefined,
      limit: 100,
      offset: 0
    });
    expect(result.structuredContent.status).toBe("resolved");
    expect(result.content[0].text).toContain("Resolved");
  });

  it("explains built-in WID aliases without calling the live client", async () => {
    const handlers = createWidToolHandlers({});

    const result = await handlers.wid_explain_codes({});

    const metrics = result.structuredContent.metrics as MetricDefinition[];
    expect(metrics[0].id).toBe("wealth_income_ratio");
    expect(result.content[0].text).toContain("wealth_income_ratio");
    expect(result.content[0].text).toContain("wnweal_p0p100_999_i");
  });
});
