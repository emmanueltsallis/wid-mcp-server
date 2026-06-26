import { METRIC_DEFINITIONS } from "./constants.js";
import type {
  AssumptionPolicy,
  MetricCandidate,
  MetricDefinition,
  MetricResolutionAlternative,
  MetricResolveResult,
  PaginatedResult,
  ResolveMetricInput,
  SearchMetricsInput,
  WidAvailableVariable,
  WidMetadataRecord
} from "./types.js";

const VARIABLE_CODE_RE =
  /^[a-z]{6}_p(?:\d+(?:\.\d+)?)(?:p(?:\d+(?:\.\d+)?))?_[0-9]{3}_[ijmfte]$/i;
const VARIABLE_CODE_SEARCH_RE =
  /\b[a-z]{6}_p(?:\d+(?:\.\d+)?)(?:p(?:\d+(?:\.\d+)?))?_[0-9]{3}_[ijmfte]\b/i;
const SIX_LETTER_RE = /\b[a-z]{6}\b/gi;
const DEFAULT_RESOLVE_THRESHOLD = 120;
const MIN_RESOLVE_GAP = 20;
const WID_DEFAULT_INCOME_ASSUMPTIONS = [
  "income means average pretax national income",
  "percentile means the full adult distribution",
  "age means adults",
  "population unit means equal-split adults"
];
const INCOME_ALTERNATIVES: MetricResolutionAlternative[] = [
  {
    label: "income inequality",
    description: "Could mean Gini, top income shares, bottom income shares, or top-to-bottom ratios."
  },
  {
    label: "post-tax income",
    description: "Disposable or post-tax income after taxes and transfers."
  },
  {
    label: "labor income",
    description: "Income from labor rather than capital."
  },
  {
    label: "capital income",
    description: "Income from capital rather than labor."
  }
];
const INEQUALITY_ALTERNATIVES: MetricResolutionAlternative[] = [
  {
    label: "Gini coefficient",
    description: "Single-number inequality summary for the full distribution.",
    variableCodeHint: "gptinc_p0p100_992_j"
  },
  {
    label: "top income share",
    description: "Share received by a top group such as top 1% or top 10%."
  },
  {
    label: "bottom income share",
    description: "Share received by a bottom group such as bottom 50%."
  }
];
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "up",
  "what",
  "whats",
  "with"
]);

interface WeightedHint {
  code: string;
  score: number;
  matchedFields: string[];
}

interface DictionaryEntry {
  code: string;
  label: string;
  score: number;
  terms: string[];
}

interface ParsedMetricQuery {
  normalizedQuery: string;
  assumptionPolicy: AssumptionPolicy;
  exactVariableCode?: string;
  explicitIndicators: string[];
  seriesTypes: WeightedHint[];
  concepts: WeightedHint[];
  percentiles: WeightedHint[];
  ages: WeightedHint[];
  populations: WeightedHint[];
}

const SERIES_TYPES: DictionaryEntry[] = [
  {
    code: "w",
    label: "wealth-to-income ratio",
    score: 100,
    terms: [
      "wealth income ratio",
      "wealth to income ratio",
      "wealth-to-income ratio",
      "wealth/income ratio",
      "wealth as percent of income"
    ]
  },
  {
    code: "y",
    label: "wealth-to-GDP ratio",
    score: 100,
    terms: ["wealth gdp ratio", "wealth to gdp", "wealth-to-gdp", "wealth/gdp"]
  },
  {
    code: "g",
    label: "Gini coefficient",
    score: 95,
    terms: ["gini", "gini coefficient"]
  },
  {
    code: "r",
    label: "top-to-bottom ratio",
    score: 90,
    terms: ["top bottom ratio", "top to bottom ratio", "top 10 bottom 50 ratio"]
  },
  {
    code: "s",
    label: "share",
    score: 80,
    terms: ["share", "shares", "income share", "wealth share", "percentage", "fraction"]
  },
  {
    code: "a",
    label: "average",
    score: 76,
    terms: ["average", "mean", "per adult", "per capita", "average income", "average wealth"]
  },
  {
    code: "t",
    label: "threshold",
    score: 76,
    terms: ["threshold", "cutoff", "cut-off", "entry threshold"]
  },
  {
    code: "m",
    label: "total",
    score: 70,
    terms: ["total", "aggregate", "gross domestic product", "gdp", "national income"]
  },
  {
    code: "n",
    label: "population",
    score: 90,
    terms: ["population", "people", "inhabitants"]
  },
  {
    code: "x",
    label: "exchange rate",
    score: 90,
    terms: ["exchange rate", "ppp", "purchasing power parity", "market exchange"]
  },
  {
    code: "i",
    label: "index",
    score: 82,
    terms: ["index", "deflator", "price index"]
  },
  {
    code: "e",
    label: "total emissions",
    score: 82,
    terms: ["total emissions", "carbon emissions", "co2 emissions"]
  },
  {
    code: "k",
    label: "per capita emissions",
    score: 82,
    terms: ["per capita emissions", "emissions per capita"]
  },
  {
    code: "l",
    label: "group emissions",
    score: 82,
    terms: ["group emissions", "emissions of top", "emissions share"]
  }
];

