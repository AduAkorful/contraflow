"use client";

import { useReducedMotion } from "../../../src/hooks/useReducedMotion";

type EdgeStatus = "pending" | "signing" | "registered" | "settling" | "settled";

export interface DemoEdge {
  fromLabel: string;
  toLabel: string;
  status: EdgeStatus;
  /// Present once this specific invoice's real amount is known (from the moment its registration
  /// is submitted onward) — invoices carry unequal amounts on purpose, so there's no single
  /// fixed figure to fall back to.
  amountUsdc?: string;
  explorerUrl?: string;
}

export type DiagramCenter =
  | { kind: "idle" }
  | { kind: "finding" }
  | { kind: "proposal"; wNetUsdc: string }
  | { kind: "settling" }
  | { kind: "settled"; grossCancelledUsdc: string };

const COLOR = {
  pending: "#4b5563",
  signing: "#c7c7c7",
  registered: "rgba(255,255,255,0.55)",
  settling: "#f5be09",
  settled: "#f5be09",
  muted: "#8a8a8a",
  foreground: "#ffffff",
};

const CENTER = { x: 200, y: 200 };
const RING_RADIUS = 118;
const NODE_RADIUS = 26;
const LABEL_GAP = 20;

/// The diagram has limited horizontal room per node (more so with 4-5 parties), so a long label
/// ("Northwind DSP") is shortened to its first word ("Northwind") — full names still show in the
/// registered-invoices list and the receipt below. Short generic labels ("Party 1") are left
/// alone: the trailing number is what distinguishes one node from another, since the avatar
/// circle's own number isn't repeated in the outer label otherwise.
function shortLabel(label: string): string {
  return label.length > 10 ? label.split(" ")[0]! : label;
}

function nodePosition(index: number, count: number) {
  const angle = ((-90 + (index * 360) / count) * Math.PI) / 180;
  return { x: CENTER.x + RING_RADIUS * Math.cos(angle), y: CENTER.y + RING_RADIUS * Math.sin(angle) };
}

function shortenedLine(from: { x: number; y: number }, to: { x: number; y: number }, r: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / len;
  const uy = dy / len;
  return { x1: from.x + ux * r, y1: from.y + uy * r, x2: to.x - ux * r, y2: to.y - uy * r };
}

function outwardLabel(point: { x: number; y: number }, extra: number) {
  const dx = point.x - CENTER.x;
  const dy = point.y - CENTER.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: point.x + (dx / len) * extra, y: point.y + (dy / len) * extra };
}

function computeGeometry(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => nodePosition(i, count));
  const edges = nodes.map((from, i) => {
    const to = nodes[(i + 1) % count]!;
    const line = shortenedLine(from, to, NODE_RADIUS);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const label = outwardLabel(mid, LABEL_GAP);
    return { ...line, labelX: label.x, labelY: label.y };
  });
  return { nodes, edges };
}

function Node({
  x,
  y,
  index,
  label,
  pulsing,
  active,
  reducedMotion,
}: {
  x: number;
  y: number;
  index: number;
  label: string;
  pulsing: boolean;
  active: boolean;
  reducedMotion: boolean;
}) {
  const namePos = outwardLabel({ x, y }, NODE_RADIUS + 16);
  return (
    <g>
      {pulsing && (
        <circle
          cx={x}
          cy={y}
          r={reducedMotion ? NODE_RADIUS + 5 : NODE_RADIUS}
          fill="none"
          stroke={COLOR.signing}
          strokeWidth={2}
          opacity={reducedMotion ? 0.4 : undefined}
        >
          {!reducedMotion && (
            <>
              <animate attributeName="r" values={`${NODE_RADIUS};${NODE_RADIUS + 10}`} dur="1.1s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="1.1s" repeatCount="indefinite" />
            </>
          )}
        </circle>
      )}
      <circle cx={x} cy={y} r={NODE_RADIUS} fill="#111119" stroke={active ? COLOR.settled : "rgba(255,255,255,0.15)"} strokeWidth={active ? 2 : 1} style={{ transition: "stroke 0.4s ease" }} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fill={COLOR.foreground} fontWeight={500}>
        {index + 1}
      </text>
      <text x={namePos.x} y={namePos.y} textAnchor="middle" fontSize="10.5" fill={COLOR.muted}>
        {shortLabel(label)}
      </text>
    </g>
  );
}

