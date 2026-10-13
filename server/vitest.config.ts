import { defineConfig } from "vitest/config";
import { TEST_ENV } from "./test/env.js";

export default defineConfig({
  test: {
    env: { ...TEST_ENV },
    globalSetup: ["./test/globalSetup.ts"],
    // Integration tests share one database.
    fileParallelism: false,
  },
});
