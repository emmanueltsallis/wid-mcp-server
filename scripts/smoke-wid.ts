import { createDefaultWidProvider } from "../src/dataProvider.js";

async function main(): Promise<void> {
  const client = createDefaultWidProvider();
  const result = await client.getSeries({
    country: "Brazil",
    metric: "wealth_income_ratio",
    startYear: 1980,
    includeExtrapolations: true,
    limit: 10,
    offset: 0
  });

  const first = result.data.rows[0];
  const last = result.data.rows[result.data.rows.length - 1];
  console.log(
    JSON.stringify(
      {
        metric: result.metric.id,
        country: result.country,
        variableCode: result.metric.variableCode,
        returnedRows: result.data.count,
        totalRows: result.data.total,
        first,
        last,
        metadata: result.metadata[0]
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
