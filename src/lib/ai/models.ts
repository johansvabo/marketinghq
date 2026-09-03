/**
 * The model catalogue, with no imports of its own.
 *
 * client.ts pulls in the database (for the settings-backed override) and the
 * database pulls in node:fs for the local SQLite file — fine on the server,
 * fatal in a browser bundle. The model picker is a client component, so the
 * list it renders lives here instead, and client.ts re-exports it.
 */
export const AVAILABLE_MODELS = [
  { id: "claude-opus-5", label: "Opus 5", hint: "Most capable. The default." },
  { id: "claude-sonnet-5", label: "Sonnet 5", hint: "Faster, nearly as capable — the best fallback." },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Tuned for long-form writing." },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", hint: "Fastest and cheapest, less depth." },
] as const;
