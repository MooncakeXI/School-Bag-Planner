import "dotenv/config";
import { execSync } from "node:child_process";

// Runs once, in its own process, before any integration test file. Applies
// checked-in migrations to the test database (never the dev one).
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (check .env)");

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
