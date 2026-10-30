// Inline-SVG chart primitives. Zero deps, server-renderable.
// Palette: black lines, red for negative/warning, blue for highlights, green for A-verdict.

const AXIS = "#000";
const MUTED = "#999";
const FILL = "#000";
const RED = "#c8102e";
const BLUE = "#0a2a66";
const GREEN = "#0f7a3a";

export function BarGroup({
  bars,
  width = 680,
  height = 220,
  maxValue,
}: {
  bars: { label: string; value: number; second?: number; color?: string }[];
  width?: number;
  height?: number;
  maxValue?: number;
}) {
  if (!bars.length) return null;
  const padL = 36;
  const padR = 20;
  const padT = 20;
  const padB = 36;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const max = maxValue ?? Math.max(...bars.flatMap((b) => [b.value, b.second ?? 0]), 1);
  const barW = chartW / bars.length;
  const groupPad = 6;
  const hasSecond = bars.some((b) => b.second !== undefined);
  const innerBarW = hasSecond ? (barW - groupPad * 2) / 2 : barW - groupPad * 2;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="chart">
      {/* Y axis grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + chartH - chartH * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke={MUTED} strokeDasharray="2 3" />
            <text x={padL - 6} y={y + 3} fontSize="9" textAnchor="end" fill={MUTED}>
              {Math.round(max * t)}
            </text>
          </g>
        );
      })}
      {/* Axes */}
      <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke={AXIS} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke={AXIS} />

      {bars.map((b, i) => {
        const xBase = padL + i * barW + groupPad;
        const h1 = (b.value / max) * chartH;
        const h2 = ((b.second ?? 0) / max) * chartH;
        const color1 = b.color ?? FILL;
        const color2 = MUTED;
        return (
          <g key={i}>
            <rect
              x={xBase}
              y={padT + chartH - h1}
              width={innerBarW}
              height={h1}
              fill={color1}
            />
            {hasSecond && (
              <rect
                x={xBase + innerBarW}
                y={padT + chartH - h2}
                width={innerBarW}
                height={h2}
                fill="none"
                stroke={color2}
                strokeWidth={1.5}
              />
            )}
            <text
              x={xBase + (hasSecond ? innerBarW : innerBarW / 2)}
              y={padT + chartH + 16}
              fontSize="10"
              textAnchor="middle"
              fill={AXIS}
            >
              {b.label}
            </text>
            <text
              x={xBase + innerBarW / 2}
              y={padT + chartH - h1 - 4}
              fontSize="10"
              textAnchor="middle"
              fontWeight="700"
              fill={color1}
            >
              {b.value}
            </text>
          </g>
        );
      })}
      {hasSecond && (
        <g>
          <rect x={width - padR - 100} y={6} width={10} height={10} fill={FILL} />
          <text x={width - padR - 86} y={15} fontSize="10" fill={AXIS}>
            humans
          </text>
          <rect x={width - padR - 50} y={6} width={10} height={10} fill="none" stroke={MUTED} />
          <text x={width - padR - 36} y={15} fontSize="10" fill={AXIS}>
            judge
          </text>
        </g>
      )}
    </svg>
  );
}