const CONCEPTS: DictionaryEntry[] = [
  {
    code: "nweal",
    label: "national wealth",
    score: 96,
    terms: [
      "national wealth",
      "net national wealth",
      "market value national wealth",
      "wealth income ratio",
      "wealth to income"
    ]
  },
  {
    code: "hweal",
    label: "personal wealth",
    score: 88,
    terms: ["personal wealth", "household wealth", "wealth distribution", "wealth share", "wealth inequality"]
  },
  {
    code: "ptinc",
    label: "pretax national income",
    score: 90,
    terms: ["pretax income", "pre tax income", "pre-tax income", "pretax national income", "pre tax national income"]
  },
  {
    code: "pllin",
    label: "pretax labor income",
    score: 84,
    terms: ["labor income", "labour income", "pretax labor income", "pre tax labor income"]
  },
  {
    code: "pkkin",
    label: "pretax capital income",
    score: 84,
    terms: ["capital income", "pretax capital income", "pre tax capital income"]
  },
  {
    code: "diinc",
    label: "post-tax national income",
    score: 86,
    terms: ["post tax income", "post-tax income", "after tax income", "after-tax income"]
  },
  {
    code: "cainc",
    label: "disposable income",
    score: 84,
    terms: ["disposable income", "consumable income"]
  },
  {
    code: "fiinc",
    label: "fiscal income",
    score: 82,
    terms: ["fiscal income", "taxable income"]
  },
  {
    code: "fainc",
    label: "factor income",
    score: 82,
    terms: ["factor income"]
  },
  {
    code: "flinc",
    label: "factor labor income",
    score: 78,
    terms: ["factor labor income", "factor labour income"]
  },
  {
    code: "fkinc",
    label: "factor capital income",
    score: 78,
    terms: ["factor capital income"]
  },
  {
    code: "nninc",
    label: "net national income",
    score: 88,
    terms: ["net national income", "national income"]
  },
  {
    code: "gdpro",
    label: "gross domestic product",
    score: 92,
    terms: ["gdp", "gross domestic product"]
  },
  {
    code: "ndpro",
    label: "net domestic product",
    score: 78,
    terms: ["net domestic product"]
  },
  {
    code: "popul",
    label: "population",
    score: 95,
    terms: ["population", "people", "inhabitants"]
  },
  {
    code: "inyixx",
    label: "national income price index",
    score: 90,
    terms: ["price index", "deflator", "national income deflator"]
  },
  {
    code: "lcusp",
    label: "PPP exchange rate to USD",
    score: 88,
    terms: ["ppp usd", "ppp dollar", "purchasing power parity usd"]
  },
  {
    code: "lceup",
    label: "PPP exchange rate to EUR",
    score: 84,
    terms: ["ppp eur", "ppp euro", "purchasing power parity eur"]
  },
  {
    code: "lcyup",
    label: "PPP exchange rate to CNY",
    score: 84,
    terms: ["ppp cny", "ppp yuan", "purchasing power parity cny"]
  },
  {
    code: "lcusx",
    label: "market exchange rate to USD",
    score: 88,
    terms: ["market exchange usd", "market exchange dollar", "usd exchange rate"]
  },
  {
    code: "lceux",
    label: "market exchange rate to EUR",
    score: 84,
    terms: ["market exchange eur", "market exchange euro", "eur exchange rate"]
  },
  {
    code: "lcyux",
    label: "market exchange rate to CNY",
    score: 84,
    terms: ["market exchange cny", "market exchange yuan", "cny exchange rate"]
  }
];

export function isExactVariableCode(value: string): boolean {
  return VARIABLE_CODE_RE.test(value.trim());
}

