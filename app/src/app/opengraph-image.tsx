import { ImageResponse } from "next/og";

export const alt = "Contraflow: cancel circular debt on Arc";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/// Static brand card: no stats or claims, so nothing here can go stale or overstate.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08090f",
          color: "#eef0f5",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 36, fontWeight: 600 }}>
          <div style={{ width: 20, height: 20, borderRadius: 20, background: "#f5be09" }} />
          Contraflow
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 84, fontWeight: 600, letterSpacing: -3, lineHeight: 1.05 }}>Cancel circular debt on Arc</div>
          <div style={{ fontSize: 32, color: "#a8aebd" }}>Net loops of USDC invoices and obligations. No cash moves.</div>
        </div>
      </div>
    ),
    size,
  );
}
