import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";

const COOKIE = "mhq_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function sign(payload: string): string {
  return createHmac("sha256", env.authSecret ?? "dev-secret").update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Single-owner auth. This is one person's private workspace, so there is one
 * account and one passcode — AUTH_SECRET. Without it set, the app runs open,
 * which is fine on localhost and refuses to be the default in production.
 */
export const authRequired = () => Boolean(env.authSecret);

export function issueSession(): { name: string; value: string; options: Record<string, unknown> } {
  const expires = Date.now() + MAX_AGE * 1000;
  const payload = `${env.ownerEmail ?? "owner"}.${expires}`;
  return {
    name: COOKIE,
    value: `${payload}.${sign(payload)}`,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: env.appUrl.startsWith("https"),
      path: "/",
      maxAge: MAX_AGE,
    },
  };
}

export async function isSignedIn(): Promise<boolean> {
  if (!authRequired()) return true;

  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;

  const lastDot = raw.lastIndexOf(".");
  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);

  if (!safeEqual(signature, sign(payload))) return false;

  const expires = Number(payload.split(".").pop());
  return Number.isFinite(expires) && expires > Date.now();
}

export function checkPasscode(input: string): boolean {
  if (!env.authSecret) return true;
  return safeEqual(input, env.authSecret);
}

/** The owner row, created on first run so foreign keys always have a target. */
export async function currentUser() {
  const email = env.ownerEmail ?? "owner@marketinghq.local";
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db.insert(users).values({ email, name: "Owner" }).returning();
  return created;
}