export function candidateIndicatorsForQuery(input: {
  query: string;
  percentile?: string;
  age?: string;
  population?: string;
  assumptionPolicy?: AssumptionPolicy;
}): string[] {
  const parsed = parseMetricQuery(input);
  if (parsed.exactVariableCode) {
    return [parsed.exactVariableCode.split("_")[0]];
  }

  if (isBroadIncomeDefaultable(parsed.normalizedQuery, parsed.assumptionPolicy)) {
    return ["aptinc"];
  }

  const indicators = buildIndicatorHints(parsed).map((hint) => hint.code);
  return indicators.length > 0 ? unique(indicators) : ["all"];
}

export function rankMetricCandidates(input: SearchMetricsInput & {
  availableVariables: WidAvailableVariable[];
  metadata?: WidMetadataRecord[];
}): PaginatedResult<MetricCandidate> {
  const parsed = parseMetricQuery(input);
  const indicatorHints = new Map(
    buildIndicatorHints(parsed).map((hint) => [hint.code, hint])
  );
  const metadataByCode = new Map(
    (input.metadata ?? []).map((record) => [record.variableCode, record])
  );
  const exactCode = parsed.exactVariableCode;

  const candidates = input.availableVariables.flatMap((variable) => {
    if (variable.country !== input.country) {
      return [];
    }
    if (exactCode && variable.variableCode !== exactCode) {
      return [];
    }

    const indicatorHint = exactCode
      ? {
          code: variable.indicator,
          score: 500,
          matchedFields: [`exact variable code: ${exactCode}`]
        }
      : indicatorHints.get(variable.indicator);
    const metadata = metadataByCode.get(variable.variableCode);
    const metadataScore = scoreMetadata(parsed.normalizedQuery, metadata);

    if (!indicatorHint && metadataScore <= 0) {
      return [];
    }

    const matchedFields = new Set<string>(indicatorHint?.matchedFields ?? []);
    const score =
      (indicatorHint?.score ?? 0) +
      scoreDimension(variable.percentile, parsed.percentiles, "percentile", matchedFields) +
      scoreDimension(variable.age, parsed.ages, "age", matchedFields) +
      scoreDimension(variable.population, parsed.populations, "population", matchedFields) +
      scoreContextualDefaults(variable, parsed, matchedFields) +
      metadataScore;

    if (score <= 0) {
      return [];
    }

    const description = describeCandidate(variable, metadata);
    return [
      {
        country: variable.country,
        variableCode: variable.variableCode,
        indicator: variable.indicator,
        percentile: variable.percentile,
        age: variable.age,
        population: variable.population,
        score,
        confidence: confidenceForScore(score),
        description,
        matchedFields: [...matchedFields],
        ...(metadata ? { metadata } : {})
      }
    ];
  });

  const sorted = candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.variableCode.localeCompare(b.variableCode);
  });

  return paginate(sorted, input.limit, input.offset);
}

export function resolveMetricCandidate(input: SearchMetricsInput & {
  availableVariables: WidAvailableVariable[];
  metadata?: WidMetadataRecord[];
  confidenceThreshold?: number;
}): MetricResolveResult {
  const page = rankMetricCandidates({
    ...input,
    limit: Math.max(input.limit ?? 10, 10),
    offset: 0
  });
  return resolveRankedMetricCandidates({
    country: input.country,
    query: input.query,
    candidates: page.items,
    assumptionPolicy: input.assumptionPolicy,
    confidenceThreshold: input.confidenceThreshold
  });
}

