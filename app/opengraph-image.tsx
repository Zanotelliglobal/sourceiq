import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"
                fill="white"
              />
            </svg>
          </div>
          <div style={{ fontSize: 32, fontWeight: 700 }}>SourceIQ</div>
        </div>
        <div style={{ fontSize: 60, fontWeight: 800, marginTop: 48, lineHeight: 1.1, maxWidth: 900 }}>
          Find qualified suppliers in minutes, not months
        </div>
        <div style={{ fontSize: 28, marginTop: 28, color: "#cbd5e1", maxWidth: 820 }}>
          Multi-agent AI supplier discovery and procurement intelligence platform.
        </div>
      </div>
    ),
    size
  );
}
