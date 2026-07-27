import { useState, useMemo } from "react";
import { motion } from "motion/react";
import { ChevronUp, ChevronDown } from "lucide-react";

// ─── Design spec (single source of truth) ────────────────────────────────────
const NODE_W   = 120;  // horizontal space allocated per leaf node (px)
const H_GAP    = 52;   // horizontal gap between sibling subtrees (px)
const V_GAP    = 148;  // vertical center-to-center level spacing (px)
const AVATAR_D = 76;   // avatar diameter (px)
const AVATAR_R = AVATAR_D / 2;
const CURVE_T  = 60;   // bezier CP tension — controls S-curve depth (px)
const STROKE_W = 1.5;  // connector stroke weight (px)
const ANIM_DUR = 0.4;  // expand/collapse duration (seconds)
const EASE     = [0.4, 0, 0.2, 1] as const; // cubic-bezier ease-in-out
const PADDING  = 80;   // canvas edge padding (px)

// ─── Types ────────────────────────────────────────────────────────────────────
interface Person {
  id: string; name: string; initials: string; role: string;
  bg: string; children: Person[];
}
interface LayoutNode extends Omit<Person, "children"> {
  x: number; y: number; children: LayoutNode[];
}
interface Edge {
  key: string; parentId: string; childId: string;
  px: number; py: number; cx: number; cy: number;
}

// ─── Org data (12 people) ─────────────────────────────────────────────────────
const ORG: Person = {
  id: "ceo", name: "MARCUS BELL", initials: "MB",
  role: "Chief Executive", bg: "#EFF6FF",
  children: [
    {
      id: "ops", name: "DIANA REYES", initials: "DR",
      role: "Operations Director", bg: "#FFFBEB",
      children: [
        {
          id: "siteA", name: "KYLE MORGAN", initials: "KM",
          role: "Site Supervisor", bg: "#F0FDF4",
          children: [
            { id: "carp", name: "TOM HARRIS",  initials: "TH", role: "Lead Carpenter", bg: "#F8FAFC", children: [] },
            { id: "elec", name: "SARA LUNA",   initials: "SL", role: "Electrician",    bg: "#F8FAFC", children: [] },
          ],
        },
        {
          id: "siteB", name: "PETRA VOSS", initials: "PV",
          role: "Site Supervisor", bg: "#FDF4FF",
          children: [
            { id: "plumb", name: "JAMES KIRK",  initials: "JK", role: "Plumber",  bg: "#F8FAFC", children: [] },
            { id: "paint", name: "MILA CROSS",  initials: "MC", role: "Painter",  bg: "#F8FAFC", children: [] },
          ],
        },
      ],
    },
    {
      id: "pm", name: "ALEX CHEN", initials: "AC",
      role: "Project Manager", bg: "#F5F3FF",
      children: [
        { id: "est",  name: "RUTH OKAFOR", initials: "RO", role: "Estimator",      bg: "#F8FAFC", children: [] },
        { id: "safe", name: "DAN WRIGHT",  initials: "DW", role: "Safety Officer", bg: "#F8FAFC", children: [] },
      ],
    },
    { id: "admin", name: "FIONA BLAKE", initials: "FB", role: "Admin Manager", bg: "#FFF7ED", children: [] },
  ],
};

// ─── Layout (recursive, computed once from static data) ───────────────────────
function subtreeW(n: Person): number {
  if (!n.children.length) return NODE_W;
  return n.children.reduce((s, c) => s + subtreeW(c), 0) + (n.children.length - 1) * H_GAP;
}

function buildLayout(node: Person, cx: number, cy: number): LayoutNode {
  const widths = node.children.map(subtreeW);
  const total  = widths.reduce((s, w) => s + w, 0) + (node.children.length - 1) * H_GAP;
  let ox = cx - total / 2;
  const children = node.children.map((child, i) => {
    const lc = buildLayout(child, ox + widths[i] / 2, cy + V_GAP);
    ox += widths[i] + H_GAP;
    return lc;
  });
  return { id: node.id, name: node.name, initials: node.initials, role: node.role, bg: node.bg, x: cx, y: cy, children };
}

function flatNodes(n: LayoutNode): LayoutNode[] { return [n, ...n.children.flatMap(flatNodes)]; }
function flatEdges(n: LayoutNode): Edge[] {
  return [
    ...n.children.map(c => ({ key: `${n.id}→${c.id}`, parentId: n.id, childId: c.id, px: n.x, py: n.y, cx: c.x, cy: c.y })),
    ...n.children.flatMap(flatEdges),
  ];
}

// Compute everything at module level — these values never change
const TREE_W    = subtreeW(ORG);
const CANVAS_W  = Math.max(TREE_W + PADDING * 2, 900);
const ROOT_X    = CANVAS_W / 2;
const ROOT_Y    = PADDING + AVATAR_R;
const ROOT_NODE = buildLayout(ORG, ROOT_X, ROOT_Y);
const ALL_NODES = flatNodes(ROOT_NODE);
const ALL_EDGES = flatEdges(ROOT_NODE);
const CANVAS_H  = Math.max(...ALL_NODES.map(n => n.y)) + AVATAR_R + 120 + PADDING;
const EXPANDABLE = new Set(ALL_NODES.filter(n => n.children.length > 0).map(n => n.id));

// ─── Visibility helper ────────────────────────────────────────────────────────
function getVisibleIds(collapsed: Set<string>): Set<string> {
  const vis = new Set<string>();
  function walk(n: LayoutNode) {
    vis.add(n.id);
    if (!collapsed.has(n.id)) n.children.forEach(walk);
  }
  walk(ROOT_NODE);
  return vis;
}