export function resolveRankedMetricCandidates(input: {
  country: string;
  query: string;
  candidates: MetricCandidate[];
  assumptionPolicy?: AssumptionPolicy;
  confidenceThreshold?: number;
}): MetricResolveResult {
  const steering = getQuerySteering(input.query, input.assumptionPolicy);
  if (input.candidates.length === 0) {
    return {
      status: "not_found",
      country: input.country,
      query: input.query,
      candidates: [],
      assumptionPolicy: steering.assumptionPolicy,
      assumptions: steering.assumptions,
      alternatives: steering.alternatives,
      ...(steering.clarifyingQuestion
        ? { clarifyingQuestion: steering.clarifyingQuestion }
        : {}),
      message:
        "No verified WID variable matched the query. Try an exact WID variable code or a more specific concept such as 'pretax income share' or 'wealth/income ratio'."
    };
  }

  const [top, second] = input.candidates;
  const threshold = input.confidenceThreshold ?? DEFAULT_RESOLVE_THRESHOLD;
  const hasClearGap = !second || top.score - second.score >= MIN_RESOLVE_GAP;

  if (!steering.forceClarification && top.score >= threshold && hasClearGap) {
    return {
      status: "resolved",
      country: input.country,
      query: input.query,
      selected: top,
      candidates: input.candidates,
      assumptionPolicy: steering.assumptionPolicy,
      assumptions: steering.assumptions,
      alternatives: steering.alternatives,
      ...(steering.clarifyingQuestion
        ? { clarifyingQuestion: steering.clarifyingQuestion }
        : {}),
      message:
        steering.assumptions.length > 0
          ? `Resolved to ${top.variableCode} using WID default assumptions.`
          : `Resolved to ${top.variableCode}.`
    };
  }

  return {
    status: "ambiguous",
    country: input.country,
    query: input.query,
    candidates: input.candidates,
    assumptionPolicy: steering.assumptionPolicy,
    assumptions: steering.assumptions,
    alternatives: steering.alternatives,
    ...(steering.clarifyingQuestion
      ? { clarifyingQuestion: steering.clarifyingQuestion }
      : {}),
    message:
      "The query matched multiple WID variables or did not reach high confidence. Pick a variable code from the candidates, or make the query more specific."
  };
}

export function metricDefinitionFromCandidate(
  candidate: MetricCandidate,
  query?: string
): MetricDefinition {
  return {
    id: candidate.variableCode,
    aliases: unique([query, candidate.variableCode].filter(Boolean) as string[]),
    variableCode: candidate.variableCode,
    indicator: candidate.indicator,
    description: candidate.description,
    unitHint: candidate.metadata?.unit ?? "See WID metadata"
  };
}

export function metricDefinitionFromVariableCode(variableCode: string): MetricDefinition {
  const [indicator = ""] = variableCode.split("_");
  return {
    id: variableCode,
    aliases: [variableCode],
    variableCode,
    indicator,
    description: `WID series ${variableCode}`,
    unitHint: "See WID metadata"
  };
}

export function metricResolutionErrorMessage(result: MetricResolveResult): string {
  const candidateLines = result.candidates.slice(0, 8).map((candidate, index) => {
    return `${index + 1}. ${candidate.variableCode} (${candidate.description}; score ${candidate.score})`;
  });

  return [
    result.message,
    result.clarifyingQuestion ? `Clarifying question: ${result.clarifyingQuestion}` : undefined,
    result.assumptions.length > 0 ? "Assumptions:" : undefined,
    ...result.assumptions.map((assumption) => `- ${assumption}`),
    result.alternatives.length > 0 ? "Alternative interpretations:" : undefined,
    ...result.alternatives.map((alternative) => `- ${alternative.label}: ${alternative.description}`),
    candidateLines.length > 0 ? "Candidate WID variables:" : undefined,
    ...candidateLines,
    "Use wid_resolve_metric or wid_search_metrics to inspect choices, then pass the selected exact variable code to wid_get_series or wid_fetch_data."
  ]
    .filter(Boolean)
    .join("\n");
}

function parseMetricQuery(input: {
  query: string;
  percentile?: string;
  age?: string;
  population?: string;
  assumptionPolicy?: AssumptionPolicy;
}): ParsedMetricQuery {
  const normalizedQuery = normalizeText(input.query);
  const assumptionPolicy = input.assumptionPolicy ?? "strict";
  const exactVariableCode = extractExactVariableCode(input.query);
  const explicitIndicators = extractExplicitIndicators(input.query);
  const seriesTypes = scoreDictionary(SERIES_TYPES, normalizedQuery, "series type");
  const concepts = scoreDictionary(CONCEPTS, normalizedQuery, "concept");

  addFallbacks(normalizedQuery, seriesTypes, concepts);
  applyAssumptionPolicy({
    normalizedQuery,
    assumptionPolicy,
    seriesTypes,
    concepts
  });

  return {
    normalizedQuery,
    assumptionPolicy,
    ...(exactVariableCode ? { exactVariableCode } : {}),
    explicitIndicators,
    seriesTypes: mergeHints(seriesTypes),
    concepts: mergeHints(concepts),
    percentiles: mergeHints([
      ...parsePercentiles(normalizedQuery),
      ...defaultPolicyPercentiles(normalizedQuery, assumptionPolicy),
      ...(input.percentile
        ? [{ code: input.percentile, score: 40, matchedFields: [`percentile: ${input.percentile}`] }]
        : [])
    ]),
    ages: mergeHints([
      ...parseAges(normalizedQuery),
      ...defaultPolicyAges(normalizedQuery, assumptionPolicy),
      ...(input.age ? [{ code: input.age, score: 35, matchedFields: [`age: ${input.age}`] }] : [])
    ]),
    populations: mergeHints([
      ...parsePopulations(normalizedQuery),
      ...defaultPolicyPopulations(normalizedQuery, assumptionPolicy),
      ...(input.population
        ? [{ code: input.population, score: 35, matchedFields: [`population: ${input.population}`] }]
        : [])
    ])
  };
}

