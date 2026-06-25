import type { MetricDefinition } from "./types.js";

export const WID_API_BASE_URL =
  "https://rfap9nitz6.execute-api.eu-west-1.amazonaws.com/prod";

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

export const COUNTRY_ALIASES: Record<string, string> = {
  brazil: "BR",
  brasil: "BR",
  france: "FR",
  germany: "DE",
  "united states": "US",
  usa: "US",
  us: "US",
  "united kingdom": "GB",
  uk: "GB",
  china: "CN",
  india: "IN",
  world: "WO"
};

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "wealth_income_ratio",
    aliases: [
      "wealth_income_ratio",
      "wealth/income ratio",
      "wealth to income ratio",
      "wealth-income ratio",
      "national wealth income ratio",
      "national wealth as percent of income",
      "market-value national wealth"
    ],
    variableCode: "wnweal_p0p100_999_i",
    indicator: "wnweal",
    description:
      "Market-value national wealth as a percentage of national income.",
    unitHint: "% of national income"
  }
];
