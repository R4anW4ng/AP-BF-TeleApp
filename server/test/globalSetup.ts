import { execSync } from "node:child_process";
import { TEST_ENV } from "./env.js";

export default function setup() {
  // Creates the test database if needed and applies all migrations.
  execSync("npx prisma migrate deploy", { env: { ...process.env, ...TEST_ENV }, stdio: "pipe" });
}
