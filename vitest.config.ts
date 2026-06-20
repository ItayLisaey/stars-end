import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disable esbuild keepNames: it injects a `__name` helper into named (inner)
  // functions, which breaks code serialized to the browser via page.evaluate
  // (the injected xpath helpers). The production tsc build never does this.
  esbuild: { keepNames: false },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Live model tests are opt-in: they require GOOGLE_GENERATIVE_AI_API_KEY.
    exclude: ["node_modules", "dist", "test/live/**"],
    environment: "node",
  },
});
