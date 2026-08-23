import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS crops to a rounded square itself, so this fills the whole canvas.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f0b445",
          color: "#241a05",
          fontSize: 74,
          fontWeight: 900,
          letterSpacing: "-0.05em",
        }}
      >
        HQ
      </div>
    ),
    size,
  );
}
