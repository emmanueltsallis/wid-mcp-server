#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createWidServer } from "./tools.js";

async function main(): Promise<void> {
  const server = createWidServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`wid-mcp-server failed to start: ${message}\n`);
  process.exit(1);
});
