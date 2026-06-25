import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { METRIC_DEFINITIONS } from "./constants.js";
import {
  formatAvailableVariablesMarkdown,
  formatMetadataMarkdown,
  formatRowsMarkdown,
  formatSeriesMarkdown,
  makeToolResponse,
  type ResponseFormat,
  type ToolResponse
} from "./format.js";
import { WidClient } from "./widClient.js";
import type {
  MetricDefinition,
  PaginatedResult,
  WidAvailableVariable,
  WidDataRow,
  WidMetadataRecord
} from "./types.js";

const ResponseFormatSchema = z.enum(["markdown", "json"]).default("markdown");
const LimitSchema = z.number().int().min(1).max(1000).default(100);
const OffsetSchema = z.number().int().min(0).default(0);

const GetSeriesSchema = z.object({
  country: z
    .string()
    .min(1)
    .describe("Country name or WID/ISO code, e.g. 'Brazil' or 'BR'."),
  metric: z
    .string()
    .min(1)
    .describe("Metric alias, e.g. 'wealth_income_ratio' or 'wealth/income ratio'."),
  start_year: z
    .number()
    .int()
    .min(1000)
    .max(9999)
    .optional()
    .describe("First year to return, e.g. 1980."),
  end_year: z
    .number()
    .int()
    .min(1000)
    .max(9999)
    .optional()
    .describe("Last year to return. Omit for latest available."),
  include_extrapolations: z
    .boolean()
    .default(true)
    .describe("Whether to include WID interpolated/extrapolated values."),
  limit: LimitSchema,
  offset: OffsetSchema,
  response_format: ResponseFormatSchema
}).strict();

const FetchDataSchema = z.object({
  countries: z
    .array(z.string().min(1))
    .min(1)
    .describe("Country names or WID/ISO codes, e.g. ['BR', 'FR']."),
  variable_codes: z
    .array(z.string().regex(/^[a-z]{6}_p[0-9.]+(p[0-9.]+)?_[0-9]{3}_[ijmfte]$/))
    .min(1)
    .describe("Exact WID data variable codes, e.g. ['wnweal_p0p100_999_i']."),
  start_year: z.number().int().min(1000).max(9999).optional(),
  end_year: z.number().int().min(1000).max(9999).optional(),
  include_extrapolations: z.boolean().default(true),
  limit: LimitSchema,
  offset: OffsetSchema,
  response_format: ResponseFormatSchema
}).strict();

const SearchIndicatorsSchema = z.object({
  countries: z
    .array(z.string().min(1))
    .min(1)
    .describe("Country names or WID/ISO codes to inspect."),
  indicators: z
    .array(z.string().regex(/^[a-z]{6}$|^all$/))
    .min(1)
    .default(["all"])
    .describe("Six-letter WID indicator codes, or ['all']."),
  limit: LimitSchema,
  offset: OffsetSchema,
  response_format: ResponseFormatSchema
}).strict();

const GetMetadataSchema = z.object({
  countries: z.array(z.string().min(1)).min(1),
  variable_codes: z
    .array(z.string().regex(/^[a-z]{6}_p[0-9.]+(p[0-9.]+)?_[0-9]{3}_[ijmfte]$/))
    .min(1),
  limit: LimitSchema,
  offset: OffsetSchema,
  response_format: ResponseFormatSchema
}).strict();

const ExplainCodesSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

type GetSeriesInput = z.input<typeof GetSeriesSchema>;
type FetchDataInput = z.input<typeof FetchDataSchema>;
type SearchIndicatorsInput = z.input<typeof SearchIndicatorsSchema>;
type GetMetadataInput = z.input<typeof GetMetadataSchema>;
type ExplainCodesInput = z.input<typeof ExplainCodesSchema>;

