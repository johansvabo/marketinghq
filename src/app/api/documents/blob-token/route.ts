import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isSignedIn } from "@/lib/auth";
import { MAX_UPLOAD_BYTES } from "@/lib/documents/limits";
import { blobToken } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mints a short-lived token so the browser can upload straight to blob storage.
 *
 * This exists because a serverless function's request body is capped at a few
 * megabytes — far smaller than a brand book — and going over that fails at the
 * platform with an opaque error before any of our code runs. Uploading directly
 * sidesteps the function entirely.
 */
export async function POST(request: Request) {
  if (!(await isSignedIn())) return new Response("Unauthorized", { status: 401 });

  const body = (await request.json()) as HandleUploadBody;
  const token = blobToken();

  try {
    const result = await handleUpload({
      body,
      request,
      // Only pass a token when one exists: the SDK resolves credentials itself
      // when deployed, and a store can be authorised without a static token.
      ...(token ? { token } : {}),
      onBeforeGenerateToken: async () => ({
        // Only these fields are permitted here. `access` is not among them —
        // it is set by the browser in upload() — and including it makes token
        // generation fail with nothing more useful than "failed to retrieve
        // the client token".
        addRandomSuffix: true,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        allowOverwrite: false,
      }),
      // The document row is created by /api/documents/from-blob once the
      // browser reports the upload finished. Doing it here would rely on a
      // webhook that cannot reach a local dev server.
      onUploadCompleted: async () => {},
    });

    return Response.json(result);
  } catch (error) {
    // Surface the real reason — the client otherwise shows only a generic
    // "failed to retrieve the client token".
    const message = error instanceof Error ? error.message : "Could not start the upload.";
    console.error("[marketinghq] blob token generation failed:", message);
    return Response.json({ error: message }, { status: 400 });
  }
}
