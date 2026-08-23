import { cookies } from "next/headers";
import { currentUser, isSignedIn } from "@/lib/auth";
import { env } from "@/lib/env";
import { exchangeCode, PROVIDERS, saveConnection, type ProviderId } from "@/lib/integrations/oauth";
import { googleIdentity } from "@/lib/integrations/google";
import { microsoftIdentity } from "@/lib/integrations/microsoft";

function back(message: string, ok = false) {
  const url = new URL("/settings", env.appUrl);
  url.searchParams.set(ok ? "connected" : "error", message);
  return Response.redirect(url.toString(), 303);
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const { provider } = await params;
  if (!(provider in PROVIDERS)) return new Response("Unknown provider", { status: 404 });

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) return back(`${PROVIDERS[provider as ProviderId].label} returned: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = (await cookies()).get(`oauth_state_${provider}`)?.value;

  if (!code) return back("No authorisation code came back.");
  if (!state || state !== expected) return back("The connection request expired. Try again.");

  try {
    const token = await exchangeCode(provider as ProviderId, code);
    const user = await currentUser();

    // Identify the account so re-connecting updates rather than duplicating.
    let externalId = `${provider}:${user.id}`;
    let displayName: string | undefined;

    if (provider === "google") {
      const identity = await googleIdentity(token.access_token);
      externalId = identity.email;
      displayName = identity.name ?? identity.email;
    } else if (provider === "microsoft") {
      const identity = await microsoftIdentity(token.access_token);
      externalId = identity.email;
      displayName = identity.name ?? identity.email;
    } else {
      displayName = `${PROVIDERS[provider as ProviderId].label} account`;
    }

    await saveConnection({
      userId: user.id,
      provider: provider as ProviderId,
      externalId,
      displayName,
      token,
    });

    return back(`${PROVIDERS[provider as ProviderId].label} connected as ${displayName}`, true);
  } catch (caught) {
    return back(caught instanceof Error ? caught.message : "Could not complete the connection.");
  }
}
