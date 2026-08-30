/**
 * Upload limits and formatting, in a file with no imports.
 *
 * These are needed by the browser as well as the server, and they used to live
 * beside the extraction code — which pulls in Node-only PDF and Word libraries.
 * Importing one constant from there dragged those libraries into the browser
 * bundle, where they cannot run.
 */

/**
 * Uploading straight to blob storage from the browser bypasses the serverless
 * function, so the only ceiling is the one we choose.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Without blob storage the file travels through a serverless function, whose
 * request body the platform caps at a few megabytes. Going over fails at the
 * platform, before any of our code runs, so this stays conservatively inside it.
 */
export const MAX_DIRECT_POST_BYTES = 4 * 1024 * 1024;

/** Above this, upload in parallel parts so a big file survives a wobbly line. */
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

const PLAIN = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log"];
const IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic"];

export const PLAIN_EXTENSIONS = PLAIN;
export const IMAGE_EXTENSIONS = IMAGE;
export const UPLOAD_ACCEPT = [...PLAIN, ".pdf", ".docx", ".rtf", ".html", ...IMAGE].join(",");

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
