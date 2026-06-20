import { defineConfig } from "vitest/config";

// Live tests hit the real Gemini API and a real browser — slow, networked, and
// gated on GOOGLE_GENERATIVE_AI_API_KEY. Kept out of the default `vitest run`.
export default defineConfig({
  esbuild: { keepNames: false },
  test: {
    include: ["test/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