function buildIndicatorHints(parsed: ParsedMetricQuery): WeightedHint[] {
  if (parsed.exactVariableCode) {
    const indicator = parsed.exactVariableCode.split("_")[0];
    return [
      {
        code: indicator,
        score: 500,
        matchedFields: [`exact variable code: ${parsed.exactVariableCode}`]
      }
    ];
  }

  const hints: WeightedHint[] = parsed.explicitIndicators.map((indicator) => ({
    code: indicator,
    score: 180,
    matchedFields: [`indicator code: ${indicator}`]
  }));

  for (const seriesType of parsed.seriesTypes) {
    for (const concept of parsed.concepts) {
      hints.push({
        code: `${seriesType.code}${concept.code}`,
        score: seriesType.score + concept.score,
        matchedFields: [...seriesType.matchedFields, ...concept.matchedFields]
      });
    }
  }

  return mergeHints(hints);
}

function addFallbacks(
  normalizedQuery: string,
  seriesTypes: WeightedHint[],
  concepts: WeightedHint[]
): void {
  const hasPercentileWords =
    /\btop\b/.test(normalizedQuery) ||
    /\bbottom\b/.test(normalizedQuery) ||
    /\bmiddle\b/.test(normalizedQuery) ||
    /\bp\d/.test(normalizedQuery);
  const mentionsIncome = phraseInText(normalizedQuery, "income");
  const mentionsWealth = phraseInText(normalizedQuery, "wealth");

  if (mentionsIncome && concepts.length === 0) {
    concepts.push(
      hint("ptinc", 34, "concept: pretax national income"),
      hint("diinc", 30, "concept: post-tax national income"),
      hint("fiinc", 28, "concept: fiscal income")
    );
  }

  if (mentionsIncome && seriesTypes.length === 0) {
    seriesTypes.push(
      hint("s", 34, "series type: share"),
      hint("a", 32, "series type: average"),
      hint("g", 30, "series type: Gini coefficient")
    );
  }

  if (mentionsWealth && concepts.length === 0) {
    concepts.push(
      hint("hweal", 34, "concept: personal wealth"),
      hint("nweal", 30, "concept: national wealth")
    );
  }

  if (mentionsWealth && seriesTypes.length === 0) {
    seriesTypes.push(
      hint("s", 34, "series type: share"),
      hint("a", 32, "series type: average"),
      hint("g", 30, "series type: Gini coefficient")
    );
  }

  if (hasPercentileWords && seriesTypes.length === 0) {
    seriesTypes.push(hint("s", 44, "series type: share"));
  }

  if (seriesTypes.some((item) => item.code === "g") && concepts.length === 0) {
    concepts.push(
      hint("ptinc", 36, "concept: pretax national income"),
      hint("diinc", 32, "concept: post-tax national income"),
      hint("hweal", 30, "concept: personal wealth")
    );
  }

  if (concepts.some((item) => item.code === "popul") && seriesTypes.length === 0) {
    seriesTypes.push(hint("n", 90, "series type: population"));
  }

  if (concepts.some((item) => item.code === "gdpro") && seriesTypes.length === 0) {
    seriesTypes.push(hint("m", 70, "series type: total"));
  }
}

function applyAssumptionPolicy(input: {
  normalizedQuery: string;
  assumptionPolicy: AssumptionPolicy;
  seriesTypes: WeightedHint[];
  concepts: WeightedHint[];
}): void {
  if (!isBroadIncomeDefaultable(input.normalizedQuery, input.assumptionPolicy)) {
    return;
  }

  input.seriesTypes.push(
    hint("a", 140, "assumption: average income")
  );
  input.concepts.push(
    hint("ptinc", 140, "assumption: pretax national income")
  );
}

function defaultPolicyPercentiles(
  normalizedQuery: string,
  assumptionPolicy: AssumptionPolicy
): WeightedHint[] {
  return isBroadIncomeDefaultable(normalizedQuery, assumptionPolicy)
    ? [hint("p0p100", 80, "assumption: full distribution")]
    : [];
}

