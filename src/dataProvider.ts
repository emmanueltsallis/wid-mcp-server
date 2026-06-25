import { RwidClient } from "./rWidClient.js";
import { WidClient } from "./widClient.js";
import type { WidDataProvider } from "./types.js";

interface CreateDefaultProviderOptions {
  env?: Record<string, string | undefined>;
}

export function createDefaultWidProvider(
  options: CreateDefaultProviderOptions = {}
): WidDataProvider {
  const env = options.env ?? process.env;
  const backend = env.WID_BACKEND?.trim().toLowerCase() ?? "auto";

  if (backend === "r") {
    return new RwidClient({ rscriptBin: env.WID_RSCRIPT_BIN });
  }

  if (backend === "api") {
    return new WidClient({ env });
  }

  if (backend !== "auto") {
    throw new Error("WID_BACKEND must be one of: auto, r, api.");
  }

  if (env.WID_API_KEY_BASE64?.trim() || env.WID_API_KEY_HEX?.trim()) {
    return new WidClient({ env });
  }

  return new RwidClient({ rscriptBin: env.WID_RSCRIPT_BIN });
}
