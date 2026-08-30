import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@libsql/client"],

  // The migration files are read from disk at runtime, so Next's tracer cannot
  // see them by static analysis — without this they are missing from the
  // deployment and the app cannot build its own schema on first boot.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**"],
  },
};

export default config;
