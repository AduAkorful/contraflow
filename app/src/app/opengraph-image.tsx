import { ImageResponse } from "next/og";

export const alt = "Contraflow. No cash moves.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GOLD = "#f5be09";
const MUTED = "#a8aebd";

function Party({ letter }: { letter: string }) {
  return (
    <div
      style={{
        width: 96,
        height: 96,
        borderRadius: 48,
        border: `4px solid ${GOLD}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: GOLD,
        fontSize: 36,
        fontWeight: 600,
      }}
    >
      {letter}
    </div>
  );
}

function Arrow() {
  return (
    <div style={{ width: 72, height: 4, background: GOLD, display: "flex" }} />
  );
}

/// Brand card: the mark, a three-party loop, and the line already on the home hero.
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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 36, fontWeight: 600 }}>
          <div
            style={{
              width: 44,
              height: 44,
              background: "#0a0a0a",
              border: `3px solid ${GOLD}`,
              transform: "rotate(45deg)",
              display: "flex",
            }}
          />
          Contraflow
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <Party letter="A" />
            <Arrow />
            <Party letter="B" />
            <Arrow />
            <Party letter="C" />
            <Arrow />
            <Party letter="A" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>No cash moves.</div>
            <div style={{ fontSize: 28, color: MUTED }}>A loop of debts nets in one signed step.</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
