# WID MCP Server

Unofficial local MCP server for live [World Inequality Database](https://wid.world/) queries.

This server does **not** bundle or redistribute the WID dataset. It is a small adapter that calls WID's live data service, normalizes the result, and returns structured data to an MCP client.

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
- Source: WID live data service
- Output: clean rows with year, value, unit, and extrapolation flag

## Tools

- `wid_get_series`: high-level natural metric lookup. Use this for Brazil wealth/income ratio style questions.
- `wid_search_indicators`: discover available WID variable combinations for countries and indicators.
- `wid_fetch_data`: fetch exact WID variable codes.
- `wid_get_metadata`: fetch units, source, method, quality, and description metadata.
- `wid_explain_codes`: explain built-in aliases and WID code structure.

## Setup

```bash
npm install
npm run build
```

WID's live service may require an API credential. Keep credentials in your MCP client environment, never in source code:

```bash
export WID_API_KEY_BASE64="..."
# or
export WID_API_KEY_HEX="..."
```

## MCP Config

Example stdio configuration:

```json
{
  "mcpServers": {
    "wid": {
      "command": "node",
      "args": ["/path/to/wid-mcp-server/dist/index.js"],
      "env": {
        "WID_API_KEY_BASE64": "..."
      }
    }
  }
}
```

## Smoke Test

After setting `WID_API_KEY_BASE64` or `WID_API_KEY_HEX`:

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

This project is not affiliated with, endorsed by, or maintained by WID.world or the World Inequality Lab.