function EdgeLine({
  index,
  geometry,
  status,
  reducedMotion,
}: {
  index: number;
  geometry: ReturnType<typeof computeGeometry>["edges"][number];
  status: EdgeStatus;
  reducedMotion: boolean;
}) {
  const color = COLOR[status];
  const pathId = `edge-path-${index}`;
  return (
    <g>
      <path id={pathId} d={`M ${geometry.x1} ${geometry.y1} L ${geometry.x2} ${geometry.y2}`} fill="none" stroke="none" />
      <line
        x1={geometry.x1}
        y1={geometry.y1}
        x2={geometry.x2}
        y2={geometry.y2}
        stroke={color}
        strokeWidth={status === "settled" || status === "settling" ? 2.5 : 1.5}
        strokeDasharray={status === "pending" || status === "signing" ? "4 4" : undefined}
        markerEnd={`url(#arrow-${status})`}
        style={{ transition: "stroke 0.4s ease, stroke-width 0.4s ease" }}
      >
        {status === "settling" && !reducedMotion && <animate attributeName="opacity" values="1;0.35;1" dur="0.9s" repeatCount="indefinite" />}
      </line>
      {status === "signing" && !reducedMotion && (
        <circle r="3.5" fill={COLOR.signing}>
          <animateMotion dur="0.9s" repeatCount="indefinite">
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  );
}

function EdgeLabel({
  geometry,
  status,
  amountUsdc,
  explorerUrl,
}: {
  geometry: ReturnType<typeof computeGeometry>["edges"][number];
  status: EdgeStatus;
  amountUsdc?: string;
  explorerUrl?: string;
}) {
  // Amounts are unequal per edge — shown once known (signing onward), not before, since
  // "pending" invoices haven't been built yet client-side.
  // "settled" says so generically rather than implying every invoice reached $0: the real
  // per-invoice before/after lives in the receipt below, where it's actually precise.
  const text =
    status === "pending" ? "—"
    : status === "signing" ? "signing..."
    : status === "settling" ? "settling..."
    : status === "settled" ? "settled"
    : `$${amountUsdc ?? "?"} · registered`;
  const color = status === "settled" || status === "settling" ? COLOR.settled : status === "registered" ? COLOR.foreground : COLOR.muted;
  const content = (
    <text x={geometry.labelX} y={geometry.labelY} textAnchor="middle" fontSize="10.5" fill={color} style={{ transition: "fill 0.4s ease" }}>
      {text}
    </text>
  );
  if (explorerUrl) {
    return (
      <a href={explorerUrl} target="_blank" rel="noreferrer">
        {content}
        <title>View transaction on Arc Explorer</title>
      </a>
    );
  }
  return content;
}

function CenterContent({ center, reducedMotion }: { center: DiagramCenter; reducedMotion: boolean }) {
  if (center.kind === "idle") {
    return (
      <text x={CENTER.x} y={CENTER.y} textAnchor="middle" fontSize="11" fill={COLOR.muted}>
        Not started
      </text>
    );
  }
  if (center.kind === "finding") {
    return (
      <text x={CENTER.x} y={CENTER.y} textAnchor="middle" fontSize="11" fill={COLOR.muted}>
        Finding cycle...
      </text>
    );
  }
  if (center.kind === "proposal") {
    return (
      <g>
        <text x={CENTER.x} y={CENTER.y - 8} textAnchor="middle" fontSize="10" fill={COLOR.muted} letterSpacing="0.05em">
          NET TO SETTLE
        </text>
        <text x={CENTER.x} y={CENTER.y + 16} textAnchor="middle" fontSize="20" fill={COLOR.foreground} fontFamily="var(--font-serif-display)">
          ${center.wNetUsdc}
        </text>
      </g>
    );
  }
  if (center.kind === "settling") {
    return (
      <g>
        <circle cx={CENTER.x} cy={CENTER.y} r={26} fill="none" stroke={COLOR.settled} strokeWidth={2} opacity={reducedMotion ? 0.65 : undefined}>
          {!reducedMotion && <animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" />}
        </circle>
        <text x={CENTER.x} y={CENTER.y + 5} textAnchor="middle" fontSize="10" fill={COLOR.muted}>
          Settling...
        </text>
      </g>
    );
  }
  return (
    <g>
      <circle cx={CENTER.x} cy={CENTER.y} r={26} fill="none" stroke={COLOR.settled} strokeWidth={2} />
      <path
        d={`M ${CENTER.x - 11} ${CENTER.y} L ${CENTER.x - 3} ${CENTER.y + 8} L ${CENTER.x + 12} ${CENTER.y - 9}`}
        fill="none"
        stroke={COLOR.settled}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={32}
        className={reducedMotion ? undefined : "animate-check-draw"}
      />
    </g>
  );
}

export function CycleDiagram({ edges, center }: { edges: DemoEdge[]; center: DiagramCenter }) {
  const reducedMotion = useReducedMotion();
  const count = edges.length;
  const geometry = computeGeometry(count);
  const touchesNode = (nodeIndex: number, edgeIndex: number) => edgeIndex === nodeIndex || edgeIndex === (nodeIndex - 1 + count) % count;
  const nodeActive = (nodeIndex: number) => edges.some((e, i) => touchesNode(nodeIndex, i) && (e.status === "settled" || e.status === "settling"));
  const nodePulsing = (nodeIndex: number) => edges.some((e, i) => touchesNode(nodeIndex, i) && e.status === "signing");

  return (
    <svg viewBox="0 0 400 400" className="mx-auto w-full max-w-sm">
      <defs>
        {(["pending", "signing", "registered", "settling", "settled"] as const).map((status) => (
          <marker key={status} id={`arrow-${status}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={COLOR[status]} />
          </marker>
        ))}
      </defs>

      {geometry.edges.map((g, i) => (
        <EdgeLine key={i} index={i} geometry={g} status={edges[i]!.status} reducedMotion={reducedMotion} />
      ))}

      {geometry.nodes.map((pos, i) => (
        <Node
          key={i}
          x={pos.x}
          y={pos.y}
          index={i}
          label={edges[i]!.fromLabel}
          active={nodeActive(i)}
          pulsing={nodePulsing(i)}
          reducedMotion={reducedMotion}
        />
      ))}

      {geometry.edges.map((g, i) => (
        <EdgeLabel key={i} geometry={g} status={edges[i]!.status} amountUsdc={edges[i]!.amountUsdc} explorerUrl={edges[i]!.explorerUrl} />
      ))}

      <CenterContent center={center} reducedMotion={reducedMotion} />
    </svg>
  );
}
