import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#101116",
          color: "#f0b445",
          fontSize: 210,
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
