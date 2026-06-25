import { describe, expect, it } from "vitest";

import { createDefaultWidProvider } from "../src/dataProvider.js";
import { RwidClient } from "../src/rWidClient.js";
import { WidClient } from "../src/widClient.js";

describe("default WID provider selection", () => {
  it("uses direct API mode when WID API credentials are configured", () => {
    const provider = createDefaultWidProvider({
      env: { WID_API_KEY_BASE64: "abc123" }
    });

    expect(provider).toBeInstanceOf(WidClient);
  });

  it("falls back to the official R package backend when no API key is configured", () => {
    const provider = createDefaultWidProvider({ env: {} });

    expect(provider).toBeInstanceOf(RwidClient);
  });

  it("respects explicit WID_BACKEND selection", () => {
    expect(createDefaultWidProvider({ env: { WID_BACKEND: "r" } })).toBeInstanceOf(
      RwidClient
    );
    expect(
      createDefaultWidProvider({
        env: { WID_BACKEND: "api", WID_API_KEY_BASE64: "abc123" }
      })
    ).toBeInstanceOf(WidClient);
  });
});