function defaultPolicyAges(
  normalizedQuery: string,
  assumptionPolicy: AssumptionPolicy
): WeightedHint[] {
  return isBroadIncomeDefaultable(normalizedQuery, assumptionPolicy)
    ? [hint("992", 80, "assumption: adults")]
    : [];
}

function defaultPolicyPopulations(
  normalizedQuery: string,
  assumptionPolicy: AssumptionPolicy
): WeightedHint[] {
  return isBroadIncomeDefaultable(normalizedQuery, assumptionPolicy)
    ? [hint("j", 80, "assumption: equal-split adults")]
    : [];
}

function getQuerySteering(
  query: string,
  requestedPolicy: AssumptionPolicy | undefined
): {
  assumptionPolicy: AssumptionPolicy;
  assumptions: string[];
  alternatives: MetricResolutionAlternative[];
  clarifyingQuestion?: string;
  forceClarification: boolean;
} {
  const assumptionPolicy = requestedPolicy ?? "strict";
  const normalizedQuery = normalizeText(query);

  if (isRiskyIncomeInequalityPrompt(normalizedQuery)) {
    return {
      assumptionPolicy,
      assumptions: [],
      alternatives: INEQUALITY_ALTERNATIVES,
      clarifyingQuestion:
        "When you say income inequality, do you mean a Gini coefficient, a top income share, or a bottom income share?",
      forceClarification: true
    };
  }

  if (isBroadIncomePrompt(normalizedQuery)) {
    if (assumptionPolicy === "wid_default") {
      return {
        assumptionPolicy,
        assumptions: WID_DEFAULT_INCOME_ASSUMPTIONS,
        alternatives: INCOME_ALTERNATIVES,
        forceClarification: false
      };
    }

    return {
      assumptionPolicy,
      assumptions: [],
      alternatives: INCOME_ALTERNATIVES,
      clarifyingQuestion:
        "When you say income, do you mean average pretax income, post-tax income, income inequality, labor income, capital income, or an income share?",
      forceClarification: false
    };
  }

  return {
    assumptionPolicy,
    assumptions: [],
    alternatives: [],
    forceClarification: false
  };
}

function isBroadIncomeDefaultable(
  normalizedQuery: string,
  assumptionPolicy: AssumptionPolicy
): boolean {
  return assumptionPolicy === "wid_default" && isBroadIncomePrompt(normalizedQuery);
}

function isBroadIncomePrompt(normalizedQuery: string): boolean {
  return (
    phraseInText(normalizedQuery, "income") &&
    !isRiskyIncomeInequalityPrompt(normalizedQuery) &&
    !phraseInText(normalizedQuery, "share") &&
    !phraseInText(normalizedQuery, "top") &&
    !phraseInText(normalizedQuery, "bottom") &&
    !phraseInText(normalizedQuery, "labor") &&
    !phraseInText(normalizedQuery, "labour") &&
    !phraseInText(normalizedQuery, "capital") &&
    !phraseInText(normalizedQuery, "post tax") &&
    !phraseInText(normalizedQuery, "post-tax") &&
    !phraseInText(normalizedQuery, "after tax") &&
    !phraseInText(normalizedQuery, "after-tax") &&
    !phraseInText(normalizedQuery, "disposable") &&
    !phraseInText(normalizedQuery, "fiscal")
  );
}

function isRiskyIncomeInequalityPrompt(normalizedQuery: string): boolean {
  return (
    phraseInText(normalizedQuery, "income") &&
    (phraseInText(normalizedQuery, "inequality") ||
      phraseInText(normalizedQuery, "distribution")) &&
    !phraseInText(normalizedQuery, "gini") &&
    !phraseInText(normalizedQuery, "top") &&
    !phraseInText(normalizedQuery, "bottom") &&
    !phraseInText(normalizedQuery, "share")
  );
}

function scoreDictionary(
  dictionary: DictionaryEntry[],
  normalizedQuery: string,
  fieldName: string
): WeightedHint[] {
  return dictionary.flatMap((entry) => {
    const matched = entry.terms.filter((term) => phraseInText(normalizedQuery, term));
    if (matched.length === 0) {
      return [];
    }
    return [
      {
        code: entry.code,
        score: entry.score + Math.min(12, (matched.length - 1) * 4),
        matchedFields: [`${fieldName}: ${entry.label}`]
      }
    ];
  });
}

