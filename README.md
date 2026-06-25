# WID MCP Server

Unofficial local MCP server for live [World Inequality Database](https://wid.world/) queries.

This server does **not** bundle or redistribute the WID dataset. It is a small adapter that asks WID for current data and returns structured rows to an MCP client.

## Why This Works Without Bundling Data

By default, the server uses the official WID R package:

```text
AI client -> this MCP -> local R package `wid` -> WID data
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
  "metric": "wealth_income_ratio",
  "start_year": 1980
}
```

The server maps that to:

- Country: `Brazil` -> `BR`
- Metric: `wealth_income_ratio` -> `wnweal_p0p100_999_i`
- Output: clean rows with year, value, unit when available, and extrapolation flag when available

## Tools

- `wid_get_series`: high-level natural metric lookup. Use this for Brazil wealth/income ratio style questions.
- `wid_search_indicators`: discover available WID variable combinations for countries and indicators.
- `wid_fetch_data`: fetch exact WID variable codes.
- `wid_get_metadata`: fetch units, source, method, quality, and description metadata.
- `wid_explain_codes`: explain built-in aliases and WID code structure.

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