export function KappaBars({
  bars,
  width = 680,
  height = 180,
}: {
  bars: { label: string; kappa: number; n: number }[];
  width?: number;
  height?: number;
}) {
  if (!bars.length) return null;
  const padL = 100;
  const padR = 60;
  const padT = 10;
  const padB = 20;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const rowH = chartH / bars.length;
  const barH = rowH * 0.6;

  // X scale: κ ranges from -0.2 to 1.0
  const xMin = -0.2;
  const xMax = 1.0;
  const toX = (k: number) => padL + ((k - xMin) / (xMax - xMin)) * chartW;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="chart">
      {/* Vertical threshold lines at κ = 0, 0.4, 0.6, 0.8 */}
      {[0, 0.4, 0.6, 0.8].map((t) => (
        <g key={t}>
          <line x1={toX(t)} y1={padT} x2={toX(t)} y2={padT + chartH} stroke={MUTED} strokeDasharray="2 3" />
          <text x={toX(t)} y={padT + chartH + 14} fontSize="9" textAnchor="middle" fill={MUTED}>
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      {/* Zero line solid */}
      <line x1={toX(0)} y1={padT} x2={toX(0)} y2={padT + chartH} stroke={AXIS} />

      {bars.map((b, i) => {
        const y = padT + i * rowH + (rowH - barH) / 2;
        const barColor = b.kappa >= 0.6 ? GREEN : b.kappa >= 0.4 ? FILL : b.kappa >= 0 ? MUTED : RED;
        const barX = Math.min(toX(0), toX(b.kappa));
        const barW = Math.abs(toX(b.kappa) - toX(0));
        return (
          <g key={i}>
            <text x={padL - 8} y={y + barH * 0.7} fontSize="11" textAnchor="end" fill={AXIS}>
              {b.label}
            </text>
            <rect x={barX} y={y} width={barW} height={barH} fill={barColor} />
            <text
              x={toX(b.kappa) + (b.kappa >= 0 ? 4 : -4)}
              y={y + barH * 0.7}
              fontSize="10"
              textAnchor={b.kappa >= 0 ? "start" : "end"}
              fontWeight="700"
              fill={barColor}
            >
              {b.kappa.toFixed(2)}
            </text>
            <text
              x={width - padR + 6}
              y={y + barH * 0.7}
              fontSize="9"
              textAnchor="start"
              fill={MUTED}
            >
              n={b.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Heatmap3x3({
  matrix,
  rowLabels = ["A", "B", "C"],
  colLabels = ["A", "B", "C"],
  size = 240,
}: {
  matrix: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  size?: number;
}) {
  const max = Math.max(...matrix.flat(), 1);
  const cell = size / 3;
  const padL = 60;
  const padT = 30;
  const total = size + padL + 20;
  const totalH = size + padT + 20;

  return (
    <svg width={total} height={totalH} viewBox={`0 0 ${total} ${totalH}`} className="chart">
      {/* Column labels (judge) */}
      <text x={padL + size / 2} y={padT - 16} fontSize="10" textAnchor="middle" fill={MUTED}>
        JUDGE
      </text>
      {colLabels.map((lab, j) => (
        <text
          key={j}
          x={padL + cell * (j + 0.5)}
          y={padT - 4}
          fontSize="11"
          textAnchor="middle"
          fontWeight="700"
        >
          {lab}
        </text>
      ))}
      {/* Row labels (human) */}
      <text
        x={10}
        y={padT + size / 2}
        fontSize="10"
        textAnchor="start"
        fill={MUTED}
        transform={`rotate(-90, 10, ${padT + size / 2})`}
      >
        HUMAN MAJORITY
      </text>
      {rowLabels.map((lab, i) => (
        <text
          key={i}
          x={padL - 6}
          y={padT + cell * (i + 0.5) + 4}
          fontSize="11"
          textAnchor="end"
          fontWeight="700"
        >
          {lab}
        </text>
      ))}
      {/* Cells */}
      {matrix.map((row, i) =>
        row.map((v, j) => {
          const isDiag = i === j;
          // Opacity scales with value / max
          const opacity = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
          const bg = isDiag ? GREEN : RED;
          return (
            <g key={`${i}-${j}`}>
              <rect
                x={padL + cell * j}
                y={padT + cell * i}
                width={cell}
                height={cell}
                fill={bg}
                fillOpacity={opacity}
                stroke={AXIS}
              />
              <text
                x={padL + cell * (j + 0.5)}
                y={padT + cell * (i + 0.5) + 5}
                fontSize="16"
                textAnchor="middle"
                fontWeight="700"
                fill={v / max > 0.5 ? "#fff" : "#000"}
              >
                {v}
              </text>
            </g>
          );
        })
      )}
    </svg>
  );
}

export function TimelineChart({
  points,
  width = 680,
  height = 180,
}: {
  points: { t: number; value: number; grader: string }[];
  width?: number;
  height?: number;
}) {
  if (!points.length) return null;
  const padL = 36;
  const padR = 90;
  const padT = 20;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Group by grader
  const byGrader = new Map<string, { t: number; value: number }[]>();
  for (const p of points) {
    if (!byGrader.has(p.grader)) byGrader.set(p.grader, []);
    byGrader.get(p.grader)!.push({ t: p.t, value: p.value });
  }
  for (const arr of byGrader.values()) arr.sort((a, b) => a.t - b.t);

  const allTs = points.map((p) => p.t);
  const tMin = Math.min(...allTs);
  const tMax = Math.max(...allTs);
  const vMax = Math.max(...points.map((p) => p.value), 1);
  const toX = (t: number) =>
    padL + ((t - tMin) / Math.max(tMax - tMin, 1)) * chartW;
  const toY = (v: number) => padT + chartH - (v / vMax) * chartH;

  const colors = [FILL, BLUE, RED, GREEN, "#a07010"];
  const graderList = Array.from(byGrader.keys());

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="chart">
      {/* Y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + chartH - chartH * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke={MUTED} strokeDasharray="2 3" />
            <text x={padL - 6} y={y + 3} fontSize="9" textAnchor="end" fill={MUTED}>
              {Math.round(vMax * t)}
            </text>
          </g>
        );
      })}
      {/* X axis */}
      <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke={AXIS} />
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke={AXIS} />
      {/* Time labels */}
      <text x={padL} y={padT + chartH + 14} fontSize="9" fill={MUTED}>
        {new Date(tMin).toLocaleTimeString()}
      </text>
      <text x={width - padR} y={padT + chartH + 14} fontSize="9" textAnchor="end" fill={MUTED}>
        {new Date(tMax).toLocaleTimeString()}
      </text>

      {graderList.map((g, gi) => {
        const arr = byGrader.get(g)!;
        const d = arr
          .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.t)} ${toY(p.value)}`)
          .join(" ");
        return (
          <g key={g}>
            <path d={d} stroke={colors[gi % colors.length]} strokeWidth="2" fill="none" />
            <text
              x={width - padR + 6}
              y={padT + 12 + gi * 14}
              fontSize="10"
              fill={colors[gi % colors.length]}
              fontWeight="700"
            >
              {g}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
