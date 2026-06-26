import type {
  MetricCandidate,
  WidAvailableVariable,
  WidSeriesFallback
} from "./types.js";

interface VariableCodeParts {
  indicator: string;
  percentile: string;
  age: string;
  population: string;
}

export function sameConceptFallbackCandidates(
  requestedVariableCode: string,
  candidates: MetricCandidate[]
): MetricCandidate[] {
  const requested = splitWidVariableCode(requestedVariableCode);
  return candidates
    .filter((candidate) => isSameConceptFallback(requested, candidate))
    .sort((a, b) => {
      const scoreDiff =
        fallbackScore(b, requested) - fallbackScore(a, requested);
      if (scoreDiff !== 0) return scoreDiff;
      if (b.score !== a.score) return b.score - a.score;
      return a.variableCode.localeCompare(b.variableCode);
    });
}

export function availableVariablesToFallbackCandidates(
  requestedVariableCode: string,
  variables: WidAvailableVariable[]
): MetricCandidate[] {
  const requested = splitWidVariableCode(requestedVariableCode);
  return variables
    .filter((variable) => isSameConceptFallback(requested, variable))
    .map((variable) => {
      const matchedFields = [
        `fallback: same indicator ${requested.indicator}`,
        `fallback: same percentile ${requested.percentile}`
      ];
      const changedDimensions = changedDimensionsBetweenParts(requested, variable);
      if (changedDimensions.length > 0) {
        matchedFields.push(`fallback: changed ${changedDimensions.join(", ")}`);
      }
      return {
        country: variable.country,
        variableCode: variable.variableCode,
        indicator: variable.indicator,
        percentile: variable.percentile,
        age: variable.age,
        population: variable.population,
        score: fallbackScore(variable, requested),
        confidence: "medium" as const,
        description: `WID series ${variable.variableCode}`,
        matchedFields
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.variableCode.localeCompare(b.variableCode);
    });
}

export function buildSeriesFallback(
  requestedVariableCode: string,
  selectedVariableCode: string
): WidSeriesFallback {
  const requested = splitWidVariableCode(requestedVariableCode);
  const selected = splitWidVariableCode(selectedVariableCode);
  const changedDimensions = changedDimensionsBetweenParts(requested, selected);
  return {
    requestedVariableCode,
    selectedVariableCode,
    reason: "no_rows_for_requested_window",
    changedDimensions,
    message: [
      `Requested variable ${requestedVariableCode} returned no rows for the requested window.`,
      `Fetched ${selectedVariableCode} instead because it keeps the same indicator and percentile.`
    ].join(" ")
  };
}

export function splitWidVariableCode(variableCode: string): VariableCodeParts {
  const [indicator = "", percentile = "", age = "", population = ""] =
    variableCode.split("_");
  return { indicator, percentile, age, population };
}

function isSameConceptFallback(
  requested: VariableCodeParts,
  candidate: Pick<
    MetricCandidate | WidAvailableVariable,
    "variableCode" | "indicator" | "percentile" | "age" | "population"
  >
): boolean {
  return (
    candidate.variableCode !==
      [
        requested.indicator,
        requested.percentile,
        requested.age,
        requested.population
      ].join("_") &&
    candidate.indicator === requested.indicator &&
    candidate.percentile === requested.percentile
  );
}

function fallbackScore(
  candidate: Pick<MetricCandidate | WidAvailableVariable, "age" | "population">,
  requested: VariableCodeParts
): number {
  let score = 0;
  if (candidate.age === requested.age) score += 100;
  if (candidate.population === requested.population) score += 80;
  if (candidate.age === "992") score += 10;
  if (candidate.population === "j") score += 8;
  if (candidate.age === "999") score += 4;
  if (candidate.population === "i") score += 4;
  return score;
}

function changedDimensionsBetweenParts(
  requested: VariableCodeParts,
  selected: Pick<VariableCodeParts, "indicator" | "percentile" | "age" | "population">
): string[] {
  const changed: string[] = [];
  if (requested.indicator !== selected.indicator) changed.push("indicator");
  if (requested.percentile !== selected.percentile) changed.push("percentile");
  if (requested.age !== selected.age) changed.push("age");
  if (requested.population !== selected.population) changed.push("population");
  return changed;
}
