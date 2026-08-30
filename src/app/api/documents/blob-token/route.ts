import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isSignedIn } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT } from "@/lib/documents/extract";

export const runtime = "nodejs";

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

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: undefined,
        addRandomSuffix: true,
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        allowOverwrite: false,
        validUntil: Date.now() + 60 * 60 * 1000,
      }),
      // The document row is created by /api/documents/from-blob once the
      // browser reports the upload finished. Doing it here would rely on a
      // webhook that cannot reach a local dev server.
      onUploadCompleted: async () => {},
    });

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not start the upload." },
      { status: 400 },
    );
  }
}

export const dynamic = "force-dynamic";
export const acceptedTypes = UPLOAD_ACCEPT;
