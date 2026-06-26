import { describe, expect, it } from "vitest";

import {
  metricDefinitionFromCandidate,
  rankMetricCandidates,
  resolveMetricCandidate
} from "../src/metricResolver.js";
import type { WidAvailableVariable, WidMetadataRecord } from "../src/types.js";

const availableVariables: WidAvailableVariable[] = [
  {
    indicator: "wnweal",
    country: "BR",
    percentile: "p0p100",
    age: "999",
    population: "i",
    variableCode: "wnweal_p0p100_999_i"
  },
  {
    indicator: "sptinc",
    country: "BR",
    percentile: "p99p100",
    age: "992",
    population: "j",
    variableCode: "sptinc_p99p100_992_j"
  },
  {
    indicator: "aptinc",
    country: "BR",
    percentile: "p99p100",
    age: "992",
    population: "j",
    variableCode: "aptinc_p99p100_992_j"
  },
  {
    indicator: "sdiinc",
    country: "BR",
    percentile: "p99p100",
    age: "992",
    population: "j",
    variableCode: "sdiinc_p99p100_992_j"
  },
  {
    indicator: "gptinc",
    country: "BR",
    percentile: "p0p100",
    age: "992",
    population: "j",
    variableCode: "gptinc_p0p100_992_j"
  },
  {
    indicator: "mgdpro",
    country: "BR",
    percentile: "p0p100",
    age: "999",
    population: "i",
    variableCode: "mgdpro_p0p100_999_i"
  }
];

const metadata: WidMetadataRecord[] = [
  {
    variableCode: "wnweal_p0p100_999_i",
    country: "BR",
    shortName: "Market-value national wealth",
    shortDescription: "Net national wealth as a percentage of national income.",
    unit: "% of national income"
  },
  {
    variableCode: "sptinc_p99p100_992_j",
    country: "BR",
    shortName: "Top 1% pretax national income share",
    shortDescription:
      "Share of pretax national income received by equal-split adults in the top 1%.",
    unit: "fraction"
  }
];

describe("WID metric resolver", () => {
  it("ranks the WID wealth/income ratio from dictionary terms and live availability", () => {
    const result = rankMetricCandidates({
      country: "BR",
      query: "wealth/income ratio",
      availableVariables,
      metadata
    });

    expect(result.items[0]).toMatchObject({
      variableCode: "wnweal_p0p100_999_i",
      indicator: "wnweal",
      confidence: "high"
    });
    expect(result.items[0].matchedFields).toContain("series type: wealth-to-income ratio");
    expect(result.items[0].metadata?.shortName).toBe("Market-value national wealth");
  });

  it("resolves a top 1% pre-tax income share to the verified equal-split adult series", () => {
    const result = resolveMetricCandidate({
      country: "BR",
      query: "top 1% pre-tax income share",
      availableVariables,
      metadata
    });

    expect(result.status).toBe("resolved");
    expect(result.selected?.variableCode).toBe("sptinc_p99p100_992_j");
    expect(result.selected?.confidence).toBe("high");
  });

  it("does not silently resolve broad income prompts", () => {
    const result = resolveMetricCandidate({
      country: "BR",
      query: "income",
      availableVariables
    });

    expect(result.status).toBe("ambiguous");
    expect(result.selected).toBeUndefined();
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("lets exact WID variable codes win when they are available", () => {
    const result = resolveMetricCandidate({
      country: "BR",
      query: "sptinc_p99p100_992_j",
      availableVariables
    });

    expect(result.status).toBe("resolved");
    expect(result.selected?.variableCode).toBe("sptinc_p99p100_992_j");
  });

  it("builds a MetricDefinition for dynamically resolved variables", () => {
    const result = resolveMetricCandidate({
      country: "BR",
      query: "wealth/income ratio",
      availableVariables,
      metadata
    });

    const metric = metricDefinitionFromCandidate(result.selected!, "wealth/income ratio");

    expect(metric).toEqual({
      id: "wnweal_p0p100_999_i",
      aliases: ["wealth/income ratio", "wnweal_p0p100_999_i"],
      variableCode: "wnweal_p0p100_999_i",
      indicator: "wnweal",
      description: "Net national wealth as a percentage of national income.",
      unitHint: "% of national income"
    });
  });
});
