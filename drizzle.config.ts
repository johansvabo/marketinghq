import type { Config } from "drizzle-kit";
import "dotenv/config";
import { ensureLocalDbDir } from "./src/lib/db/ensure-dir";

const localUrl = process.env.DATABASE_URL ?? "file:./data/marketinghq.db";
if (!process.env.TURSO_DATABASE_URL) ensureLocalDbDir(localUrl);

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
    : { dbCredentials: { url: localUrl } }),
} satisfies Config;
