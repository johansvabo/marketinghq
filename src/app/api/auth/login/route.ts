import { cookies } from "next/headers";
import { checkPasscode, issueSession } from "@/lib/auth";

export async function POST(request: Request) {
  const { passcode } = (await request.json()) as { passcode?: string };
  if (!passcode || !checkPasscode(passcode)) {
    // A uniform small delay keeps the failure from being a timing oracle.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return new Response("Unauthorized", { status: 401 });
  }

  const session = issueSession();
  (await cookies()).set(session.name, session.value, session.options);
  return Response.json({ ok: true });
}
