import "dotenv/config";

// Every test process talks to the throwaway test database, never the dev one.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not set (check .env)");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