export interface WidDataProvider {
  getSeries(input: {
    country: string;
    metric: string;
    startYear?: number;
    endYear?: number;
    includeExtrapolations?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    metric: MetricDefinition;
    country: string;
    data: PaginatedResult<WidDataRow> & { rows: WidDataRow[] };
    metadata: WidMetadataRecord[];
  }>;
  fetchData(input: {
    countries: string[];
    variableCodes: string[];
    startYear?: number;
    endYear?: number;
    includeExtrapolations?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResult<WidDataRow> & { rows: WidDataRow[] }>;
  listAvailableVariables(input: {
    countries: string[];
    indicators: string[];
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResult<WidAvailableVariable>>;
  getMetadata(input: {
    countries: string[];
    variableCodes: string[];
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResult<WidMetadataRecord> & { records: WidMetadataRecord[] }>;
}

export function createWidToolHandlers(client: Partial<WidDataProvider>) {
  return {
    async wid_get_series(input: GetSeriesInput): Promise<ToolResponse<Record<string, unknown>>> {
      if (!client.getSeries) {
        throw new Error("wid_get_series requires a WID data client.");
      }
      const result = await client.getSeries({
        country: input.country,
        metric: input.metric,
        startYear: input.start_year,
        endYear: input.end_year,
        includeExtrapolations: input.include_extrapolations ?? true,
        limit: input.limit ?? 100,
        offset: input.offset ?? 0
      });

      const structuredContent = {
        country: result.country,
        metric: result.metric.id,
        description: result.metric.description,
        variableCode: result.metric.variableCode,
        total: result.data.total,
        count: result.data.count,
        offset: result.data.offset,
        hasMore: result.data.hasMore,
        nextOffset: result.data.nextOffset,
        rows: result.data.rows,
        metadata: result.metadata
      };

      return makeToolResponse(
        structuredContent,
        formatSeriesMarkdown({
          country: result.country,
          metric: result.metric,
          rows: result.data.rows,
          metadata: result.metadata,
          pagination: result.data
        }),
        (input.response_format ?? "markdown") as ResponseFormat
      );
    },

    async wid_fetch_data(input: FetchDataInput): Promise<ToolResponse<Record<string, unknown>>> {
      if (!client.fetchData) {
        throw new Error("wid_fetch_data requires a WID data client.");
      }
      const result = await client.fetchData({
        countries: input.countries,
        variableCodes: input.variable_codes,
        startYear: input.start_year,
        endYear: input.end_year,
        includeExtrapolations: input.include_extrapolations ?? true,
        limit: input.limit ?? 100,
        offset: input.offset ?? 0
      });
      const structuredContent = {
        total: result.total,
        count: result.count,
        offset: result.offset,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
        rows: result.rows
      };
      return makeToolResponse(
        structuredContent,
        formatRowsMarkdown({
          title: "WID Data",
          rows: result.rows,
          pagination: result
        }),
        (input.response_format ?? "markdown") as ResponseFormat
      );
    },

    async wid_search_indicators(
      input: SearchIndicatorsInput
    ): Promise<ToolResponse<Record<string, unknown>>> {
      if (!client.listAvailableVariables) {
        throw new Error("wid_search_indicators requires a WID data client.");
      }
      const result = await client.listAvailableVariables({
        countries: input.countries,
        indicators: input.indicators ?? ["all"],
        limit: input.limit ?? 100,
        offset: input.offset ?? 0
      });
      const structuredContent = {
        total: result.total,
        count: result.count,
        offset: result.offset,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
        items: result.items
      };
      return makeToolResponse(
        structuredContent,
        formatAvailableVariablesMarkdown({
          variables: result.items,
          pagination: result
        }),
        (input.response_format ?? "markdown") as ResponseFormat
      );
    },

    async wid_get_metadata(
      input: GetMetadataInput
    ): Promise<ToolResponse<Record<string, unknown>>> {
      if (!client.getMetadata) {
        throw new Error("wid_get_metadata requires a WID data client.");
      }
      const result = await client.getMetadata({
        countries: input.countries,
        variableCodes: input.variable_codes,
        limit: input.limit ?? 100,
        offset: input.offset ?? 0
      });
      const structuredContent = {
        total: result.total,
        count: result.count,
        offset: result.offset,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
        records: result.records
      };
      return makeToolResponse(
        structuredContent,
        formatMetadataMarkdown({
          records: result.records,
          pagination: result
        }),
        (input.response_format ?? "markdown") as ResponseFormat
      );
    },

    async wid_explain_codes(
      input: ExplainCodesInput
    ): Promise<ToolResponse<Record<string, unknown>>> {
      const structuredContent = {
        metrics: METRIC_DEFINITIONS,
        examples: [
          {
            question: "What is the wealth/income ratio of Brazil from 1980 up to now?",
            tool: "wid_get_series",
            arguments: {
              country: "Brazil",
              metric: "wealth_income_ratio",
              start_year: 1980
            }
          }
        ],
        codePattern:
          "Exact WID variable codes look like indicator_percentile_age_population, e.g. wnweal_p0p100_999_i."
      };
      const lines = [
        "# WID Code Guide",
        "",
        "Use `wid_get_series` for common plain-language metrics.",
        "",
        "## Built-in Metrics",
        ...METRIC_DEFINITIONS.flatMap((definition) => [
          "",
          `### ${definition.id}`,
          `- Variable: \`${definition.variableCode}\``,
          `- Meaning: ${definition.description}`,
          `- Unit hint: ${definition.unitHint}`,
          `- Aliases: ${definition.aliases.join(", ")}`
        ]),
        "",
        "Exact WID variable codes follow `indicator_percentile_age_population`."
      ];
      return makeToolResponse(
        structuredContent,
        lines.join("\n"),
        (input.response_format ?? "markdown") as ResponseFormat
      );
    }
  };
}

export function createWidServer(client: WidDataProvider = new WidClient()): McpServer {
  const server = new McpServer({
    name: "wid-mcp-server",
    version: "0.1.0"
  });
  registerWidTools(server, client);
  return server;
}

export function registerWidTools(server: McpServer, client: WidDataProvider): void {
  const handlers = createWidToolHandlers(client);

  server.registerTool(
    "wid_get_series",
    {
      title: "Get WID Series",
      description:
        "Fetch a common WID economic series by country and plain-language metric alias. Use this for questions like Brazil's wealth/income ratio from 1980 onward.",
      inputSchema: GetSeriesSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => handlers.wid_get_series(GetSeriesSchema.parse(input))
  );

  server.registerTool(
    "wid_fetch_data",
    {
      title: "Fetch WID Data",
      description:
        "Fetch WID data by exact variable code from the live WID service. Use wid_search_indicators first when the exact code is unknown.",
      inputSchema: FetchDataSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => handlers.wid_fetch_data(FetchDataSchema.parse(input))
  );

  server.registerTool(
    "wid_search_indicators",
    {
      title: "Search WID Indicators",
      description:
        "List available WID percentile, age, and population combinations for one or more countries and six-letter indicators.",
      inputSchema: SearchIndicatorsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => handlers.wid_search_indicators(SearchIndicatorsSchema.parse(input))
  );

  server.registerTool(
    "wid_get_metadata",
    {
      title: "Get WID Metadata",
      description:
        "Fetch WID metadata for exact variable codes, including units, descriptions, source notes, method notes, quality, and imputation.",
      inputSchema: GetMetadataSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input) => handlers.wid_get_metadata(GetMetadataSchema.parse(input))
  );

  server.registerTool(
    "wid_explain_codes",
    {
      title: "Explain WID Codes",
      description:
        "Explain built-in WID metric aliases and the exact WID variable-code pattern used by lower-level tools.",
      inputSchema: ExplainCodesSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input) => handlers.wid_explain_codes(ExplainCodesSchema.parse(input))
  );
}
