// Test runner configuration: resolves the "@" alias and compiles JSX for component tests.
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    fileParallelism: false,
  },
});
