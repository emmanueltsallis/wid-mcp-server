import { describe, expect, it, vi } from "vitest";

import {
  WidClient,
  createApiKeyHeader,
  normalizeCountry,
  parseWidDataResponse,
  parseWidMetadataResponse,
  resolveMetric
} from "../src/widClient.js";

describe("WID client helpers", () => {
  it("normalizes Brazil to the WID country code", () => {
    expect(normalizeCountry("Brazil")).toBe("BR");
    expect(normalizeCountry("br")).toBe("BR");
    expect(() => normalizeCountry("Atlantis")).toThrow(/Unknown country/i);
  });

  it("resolves the wealth income ratio metric to the WID variable code", () => {
    const metric = resolveMetric("wealth/income ratio");

    expect(metric.variableCode).toBe("wnweal_p0p100_999_i");
    expect(metric.indicator).toBe("wnweal");
    expect(metric.description).toMatch(/national wealth/i);
  });

  it("creates the WID x-api-key header from base64 or hex env values", () => {
    expect(createApiKeyHeader({ WID_API_KEY_BASE64: "abc123" })).toBe("abc123");
    expect(createApiKeyHeader({ WID_API_KEY_HEX: "616263" })).toBe("YWJj");
    expect(() => createApiKeyHeader({})).toThrow(/WID_API_KEY_BASE64/i);
  });

  it("parses WID data responses, filters years, and sorts rows", () => {
    const rows = parseWidDataResponse(
      {
        wnweal_p0p100_999_i: [
          {
            BR: {
              meta: {
                unit: "% of national income",
                extrapolation: "[[2023, 2024]]",
                data_points: null
              },
              values: [
                { y: 2024, v: 4.2 },
                { y: 1979, v: 2.1 },
                { y: 1980, v: 2.3 }
              ]
            }
          }
        ]
      },
      { startYear: 1980, includeExtrapolations: true }
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
        value: 2.3,
        unit: "% of national income",
        isExtrapolated: false
      },
      {
        country: "BR",
        variableCode: "wnweal_p0p100_999_i",
        indicator: "wnweal",
        percentile: "p0p100",
        age: "999",
        population: "i",
        year: 2024,
        value: 4.2,
        unit: "% of national income",
        isExtrapolated: true
      }
    ]);
  });

  it("excludes extrapolated rows when requested", () => {
    const rows = parseWidDataResponse(
      {
        wnweal_p0p100_999_i: [
          {
            BR: {
              meta: {
                unit: "% of national income",
                extrapolation: "[[2023, 2024]]",
                data_points: null
              },
              values: [
                { y: 2023, v: 4.1 },
                { y: 2024, v: 4.2 },
                { y: 2022, v: 4.0 }
              ]
            }
          }
        ]
      },
      { includeExtrapolations: false }
    );

    expect(rows.map((row) => row.year)).toEqual([2022, 2023]);
  });

  it("parses WID metadata responses into flat metadata records", () => {
    const metadata = parseWidMetadataResponse([
      {
        metadata_func: [
          {
            wnweal_p0p100_999_i: [
              {
                name: {
                  shortname: "Market-value national wealth",
                  simpledes: "Net national wealth description",
                  technicaldes: "technical definition"
                }
              },
              {
                type: {
                  shortdes: "% of NNI",
                  longdes: "Proportion of net national income"
                }
              },
              {
                pop: {
                  shortdes: "individuals",
                  longdes: "individual population"
                }
              },
              {
                age: {
                  agecode: "999",
                  shortname: "All Ages",
                  fullname: "all ages"
                }
              },
              {
                units: [
                  {
                    country_name: "Brazil",
                    country: "BR",
                    metadata: {
                      unit: "% of national income"
                    }
                  }
                ]
              },
              {
                notes: [
                  {
                    nweal: [
                      {
                        alpha2: "BR",
                        method: "method note",
                        source: "source note",
                        data_quality: "4",
                        imputation: "full"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);

    expect(metadata).toEqual([
      {
        variableCode: "wnweal_p0p100_999_i",
        country: "BR",
        countryName: "Brazil",
        shortName: "Market-value national wealth",
        shortDescription: "Net national wealth description",
        technicalDescription: "technical definition",
        type: "% of NNI",
        typeDescription: "Proportion of net national income",
        population: "individuals",
        age: "All Ages",
        unit: "% of national income",
        method: "method note",
        source: "source note",
        quality: "4",
        imputation: "full"
      }
    ]);
  });

  it("fetches live data through the WID API endpoints with auth and cache", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          wnweal_p0p100_999_i: [
            {
              BR: {
                meta: { unit: "% of national income" },
                values: [{ y: 1980, v: 2.3 }]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    const client = new WidClient({
      apiKeyBase64: "abc123",
      fetchFn: fetchMock,
      cacheTtlMs: 60_000
    });

    const first = await client.fetchData({
      countries: ["BR"],
      variableCodes: ["wnweal_p0p100_999_i"],
      startYear: 1980
    });
    const second = await client.fetchData({
      countries: ["BR"],
      variableCodes: ["wnweal_p0p100_999_i"],
      startYear: 1980
    });

    expect(first.rows).toEqual(second.rows);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit
    ];
    expect(url).toContain("/countries-variables?");
    expect(url).toContain("countries=BR");
    expect(url).toContain("variables=wnweal_p0p100_999_i");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("abc123");
  });

  it("falls back to a same-concept API variable when the requested combo has no rows", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (
        url.includes("/countries-variables?") &&
        url.includes("variables=sptinc_p99p100_992_j")
      ) {
        return new Response(
          JSON.stringify({
            sptinc_p99p100_992_j: [
              {
                BR: {
                  meta: { unit: "fraction" },
                  values: []
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/countries-available-variables?")) {
        return new Response(
          JSON.stringify({
            sptinc: {
              BR: [
                ["p99p100", "992", "j"],
                ["p99p100", "992", "i"],
                ["p90p100", "992", "j"]
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (
        url.includes("/countries-variables?") &&
        url.includes("variables=sptinc_p99p100_992_i")
      ) {
        return new Response(
          JSON.stringify({
            sptinc_p99p100_992_i: [
              {
                BR: {
                  meta: { unit: "fraction" },
                  values: [{ y: 1980, v: 0.16 }]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/countries-variables-metadata?")) {
        return new Response(
          JSON.stringify([
            {
              metadata_func: [
                {
                  sptinc_p99p100_992_i: [
                    {
                      name: {
                        shortname: "Top 1% pretax national income share"
                      }
                    },
                    { type: { shortdes: "fraction" } },
                    { pop: { shortdes: "individuals" } },
                    { age: { shortname: "Adults" } },
                    {
                      units: [
                        {
                          country_name: "Brazil",
                          country: "BR",
                          metadata: { unit: "fraction" }
                        }
                      ]
                    },
                    { notes: [] }
                  ]
                }
              ]
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new WidClient({
      apiKeyBase64: "abc123",
      fetchFn: fetchMock,
      cacheTtlMs: 0
    });

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
  });

  it("searches natural-language metrics through availability and metadata endpoints", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/countries-available-variables?")) {
        return new Response(
          JSON.stringify({
            wnweal: {
              BR: [["p0p100", "999", "i"]]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.includes("/countries-variables-metadata?")) {
        return new Response(
          JSON.stringify([
            {
              metadata_func: [
                {
                  wnweal_p0p100_999_i: [
                    {
                      name: {
                        shortname: "Market-value national wealth",
                        simpledes:
                          "Market-value national wealth as a percentage of national income."
                      }
                    },
                    { type: { shortdes: "% of NNI" } },
                    { pop: { shortdes: "individuals" } },
                    { age: { shortname: "All Ages" } },
                    {
                      units: [
                        {
                          country_name: "Brazil",
                          country: "BR",
                          metadata: { unit: "% of national income" }
                        }
                      ]
                    },
                    { notes: [] }
                  ]
                }
              ]
            }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new WidClient({
      apiKeyBase64: "abc123",
      fetchFn: fetchMock,
      cacheTtlMs: 0
    });

    const result = await client.searchMetrics({
      country: "Brazil",
      query: "wealth/income ratio"
    });

    expect(result.items[0]).toMatchObject({
      variableCode: "wnweal_p0p100_999_i",
      confidence: "high"
    });
    expect(result.items[0].metadata?.countryName).toBe("Brazil");
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes("variables=wnweal"))).toBe(true);
    expect(
      urls.some((url) => url.includes("variables=wnweal_p0p100_999_i"))
    ).toBe(true);
  });
});
