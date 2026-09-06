import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/status/**",
        "src/persistence/**",
        "src/domain/product.ts",
      ],
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 60,
      },
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
