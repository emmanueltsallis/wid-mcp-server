# WID MCP Server

Unofficial local MCP server for live [World Inequality Database](https://wid.world/) queries.

This server does **not** bundle or redistribute the WID dataset. It is a small adapter that asks WID for current data and returns structured rows to an MCP client.

## Why This Works Without Bundling Data

By default, the server uses the official WID R package:

```text
Client -> WID MCP -> local R package `wid` -> WID data
```

That keeps this repo clean:

- No WID dataset is committed.
- No WID internal credential is committed.
- Users get the same public access path exposed by the official R package.

If you have a WID API credential, the server can also use direct API mode.

## Example

Ask your MCP client:

> What is the wealth/income ratio of Brazil from 1980 up to now?

The MCP can call:

```json
{
  "country": "Brazil",
  "metric": "wealth/income ratio",
  "start_year": 1980
}
```

The server maps that to:

- Country: `Brazil` -> `BR`
- Metric: `wealth_income_ratio` -> `wnweal_p0p100_999_i`
- Output: clean rows with year, value, unit when available, and extrapolation flag when available

For less obvious prompts, ask the MCP to resolve first:

```json
{
  "country": "Brazil",
  "query": "top 1% pre-tax income share"
}
```

`wid_resolve_metric` returns one exact WID variable code only when confidence is high. If a prompt is broad, such as `income`, it returns candidate variables instead of guessing.

For broad prompts, the AI client should pass short context distilled from the conversation:

```json
{
  "country": "Brazil",
  "query": "income",
  "context": "The user is comparing average income levels across countries."
}
```

That gives the MCP enough information to interpret `income` as average pretax national income for equal-split adults over the full adult distribution. The response includes the interpretation and alternatives, so the caller can disclose or revise the choice.

If the context says the user is studying top concentration, the resolver steers toward income-share variables instead. If the context is still not enough, the resolver returns a focused clarification question.

## World Region Defaults

WID world aggregates use currency-suffixed region codes:

- `WO-PPP`: world aggregate in PPP (purchasing power parity) terms.
- `WO-MER`: world aggregate in market-exchange-rate terms.

Broad country aliases such as `World`, `global`, `worldwide`, and `whole world` default to `WO-PPP`, which is the better default for global inequality, real distribution, and purchasing-power comparisons.

When the country is a world alias and the prompt or `context` clearly points to market valuation, the server resolves to `WO-MER` instead. Examples include `market exchange rates`, `market valuation`, `financial wealth`, `USD balance sheets`, `global asset prices`, and explicit `MER` wording.

Callers can bypass this resolver by passing `WO-PPP` or `WO-MER` explicitly.

## Tools

- `wid_get_series`: fetch a series by natural-language metric, built-in alias, or exact WID variable code. Optional `context` helps resolve broad prompts using conversation context.
- `wid_search_metrics`: search natural-language metric text against WID code semantics and live country availability.
- `wid_resolve_metric`: resolve a natural-language metric to one exact WID variable code when confidence is high. Returns interpretation assumptions, alternatives, and a clarifying question when useful.
- `wid_search_indicators`: discover available WID variable combinations for countries and indicators.
- `wid_fetch_data`: fetch exact WID variable codes.
- `wid_get_metadata`: fetch units, source, method, quality, and description metadata.
- `wid_explain_codes`: explain built-in aliases and WID code structure.

## How Metric Resolution Works

WID variable codes encode:

```text
series type + concept _ percentile _ age _ population
```

For example, `sptinc_p99p100_992_j` means:

- `s`: share
- `ptinc`: pretax national income
- `p99p100`: top 1%
- `992`: adults
- `j`: equal-split adults

The server uses WID's public code structure as a dictionary, then verifies possible variables against live WID availability for the requested country. It fetches metadata only for the best candidates, so it does not download or store the WID dataset.

If `wid_get_series` resolves or receives a specific variable code but that exact combo returns no rows for the requested year window, it tries the nearest available same-concept variables. Same-concept fallback means the indicator and percentile stay the same, while age or population unit may vary. The response includes a `fallback` object explaining the requested code, selected code, and changed dimensions. The server does not silently switch to a different indicator or percentile.

## Context and Clarification

The MCP server does not automatically see the full chat history. The AI client should pass a short `context` string when the user's metric is broad.

Good context examples:

- `The user is comparing average income levels across countries.`
- `The user is studying the top 1% pre-tax income share.`
- `The user is asking about income inequality but has not chosen Gini or top shares yet.`

With enough context, the resolver fetches the likely variable and returns the assumptions. For average income context, those assumptions are:

- income means average pretax national income
- percentile means the full adult distribution
- age means adults
- population unit means equal-split adults

Without enough context, broad prompts require clarification. For example, `income inequality` can mean Gini, top income shares, bottom income shares, or top-to-bottom ratios, so the resolver returns alternatives instead of choosing silently.

`assumption_policy` is still accepted for backward compatibility, but new clients should prefer `context`.

## Setup

Install Node dependencies and build:

```bash
npm install
npm run build
```

Install the official WID R package:

```r
install.packages("wid")
```

The default backend is `auto`:

- If `WID_API_KEY_BASE64` or `WID_API_KEY_HEX` is set, use direct API mode.
- Otherwise use official R package mode.

You can force R mode:

```bash
export WID_BACKEND=r
```

If `Rscript` is not on your `PATH`, set:

```bash
export WID_RSCRIPT_BIN="/path/to/Rscript"
```

## Optional Direct API Mode

Direct API mode is optional and requires a WID API credential:

```bash
export WID_BACKEND=api
export WID_API_KEY_BASE64="..."
# or
export WID_API_KEY_HEX="..."
```

No API credential is required when using the official R package backend.

## MCP Config

Example stdio configuration using R mode:

```json
{
  "mcpServers": {
    "wid": {
      "command": "node",
      "args": ["/path/to/wid-mcp-server/dist/index.js"],
      "env": {
        "WID_BACKEND": "r"
      }
    }
  }
}
```

Example with a custom `Rscript` path:

```json
{
  "mcpServers": {
    "wid": {
      "command": "node",
      "args": ["/path/to/wid-mcp-server/dist/index.js"],
      "env": {
        "WID_BACKEND": "r",
        "WID_RSCRIPT_BIN": "/usr/local/bin/Rscript"
      }
    }
  }
}
```

## Smoke Test

After installing the official R package:

```bash
npm run smoke
```

The smoke test fetches Brazil's `wealth_income_ratio` from 1980 onward and prints a compact JSON sample.

## Development

```bash
npm test -- --run
npm run build
```

The unit tests use fake WID responses. The smoke script is the live WID check.

## Data Source

Data comes from [WID.world](https://wid.world/), an open-access inequality database maintained by the World Inequality Lab and collaborators.

Useful WID references:

- [WID data page](https://wid.world/data/)
- [WID codes dictionary](https://wid.world/codes-dictionary/)
- [WID methodology](https://wid.world/methodology/)
- [Official WID R package](https://cloud.r-project.org/package=wid)

This project is not affiliated with, endorsed by, or maintained by WID.world or the World Inequality Lab.
