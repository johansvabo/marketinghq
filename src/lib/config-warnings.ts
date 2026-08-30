/**
 * Configuration mistakes that lock you out, so they have to be detectable from
 * outside the authenticated area. A malformed AUTH_SECRET is the sharp case:
 * the passcode can never match, and the diagnostics page that would explain it
 * sits behind the very login it breaks.
 */
/**
 * Spots the common paste mistakes: the variable's own name pasted in with its
 * value, several variables pasted into one box, or stray line breaks.
 */
export function looksLikeAPastedBlock(value: string | undefined): string | null {
  if (!value) return null;

  if (/\r|\n/.test(value)) return "contains more than one line — it looks like several variables were pasted into one box.";
  if (/^\s*AUTH_SECRET\b/i.test(value)) return "starts with its own name, so the name got pasted in along with the value.";
  if (/\b(ENCRYPTION_KEY|CRON_SECRET|MCP_TOKEN|TURSO_[A-Z_]+|ANTHROPIC_API_KEY)\b/i.test(value)) {
    return "contains the name of another variable, so several were pasted into one box.";
  }
  if (/\s{2,}/.test(value)) return "contains runs of spaces, which a generated secret never does.";

  return null;
}

