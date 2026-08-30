"use client";

/**
 * The last line of defence: catches failures in the root layout itself, where
 * the normal error boundary and the app shell are not available. It has to ship
 * its own <html> and its own styles, so this is deliberately plain.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#101116",
          color: "#f0f0f2",
          fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: 18, fontWeight: 650, margin: "0 0 10px" }}>Marketing HQ couldn&apos;t start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#b9b9c2", margin: "0 0 16px" }}>
            This is usually a missing or malformed database setting. Check <code>TURSO_DATABASE_URL</code> and{" "}
            <code>TURSO_AUTH_TOKEN</code>, then redeploy. Your data is not affected.
          </p>
          <p style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#8a8a95", wordBreak: "break-word" }}>
            {error.message}
            {error.digest ? ` · digest ${error.digest}` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 18,
              padding: "9px 16px",
              borderRadius: 10,
              border: "1px solid #33343d",
              background: "#f0b445",
              color: "#241a05",
              fontWeight: 650,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
