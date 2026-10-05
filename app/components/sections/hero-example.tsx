/// A picture of what the product does: a three-party loop and the receipt it produces. The
/// parties and amounts are made up, and the card says so, so it can't be read as protocol activity.

const NODES = [
  { id: "A", label: "Company A", x: 190, y: 44 },
  { id: "B", label: "Company B", x: 70, y: 200 },
  { id: "C", label: "Company C", x: 310, y: 200 },
] as const;

type Point = readonly [number, number];

/// The three debts, each drawn from the debtor's node edge to the creditor's.
const EDGES: readonly { from: Point; to: Point }[] = [
  { from: [168, 76], to: [92, 168] },
  { from: [112, 212], to: [268, 212] },
  { from: [288, 168], to: [212, 76] },
];

/// Arrowhead as a small triangle at the edge's end, drawn separately so it can appear after its line.
function headPath({ from, to }: { from: Point; to: Point }): string {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const [ux, uy] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const base: Point = [to[0] - ux * 9, to[1] - uy * 9];
  const [px, py] = [-uy * 4.5, ux * 4.5];
  const round = (n: number) => Math.round(n * 10) / 10;
  return `M${round(to[0])} ${round(to[1])} L${round(base[0] + px)} ${round(base[1] + py)} L${round(base[0] - px)} ${round(base[1] - py)} z`;
}

const ROWS = [
  { from: "Company A", to: "Company B" },
  { from: "Company B", to: "Company C" },
  { from: "Company C", to: "Company A" },
] as const;

function Loop() {
  return (
    <svg
      viewBox="0 0 380 250"
      role="img"
      aria-label="Company A owes Company B 1,000 USDC, Company B owes Company C 1,000 USDC, and Company C owes Company A 1,000 USDC. The three debts form a closed loop."
      className="h-auto w-full max-w-md"
    >
      {EDGES.map((edge, index) => (
        <g key={index} style={{ "--loop-delay": `${index * 0.7}s` } as React.CSSProperties}>
          <path
            d={`M${edge.from[0]} ${edge.from[1]} L${edge.to[0]} ${edge.to[1]}`}
            pathLength={1}
            stroke="#636a80"
            strokeWidth="1.5"
            fill="none"
            className="animate-loop-draw"
          />
          <path d={headPath(edge)} fill="#a8aebd" className="animate-loop-head" />
        </g>
      ))}
      <g fill="#a8aebd" fontSize="12" textAnchor="middle">
        <text x="112" y="116" transform="rotate(-50 112 116)">1,000 USDC</text>
        <text x="190" y="236">1,000 USDC</text>
        <text x="268" y="116" transform="rotate(50 268 116)">1,000 USDC</text>
      </g>
      {NODES.map((node) => (
        <g key={node.id}>
          <circle cx={node.x} cy={node.y} r="22" fill="#0f1118" stroke="#f5be09" strokeWidth="1.5" />
          <text x={node.x} y={node.y + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill="#eef0f5">
            {node.id}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function HeroExample() {
  return (
    <figure className="mx-auto mt-14 w-full max-w-4xl">
      <div className="grid items-center gap-8 rounded-card border border-border-subtle bg-surface-1 p-6 text-left sm:p-8 md:grid-cols-2">
        <div className="flex justify-center">
          <Loop />
        </div>

        <div>
          <p className="text-sm font-semibold">One transaction nets the loop</p>
          <ul className="mt-4 divide-y divide-border-subtle border-y border-border-subtle text-sm">
            {ROWS.map((row) => (
              <li key={row.from} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
                <span className="text-foreground">
                  {row.from} <span aria-label="owes" className="text-faint">→</span> {row.to}
                </span>
                <span className="tabular-nums text-muted">
                  1,000.00 → <span className="text-foreground">0.00</span>
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-faint">Netted in total</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">3,000.00 USDC</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">USDC moved</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">0.00 USDC</dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-faint">Example: an illustration, not a real transaction.</figcaption>
    </figure>
  );
}
