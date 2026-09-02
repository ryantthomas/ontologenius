import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Anthropic SDK exposes its helpers through a wildcard `exports` entry
    // that Vite's dependency scanner does not resolve. Node resolves it fine,
    // so keep the package external and let Node do it.
    server: { deps: { external: [/@anthropic-ai\/sdk/] } },
  },
});
