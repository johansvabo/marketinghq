import type { Config } from "drizzle-kit";
import "dotenv/config";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  ...(process.env.TURSO_DATABASE_URL
    ? {
        driver: "turso" as const,
        dbCredentials: {
          url: process.env.TURSO_DATABASE_URL!,
          authToken: process.env.TURSO_AUTH_TOKEN,
        },
      }
    : { dbCredentials: { url: process.env.DATABASE_URL ?? "file:./data/marketinghq.db" } }),
} satisfies Config;