// ─── Bezier path — vertical tangents guarantee zero angular kinks ─────────────
// Each connector is one pure cubic bezier. Control points share the anchor's
// x-coordinate, so the tangent at both endpoints is always perfectly vertical.
// The path shape is fixed; only pathLength is animated → no kinks ever.
//
//  M  px  py+r          ← bottom-center of parent avatar
//  C  px  py+r+T        ← CP1: same x as start, pulls straight down
//     cx  cy-r-T        ← CP2: same x as end, pulls straight up
//     cx  cy-r          ← top-center of child avatar
function curvePath(px: number, py: number, cx: number, cy: number) {
  const y0 = py + AVATAR_R;
  const y1 = cy - AVATAR_R;
  return `M ${px} ${y0} C ${px} ${y0 + CURVE_T} ${cx} ${y1 - CURVE_T} ${cx} ${y1}`;
}

// ─── Connector ────────────────────────────────────────────────────────────────
function Connector({ edge, visible }: { edge: Edge; visible: boolean }) {
  return (
    <motion.path
      d={curvePath(edge.px, edge.py, edge.cx, edge.cy)}
      fill="none"
      stroke="#92B4D4"
      strokeWidth={STROKE_W}
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: visible ? 1 : 0, opacity: visible ? 1 : 0 }}
      transition={{ duration: ANIM_DUR, ease: EASE }}
    />
  );
}

// ─── Org node ─────────────────────────────────────────────────────────────────
function OrgNode({ node, isVisible, isCollapsed, onToggle }: {
  node: LayoutNode; isVisible: boolean; isCollapsed: boolean;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  return (
    <motion.div
      className="absolute flex flex-col items-center select-none"
      style={{
        left: node.x - NODE_W / 2,
        top: node.y - AVATAR_R,
        width: NODE_W,
        pointerEvents: isVisible ? "auto" : "none",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: isVisible ? 1 : 0 }}
      transition={{ duration: ANIM_DUR, ease: EASE }}
    >
      {/* Avatar circle */}
      <button
        onClick={() => hasChildren && onToggle(node.id)}
        className="relative rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none group"
        style={{
          width: AVATAR_D, height: AVATAR_D,
          background: node.bg,
          border: "2.5px dashed #7BAED4",
          cursor: hasChildren ? "pointer" : "default",
          boxShadow: "0 2px 12px rgba(37,99,235,0.10)",
        }}
        aria-label={hasChildren
          ? (isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`)
          : node.name}
        tabIndex={hasChildren ? 0 : -1}
      >
        {/* Hover ring */}
        <span
          className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
          style={{ boxShadow: "0 0 0 4px rgba(37,99,235,0.12)" }}
        />
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.07em", color: "#3068B8" }}>
          {node.initials}
        </span>

        {/* Expand/collapse badge */}
        {hasChildren && (
          <span
            className="absolute flex items-center justify-center rounded-full transition-all duration-200"
            style={{
              bottom: -9, right: -9,
              width: 22, height: 22,
              background: isCollapsed ? "#2563EB" : "#FFFFFF",
              border: "2px solid #93B4D5",
              boxShadow: "0 1px 4px rgba(37,99,235,0.18)",
            }}
          >
            {isCollapsed
              ? <ChevronDown size={11} color="#fff" strokeWidth={2.5} />
              : <ChevronUp   size={11} color="#2563EB" strokeWidth={2.5} />
            }
          </span>
        )}
      </button>

      {/* Name pill */}
      <div
        className="mt-3.5 flex items-center justify-center rounded-full"
        style={{
          height: 26,
          paddingLeft: 12, paddingRight: 12,
          background: "#2563EB",
          minWidth: 72, maxWidth: NODE_W + 28,
          boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
        }}
      >
        <span style={{
          fontSize: 8.5, fontWeight: 800, letterSpacing: "0.10em",
          color: "#FFFFFF", whiteSpace: "nowrap",
        }}>
          {node.name}
        </span>
      </div>

      {/* Role label */}
      <p className="mt-1.5 text-center leading-tight" style={{
        fontSize: 9.5, color: "#7A90A8", letterSpacing: "0.02em",
      }}>
        {node.role}
      </p>
    </motion.div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleNode = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleIds = useMemo(() => getVisibleIds(collapsed), [collapsed]);

  return (
    <div
      className="size-full"
      style={{ background: "#EEEEEE", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {/* ── Chart canvas ────────────────────────────────────────────────────── */}
      <div className="w-full min-w-[100vw] min-h-[100vh] overflow-auto relative flex items-start justify-center pt-20" style={{ background: "#EEEEEE", backgroundImage: "radial-gradient(circle, #c4c4c4 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
        <div
          className="relative"
          style={{
            width: CANVAS_W, height: CANVAS_H,
            minWidth: "100%", minHeight: "100%",
          }}
        >
          {/* SVG connector layer */}
          <svg
            className="absolute inset-0"
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ overflow: "visible", pointerEvents: "none" }}
          >
            {ALL_EDGES.map(edge => (
              <Connector
                key={edge.key}
                edge={edge}
                visible={visibleIds.has(edge.parentId) && !collapsed.has(edge.parentId)}
              />
            ))}
          </svg>

          {/* Node layer */}
          {ALL_NODES.map(node => (
            <OrgNode
              key={node.id}
              node={node}
              isVisible={visibleIds.has(node.id)}
              isCollapsed={collapsed.has(node.id)}
              onToggle={toggleNode}
            />
          ))}
        </div>
      </div>

    </div>
  );
}
