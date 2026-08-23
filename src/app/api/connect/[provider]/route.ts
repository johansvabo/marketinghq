import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { authorizeUrl, PROVIDERS, type ProviderId } from "@/lib/integrations/oauth";

/** Kicks off the OAuth dance, with a one-time state value to come back against. */
export async function GET(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { provider } = await params;
  if (!(provider in PROVIDERS)) return new Response("Unknown provider", { status: 404 });

  const state = randomBytes(16).toString("base64url");
  (await cookies()).set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  try {
    redirect(authorizeUrl(provider as ProviderId, state));
  } catch (error) {
    // redirect() throws by design; anything else is a real configuration problem.
    if (error && typeof error === "object" && "digest" in error) throw error;
    return new Response(error instanceof Error ? error.message : "Could not start the connection", { status: 400 });
  }
}
