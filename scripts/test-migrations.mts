/**
 * Migrations must not lose rows.
 *
 * A generated migration once rebuilt `clients` with a copy step that read
 * columns the old table did not have yet: the INSERT failed, the following
 * DROP TABLE did not, and every client row went with it. This walks each
 * migration in order over a throwaway database with real rows in it and
 * checks they are all still there at the end.
 */
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const file = join(tmpdir(), `mhq-migrate-${Date.now()}.db`);
const db = createClient({ url: `file:${file}` });

const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort();
const apply = async (name: string) => {
  const text = readFileSync(join("drizzle", name), "utf8");
  for (const stmt of text.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await db.execute(s);
  }
};

// Everything before the migration under test, then rows that must survive it.
const seedAt = files.findIndex((f) => f.startsWith("0006"));
for (const f of files.slice(0, seedAt)) await apply(f);

const now = Math.floor(Date.now() / 1000);
await db.execute({
  sql: `insert into clients (id, name, slug, status, monthly_value, currency, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)`,
  args: ["c-keep", "Nattugla", "nattugla", "active", 45000, "DKK", now, now],
});
await db.execute({
  sql: `insert into projects (id, client_id, name, status, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?)`,
  args: ["p-keep", "c-keep", "Kanalstrategi", "active", now, now],
});

let applyError = "";
for (const f of files.slice(seedAt)) {
  try {
    await apply(f);
  } catch (e) {
    applyError = `${f}: ${(e as Error).message}`;
    break;
  }
}
check("every migration applies cleanly", applyError === "", applyError);

const clients = await db.execute("select * from clients");
check("the client row survives the clients rebuild", clients.rows.length === 1, `${clients.rows.length} rows left`);

const row = clients.rows[0] as Record<string, unknown> | undefined;
check("its name is intact", row?.name === "Nattugla", String(row?.name));
check("its retainer amount is intact", Number(row?.monthly_value) === 45000, String(row?.monthly_value));
check("billing model defaults to retainer", row?.billing_model === "retainer", String(row?.billing_model));
check("hourly rate starts empty", row?.hourly_rate === null, String(row?.hourly_rate));
check("DKK is migrated to NOK", row?.currency === "NOK", String(row?.currency));

// The rebuild drops and recreates clients, so anything pointing at it must still resolve.
const joined = await db.execute(
  "select p.name from projects p join clients c on c.id = p.client_id",
);
check("child rows still join to it", joined.rows.length === 1, `${joined.rows.length} rows`);

const cols = await db.execute("PRAGMA table_info(clients)");
const names = cols.rows.map((r) => String((r as Record<string, unknown>).name));
check("new columns exist", names.includes("billing_model") && names.includes("hourly_rate"));

const defaultOf = (col: string) =>
  String((cols.rows.find((r) => String((r as Record<string, unknown>).name) === col) as Record<string, unknown>)?.dflt_value ?? "");
check("new clients get NOK by default", defaultOf("currency").includes("NOK"), defaultOf("currency"));

const idx = await db.execute("select name from sqlite_master where type = 'index' and tbl_name = 'clients'");
check(
  "the slug index is rebuilt",
  idx.rows.some((r) => String((r as Record<string, unknown>).name) === "clients_slug_unique"),
);

const t = await db.execute("select name from sqlite_master where type = 'table' and name = 'time_entries'");
check("time_entries is created", t.rows.length === 1);

db.close();
rmSync(file, { force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
