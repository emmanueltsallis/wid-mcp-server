import { describe, expect, it, vi } from "vitest";

import { RwidClient, parseRDownloadRows, parseRMetadataRows } from "../src/rWidClient.js";

describe("R WID client", () => {
  it("parses R download rows into normalized WID data rows", () => {
    const rows = parseRDownloadRows(
      [
        {
          country: "BR",
          variable_code: "wnweal_p0p100_999_i",
          indicator: "wnweal",
          percentile: "p0p100",
          age_code: "999",
          pop_code: "i",
          year: 1980,
          value: 2.7115,
          unit: "% of national income",
          is_extrapolated: false
        }
      ],
      { startYear: 1980 }
    );

    expect(rows).toEqual([
      {
        country: "BR",
        variableCode: "wnweal_p0p100_999_i",
        indicator: "wnweal",
        percentile: "p0p100",
        age: "999",
        population: "i",
        year: 1980,
        value: 2.7115,
        unit: "% of national income",
        isExtrapolated: false
      }
    ]);
  });

  it("parses R metadata rows into normalized metadata records", () => {
    const records = parseRMetadataRows([
      {
        country: "BR",
        countryname: "Brazil",
        variable_code: "wnweal_p0p100_999_i",
        shortname: "Market-value national wealth",
        shortdes: "Net national wealth description",
        pop: "individuals",
        age: "All Ages",
        source: "WID source",
        imputation: "full",
        quality: "4",
        method: "WID method"
      }
    ]);

    expect(records).toEqual([
      {
        variableCode: "wnweal_p0p100_999_i",
        country: "BR",
        countryName: "Brazil",
        shortName: "Market-value national wealth",
        shortDescription: "Net national wealth description",
        population: "individuals",
        age: "All Ages",
        source: "WID source",
        imputation: "full",
        quality: "4",
        method: "WID method"
      }
    ]);
  });

  it("fetches exact variable data through an Rscript bridge", async () => {
    const runRScript = vi.fn(async () =>
      JSON.stringify({
        rows: [
          {
            country: "BR",
            variable_code: "wnweal_p0p100_999_i",
            indicator: "wnweal",
            percentile: "p0p100",
            age_code: "999",
            pop_code: "i",
            year: 1980,
            value: 2.7115,
            unit: "% of national income",
            is_extrapolated: false
          }
        ],
        metadata: []
      })
    );
    const client = new RwidClient({ runRScript });

    const result = await client.fetchData({
      countries: ["Brazil"],
      variableCodes: ["wnweal_p0p100_999_i"],
      startYear: 1980
    });

    expect(result.rows[0].country).toBe("BR");
    expect(result.rows[0].variableCode).toBe("wnweal_p0p100_999_i");
    expect(runRScript).toHaveBeenCalledTimes(1);
    expect(JSON.parse(runRScript.mock.calls[0][1])).toMatchObject({
      action: "download",
      countries: ["BR"],
      variable_codes: ["wnweal_p0p100_999_i"],
      include_extrapolations: true
    });
  });

  it("ignores informational R output before the JSON payload", async () => {
    const runRScript = vi.fn(async () =>
      [
        "Variable: wnweal_p0p100_999_i",
        JSON.stringify({
          rows: [
            {
              country: "BR",
              variable_code: "wnweal_p0p100_999_i",
              indicator: "wnweal",
              percentile: "p0p100",
              age_code: "999",
              pop_code: "i",
              year: 1980,
              value: 2.7115,
              is_extrapolated: false
            }
          ],
          metadata: []
        })
      ].join("\n")
    );
    const client = new RwidClient({ runRScript });

    const result = await client.fetchData({
      countries: ["BR"],
      variableCodes: ["wnweal_p0p100_999_i"]
    });

    expect(result.rows[0].year).toBe(1980);
  });

  it("gets a high-level series through the R backend", async () => {
    const runRScript = vi.fn(async () =>
      JSON.stringify({
        rows: [
          {
            country: "BR",
            variable_code: "wnweal_p0p100_999_i",
            indicator: "wnweal",
            percentile: "p0p100",
            age_code: "999",
            pop_code: "i",
            year: 1980,
            value: 2.7115,
            unit: "% of national income",
            is_extrapolated: false
          }
        ],
        metadata: [
          {
            country: "BR",
            countryname: "Brazil",
            variable_code: "wnweal_p0p100_999_i",
            shortname: "Market-value national wealth",
            shortdes: "Net national wealth description"
          }
        ]
      })
    );
    const client = new RwidClient({ runRScript });

    const result = await client.getSeries({
      country: "Brazil",
      metric: "wealth_income_ratio",
      startYear: 1980
    });

    expect(result.country).toBe("BR");
    expect(result.metric.variableCode).toBe("wnweal_p0p100_999_i");
    expect(result.data.rows).toHaveLength(1);
    expect(result.metadata[0].countryName).toBe("Brazil");
    expect(result.metadata[0].shortDescription).toBe("Net national wealth description");
  });

  it("lists available variables through the official R package internals", async () => {
    const runRScript = vi.fn(async () =>
      JSON.stringify({
        items: [
          {
            indicator: "wnweal",
            country: "BR",
            percentile: "p0p100",
            age: "999",
            population: "i",
            variableCode: "wnweal_p0p100_999_i"
          }
        ]
      })
    );
    const client = new RwidClient({ runRScript });

    const result = await client.listAvailableVariables({
      countries: ["BR"],
      indicators: ["wnweal"]
    });

    expect(result.items[0].variableCode).toBe("wnweal_p0p100_999_i");
    expect(JSON.parse(runRScript.mock.calls[0][1])).toMatchObject({
      action: "available_variables",
      countries: ["BR"],
      indicators: ["wnweal"]
    });
  });
});
