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
});
