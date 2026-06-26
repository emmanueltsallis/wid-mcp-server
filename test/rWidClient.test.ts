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
        technicaldes: "Technical national wealth definition",
        shorttype: "% of NNI",
        longtype: "Proportion of net national income",
        pop: "individuals",
        age: "All Ages",
        unit: "% of national income",
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
        technicalDescription: "Technical national wealth definition",
        type: "% of NNI",
        typeDescription: "Proportion of net national income",
        population: "individuals",
        age: "All Ages",
        unit: "% of national income",
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

  it("resolves natural-language metrics before downloading through the R backend", async () => {
    const runRScript = vi.fn(async (_script, inputJson) => {
      const input = JSON.parse(inputJson);
      if (input.action === "available_variables") {
        return JSON.stringify({
          items: [
            {
              indicator: "sptinc",
              country: "BR",
              percentile: "p99p100",
              age: "992",
              population: "j",
              variableCode: "sptinc_p99p100_992_j"
            }
          ]
        });
      }
      if (input.action === "metadata") {
        return JSON.stringify({
          metadata: [
            {
              country: "BR",
              countryname: "Brazil",
              variable_code: "sptinc_p99p100_992_j",
              shortname: "Top 1% pretax national income share",
              shortdes:
                "Share of pretax national income received by equal-split adults in the top 1%."
            }
          ]
        });
      }
      if (input.action === "download") {
        return JSON.stringify({
          rows: [
            {
              country: "BR",
              variable_code: "sptinc_p99p100_992_j",
              indicator: "sptinc",
              percentile: "p99p100",
              age_code: "992",
              pop_code: "j",
              year: 1980,
              value: 0.17,
              unit: "fraction",
              is_extrapolated: false
            }
          ],
          metadata: [
            {
              country: "BR",
              countryname: "Brazil",
              variable_code: "sptinc_p99p100_992_j",
              shortname: "Top 1% pretax national income share"
            }
          ]
        });
      }
      throw new Error(`Unexpected action: ${input.action}`);
    });
    const client = new RwidClient({ runRScript });

    const result = await client.getSeries({
      country: "Brazil",
      metric: "top 1% pre-tax income share",
      startYear: 1980
    });

    expect(result.metric.variableCode).toBe("sptinc_p99p100_992_j");
    expect(result.data.rows[0].value).toBe(0.17);
    expect(runRScript).toHaveBeenCalledTimes(3);
    expect(JSON.parse(runRScript.mock.calls[0][1])).toMatchObject({
      action: "available_variables",
      countries: ["BR"],
      indicators: ["sptinc"]
    });
    expect(JSON.parse(runRScript.mock.calls[1][1])).toMatchObject({
      action: "metadata",
      countries: ["BR"],
      variable_codes: ["sptinc_p99p100_992_j"]
    });
    expect(JSON.parse(runRScript.mock.calls[2][1])).toMatchObject({
      action: "download",
      countries: ["BR"],
      variable_codes: ["sptinc_p99p100_992_j"]
    });
  });

  it("falls back to the nearest same-concept variable when the selected combo has no rows", async () => {
    const runRScript = vi.fn(async (_script, inputJson) => {
      const input = JSON.parse(inputJson);
      if (input.action === "available_variables") {
        return JSON.stringify({
          items: [
            {
              indicator: "sptinc",
              country: "BR",
              percentile: "p99p100",
              age: "992",
              population: "j",
              variableCode: "sptinc_p99p100_992_j"
            },
            {
              indicator: "sptinc",
              country: "BR",
              percentile: "p99p100",
              age: "992",
              population: "i",
              variableCode: "sptinc_p99p100_992_i"
            },
            {
              indicator: "sptinc",
              country: "BR",
              percentile: "p90p100",
              age: "992",
              population: "j",
              variableCode: "sptinc_p90p100_992_j"
            }
          ]
        });
      }
      if (input.action === "metadata") {
        return JSON.stringify({
          metadata: [
            {
              country: "BR",
              countryname: "Brazil",
              variable_code: "sptinc_p99p100_992_j",
              shortname: "Top 1% pretax national income share"
            },
            {
              country: "BR",
              countryname: "Brazil",
              variable_code: "sptinc_p99p100_992_i",
              shortname: "Top 1% pretax national income share"
            }
          ]
        });
      }
      if (input.action === "download") {
        const [variableCode] = input.variable_codes;
        if (variableCode === "sptinc_p99p100_992_j") {
          return JSON.stringify({ rows: [], metadata: [] });
        }
        if (variableCode === "sptinc_p99p100_992_i") {
          return JSON.stringify({
            rows: [
              {
                country: "BR",
                variable_code: "sptinc_p99p100_992_i",
                indicator: "sptinc",
                percentile: "p99p100",
                age_code: "992",
                pop_code: "i",
                year: 1980,
                value: 0.16,
                unit: "fraction",
                is_extrapolated: false
              }
            ],
            metadata: [
              {
                country: "BR",
                countryname: "Brazil",
                variable_code: "sptinc_p99p100_992_i",
                shortname: "Top 1% pretax national income share"
              }
            ]
          });
        }
      }
      throw new Error(`Unexpected action: ${input.action}`);
    });
    const client = new RwidClient({ runRScript });

    const result = await client.getSeries({
      country: "Brazil",
      metric: "sptinc_p99p100_992_j",
      startYear: 1980
    });

    expect(result.metric.variableCode).toBe("sptinc_p99p100_992_i");
    expect(result.data.rows[0].variableCode).toBe("sptinc_p99p100_992_i");
    expect(result.fallback).toMatchObject({
      requestedVariableCode: "sptinc_p99p100_992_j",
      selectedVariableCode: "sptinc_p99p100_992_i",
      reason: "no_rows_for_requested_window",
      changedDimensions: ["population"]
    });
    const downloadCalls = runRScript.mock.calls
      .map(([, inputJson]) => JSON.parse(inputJson))
      .filter((input) => input.action === "download");
    expect(downloadCalls.map((input) => input.variable_codes[0])).toEqual([
      "sptinc_p99p100_992_j",
      "sptinc_p99p100_992_i"
    ]);
  });
});