function parsePercentiles(normalizedQuery: string): WeightedHint[] {
  const exact = normalizedQuery.match(/\bp\d+(?:\.\d+)?p\d+(?:\.\d+)?\b/);
  if (exact) {
    return [hint(exact[0], 45, `percentile: ${exact[0]}`)];
  }

  const topMatch = normalizedQuery.match(/\btop\s+(\d+(?:\.\d+)?)\s*(?:percent|pct|%)?/);
  if (topMatch) {
    const top = Number(topMatch[1]);
    if (Number.isFinite(top) && top > 0 && top <= 100) {
      return [hint(`p${formatPercentileNumber(100 - top)}p100`, 45, `percentile: top ${topMatch[1]}%`)];
    }
  }

  const bottomMatch = normalizedQuery.match(/\bbottom\s+(\d+(?:\.\d+)?)\s*(?:percent|pct|%)?/);
  if (bottomMatch) {
    const bottom = Number(bottomMatch[1]);
    if (Number.isFinite(bottom) && bottom > 0 && bottom <= 100) {
      return [hint(`p0p${formatPercentileNumber(bottom)}`, 45, `percentile: bottom ${bottomMatch[1]}%`)];
    }
  }

  if (phraseInText(normalizedQuery, "middle 40")) {
    return [hint("p50p90", 42, "percentile: middle 40%")];
  }

  if (
    phraseInText(normalizedQuery, "entire population") ||
    phraseInText(normalizedQuery, "whole population") ||
    phraseInText(normalizedQuery, "all population") ||
    phraseInText(normalizedQuery, "all adults") ||
    phraseInText(normalizedQuery, "gini")
  ) {
    return [hint("p0p100", 30, "percentile: full distribution")];
  }

  return [];
}

function parseAges(normalizedQuery: string): WeightedHint[] {
  if (
    phraseInText(normalizedQuery, "adult") ||
    phraseInText(normalizedQuery, "adults") ||
    phraseInText(normalizedQuery, "over 20") ||
    phraseInText(normalizedQuery, "20 plus")
  ) {
    return [hint("992", 35, "age: adults")];
  }
  if (
    phraseInText(normalizedQuery, "working age") ||
    phraseInText(normalizedQuery, "20 to 64") ||
    phraseInText(normalizedQuery, "20 64")
  ) {
    return [hint("996", 35, "age: working age")];
  }
  if (
    phraseInText(normalizedQuery, "all ages") ||
    phraseInText(normalizedQuery, "per capita") ||
    phraseInText(normalizedQuery, "population")
  ) {
    return [hint("999", 35, "age: all ages")];
  }
  return [];
}

function parsePopulations(normalizedQuery: string): WeightedHint[] {
  if (phraseInText(normalizedQuery, "equal split") || phraseInText(normalizedQuery, "equal-split")) {
    return [hint("j", 35, "population: equal-split adults")];
  }
  if (phraseInText(normalizedQuery, "male")) {
    return [hint("m", 35, "population: male")];
  }
  if (phraseInText(normalizedQuery, "female") || phraseInText(normalizedQuery, "women")) {
    return [hint("f", 35, "population: female")];
  }
  if (phraseInText(normalizedQuery, "tax unit") || phraseInText(normalizedQuery, "tax units")) {
    return [hint("t", 35, "population: tax units")];
  }
  if (
    phraseInText(normalizedQuery, "individual") ||
    phraseInText(normalizedQuery, "individuals") ||
    phraseInText(normalizedQuery, "per capita") ||
    phraseInText(normalizedQuery, "population")
  ) {
    return [hint("i", 35, "population: individuals")];
  }
  return [];
}

function scoreDimension(
  code: string,
  hints: WeightedHint[],
  label: string,
  matchedFields: Set<string>
): number {
  if (hints.length === 0) {
    return defaultDimensionPreference(code, label);
  }

  const match = hints.find((hintItem) => hintItem.code === code);
  if (!match) {
    return -35;
  }

  for (const field of match.matchedFields) {
    matchedFields.add(field);
  }
  return match.score;
}

function defaultDimensionPreference(code: string, label: string): number {
  if (label === "percentile" && code === "p0p100") return 8;
  if (label === "age" && (code === "999" || code === "992")) return 6;
  if (label === "population" && (code === "i" || code === "j")) return 6;
  return 0;
}

