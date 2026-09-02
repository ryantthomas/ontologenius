import { MASTERY_THRESHOLD } from "../../../src/learning/bkt";
import type { Layout } from "../../../src/graph/layout";

const NODE_WIDTH = 172;
const NODE_HEIGHT = 46;
const LAYER_GAP = 236;
const ROW_GAP = 66;
const PADDING = 20;

const x = (layer: number) => PADDING + layer * LAYER_GAP;
const y = (row: number) => PADDING + row * ROW_GAP;

type Status = "mastered" | "learning" | "ready" | "locked";

function statusOf(node: Layout["nodes"][number]): Status {
  if (node.pKnown >= MASTERY_THRESHOLD) return "mastered";
  if (!node.available) return "locked";
  return node.pKnown > 0 ? "learning" : "ready";
}

const STYLES: Record<Status, { fill: string; stroke: string; dash?: string; text: string }> = {
  mastered: { fill: "var(--accent-soft)", stroke: "var(--accent)", text: "var(--text)" },
  learning: { fill: "var(--surface)", stroke: "var(--accent)", text: "var(--text)" },
  ready: { fill: "var(--surface)", stroke: "var(--border)", text: "var(--text)" },
  locked: { fill: "transparent", stroke: "var(--border)", dash: "4 3", text: "var(--faint)" },
};

/**
 * The prerequisite DAG, drawn left to right by depth. Position is meaningful:
 * a concept's column is how many prerequisites deep it sits, so the drawing
 * doubles as the learning path.
 */
export default function GraphView({ layout }: { layout: Layout }) {
  const positions = new Map(layout.nodes.map((n) => [n.id, { x: x(n.layer), y: y(n.row) }]));
  const width = PADDING * 2 + (layout.layers - 1) * LAYER_GAP + NODE_WIDTH;
  const height = PADDING * 2 + (layout.rows - 1) * ROW_GAP + NODE_HEIGHT;

  return (
    <>
      <div className="graph-scroll">
        <svg width={width} height={height} role="img" aria-label="Prerequisite graph">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--border)" />
            </marker>
          </defs>

          {layout.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;

            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x - 6;
            const y2 = to.y + NODE_HEIGHT / 2;
            const midpoint = (x1 + x2) / 2;

            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={`M ${x1} ${y1} C ${midpoint} ${y1}, ${midpoint} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth="1.5"
                markerEnd="url(#arrow)"
              />
            );
          })}

          {layout.nodes.map((node) => {
            const position = positions.get(node.id)!;
            const status = statusOf(node);
            const style = STYLES[status];

            return (
              <g key={node.id}>
                <rect
                  x={position.x}
                  y={position.y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx="8"
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth="1.5"
                  strokeDasharray={style.dash}
                />
                <text
                  x={position.x + 12}
                  y={position.y + (status === "locked" ? 28 : 22)}
                  fill={style.text}
                  fontSize="13"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                </text>
                {status !== "locked" && (
                  <>
                    <rect
                      x={position.x + 12}
                      y={position.y + 30}
                      width={NODE_WIDTH - 24}
                      height="4"
                      rx="2"
                      fill="var(--border)"
                    />
                    <rect
                      x={position.x + 12}
                      y={position.y + 30}
                      width={Math.max(0, (NODE_WIDTH - 24) * Math.min(node.pKnown, 1))}
                      height="4"
                      rx="2"
                      fill="var(--accent)"
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="legend">
        <span>
          <i style={{ background: "var(--accent)" }} /> mastered
        </span>
        <span>
          <i style={{ border: "1.5px solid var(--accent)" }} /> in progress
        </span>
        <span>
          <i style={{ border: "1.5px solid var(--border)" }} /> ready to study
        </span>
        <span>
          <i style={{ border: "1.5px dashed var(--border)" }} /> prerequisites not met
        </span>
      </div>
    </>
  );
}