function scoreContextualDefaults(
  variable: WidAvailableVariable,
  parsed: ParsedMetricQuery,
  matchedFields: Set<string>
): number {
  if (!isDistributionalIndicator(variable.indicator)) {
    return 0;
  }

  let score = 0;
  if (parsed.ages.length === 0 && variable.age === "992") {
    matchedFields.add("default: adult distribution");
    score += 24;
  }
  if (parsed.populations.length === 0 && variable.population === "j") {
    matchedFields.add("default: equal-split distribution");
    score += 12;
  }
  return score;
}

function isDistributionalIndicator(indicator: string): boolean {
  return ["a", "b", "g", "p", "r", "s", "t"].includes(indicator[0]);
}

function scoreMetadata(normalizedQuery: string, metadata?: WidMetadataRecord): number {
  if (!metadata) {
    return 0;
  }
  const metadataText = normalizeText(
    [
      metadata.shortName,
      metadata.shortDescription,
      metadata.technicalDescription,
      metadata.type,
      metadata.typeDescription,
      metadata.population,
      metadata.age,
      metadata.unit
    ]
      .filter(Boolean)
      .join(" ")
  );
  const tokens = tokenize(normalizedQuery);
  if (tokens.length === 0 || !metadataText) {
    return 0;
  }
  return tokens.filter((token) => metadataText.includes(token)).length * 4;
}

function describeCandidate(
  variable: WidAvailableVariable,
  metadata?: WidMetadataRecord
): string {
  return (
    metadata?.shortDescription ??
    metadata?.shortName ??
    indicatorDescription(variable.indicator) ??
    `WID series ${variable.variableCode}`
  );
}

function indicatorDescription(indicator: string): string | undefined {
  const type = SERIES_TYPES.find((entry) => entry.code === indicator[0]);
  const concept = CONCEPTS.find((entry) => entry.code === indicator.slice(1));
  if (!type && !concept) {
    return undefined;
  }
  return [type?.label, concept?.label].filter(Boolean).join(" of ");
}

function confidenceForScore(score: number): "high" | "medium" | "low" {
  if (score >= 120) return "high";
  if (score >= 70) return "medium";
  return "low";
}

function extractExactVariableCode(query: string): string | undefined {
  const normalized = query.trim().toLowerCase();
  if (VARIABLE_CODE_RE.test(normalized)) {
    return normalized;
  }
  return query.toLowerCase().match(VARIABLE_CODE_SEARCH_RE)?.[0];
}

function extractExplicitIndicators(query: string): string[] {
  const matches = query.toLowerCase().match(SIX_LETTER_RE) ?? [];
  const dictionaryWords = new Set([
    ...SERIES_TYPES.flatMap((entry) => entry.terms.flatMap((term) => tokenize(normalizeText(term)))),
    ...CONCEPTS.flatMap((entry) => entry.terms.flatMap((term) => tokenize(normalizeText(term))))
  ]);
  return unique(
    matches.filter((match) => {
      if (METRIC_DEFINITIONS.some((definition) => definition.indicator === match)) {
        return true;
      }
      return !dictionaryWords.has(match);
    })
  );
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9.%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function phraseInText(normalizedText: string, rawPhrase: string): boolean {
  const phrase = normalizeText(rawPhrase);
  if (!phrase) {
    return false;
  }
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(phrase)}(\\s|$)`);
  return pattern.test(normalizedText);
}

function mergeHints(hints: WeightedHint[]): WeightedHint[] {
  const byCode = new Map<string, WeightedHint>();
  for (const item of hints) {
    const existing = byCode.get(item.code);
    if (!existing) {
      byCode.set(item.code, {
        code: item.code,
        score: item.score,
        matchedFields: unique(item.matchedFields)
      });
      continue;
    }
    existing.score = Math.max(existing.score, item.score);
    existing.matchedFields = unique([...existing.matchedFields, ...item.matchedFields]);
  }
  return [...byCode.values()].sort((a, b) => b.score - a.score);
}

function hint(code: string, score: number, matchedField: string): WeightedHint {
  return { code, score, matchedFields: [matchedField] };
}

function paginate<T>(
  items: T[],
  requestedLimit: number | undefined,
  requestedOffset: number | undefined
): PaginatedResult<T> {
  const offset = Math.max(0, requestedOffset ?? 0);
  const limit = Math.min(Math.max(1, requestedLimit ?? 100), 1000);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    total: items.length,
    count: pageItems.length,
    offset,
    items: pageItems,
    hasMore: nextOffset < items.length,
    ...(nextOffset < items.length ? { nextOffset } : {})
  };
}

function formatPercentileNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
