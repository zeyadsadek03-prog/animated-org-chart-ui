import { useMemo, useRef, useState } from "react";
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
  id: string; name: string; bg: string; children: Person[];
}
interface LayoutNode {
  id: string; name: string; bg: string; x: number; y: number; children: LayoutNode[];
}
interface Edge {
  key: string; parentId: string; childId: string;
  px: number; py: number; cx: number; cy: number;
}

// ─── Org data (12 people) ─────────────────────────────────────────────────────
const ORG: Person = {
  id: "idris", name: "Idris", bg: "#EEF2FF",
  children: [
    {
      id: "muhammad", name: "Muhammad", bg: "#FFF7ED",
      children: [
        { id: "zeyad", name: "Zeyad", bg: "#F8FAFC", children: [] },
        { id: "moaz", name: "Moaz", bg: "#F8FAFC", children: [] },
        { id: "shahd", name: "Shahd", bg: "#F8FAFC", children: [] },
      ],
    },
    {
      id: "osama", name: "Osama", bg: "#F0FDF4",
      children: [
        { id: "kareem", name: "Kareem", bg: "#F8FAFC", children: [] },
        { id: "momin", name: "Momin", bg: "#F8FAFC", children: [] },
      ],
    },
    {
      id: "nesrin", name: "Nesrin", bg: "#FFF1F2",
      children: [
        { id: "adham", name: "Adham", bg: "#F8FAFC", children: [] },
        { id: "faisal", name: "Faisal", bg: "#F8FAFC", children: [] },
        { id: "bassam", name: "Bassam", bg: "#F8FAFC", children: [] },
      ],
    },
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
  return { id: node.id, name: node.name, bg: node.bg, x: cx, y: cy, children };
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
const ROOT_NODE = buildLayout(ORG as any, ROOT_X, ROOT_Y);
const ALL_NODES = flatNodes(ROOT_NODE);
const ALL_EDGES = flatEdges(ROOT_NODE);
const CANVAS_H  = Math.max(...ALL_NODES.map(n => n.y)) + AVATAR_R + 120 + PADDING;
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
        <span style={{ fontSize: 16, fontWeight: 800, color: "#1E3A8A" }}>
          {node.name.charAt(0).toUpperCase()}
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

  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(ALL_NODES.filter(n => n.children.length > 0).map(n => n.id)));

  const [pan, setPan] = useState(() => {
    if (typeof window !== "undefined") {
      return {
        x: window.innerWidth / 2 - ROOT_X,
        y: window.innerHeight * 0.38 - ROOT_Y,
      };
    }
    return { x: 0, y: 0 };
  });
  const v = useRef({ vx: 0, vy: 0, raf: 0, lastX: 0, lastY: 0, lastT: 0 });
  const r = useRef({ on: false, sx: 0, sy: 0, px: 0, py: 0 });

  const ptrDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    cancelAnimationFrame(v.current.raf);
    r.current.on = true;
    r.current.sx = e.clientX; r.current.sy = e.clientY;
    r.current.px = pan.x; r.current.py = pan.y;
    v.current.vx = 0; v.current.vy = 0;
    v.current.lastX = e.clientX; v.current.lastY = e.clientY; v.current.lastT = performance.now();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const ptrMove = (e: React.PointerEvent) => {
    if (!r.current.on) return;
    const dx = e.clientX - r.current.sx, dy = e.clientY - r.current.sy;
    setPan({
      x: Math.max(-CANVAS_W + 120, Math.min(window.innerWidth - 120, r.current.px + dx)),
      y: Math.max(-CANVAS_H + 120, Math.min(window.innerHeight - 120, r.current.py + dy)),
    });
    const now = performance.now();
    const dt = now - v.current.lastT;
    if (dt > 0) {
      v.current.vx = 0.6 * v.current.vx + 0.4 * (e.clientX - v.current.lastX) / dt * 16;
      v.current.vy = 0.6 * v.current.vy + 0.4 * (e.clientY - v.current.lastY) / dt * 16;
    }
    v.current.lastX = e.clientX; v.current.lastY = e.clientY; v.current.lastT = now;
  };
  const ptrUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    r.current.on = false;
    const vx = Math.max(-40, Math.min(40, v.current.vx));
    const vy = Math.max(-40, Math.min(40, v.current.vy));
    if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) return;
    const step = () => {
      setPan(prev => {
        const nx = Math.max(-CANVAS_W + 120, Math.min(window.innerWidth - 120, prev.x + vx));
        const ny = Math.max(-CANVAS_H + 120, Math.min(window.innerHeight - 120, prev.y + vy));
        const outOfBounds = nx !== prev.x || ny !== prev.y;
        v.current.vx *= 0.92; v.current.vy *= 0.92;
        if (outOfBounds || (Math.abs(v.current.vx) < 0.02 && Math.abs(v.current.vy) < 0.02)) {
          return prev;
        }
        v.current.raf = requestAnimationFrame(step);
        return { x: nx, y: ny };
      });
    };
    v.current.raf = requestAnimationFrame(step);
  };

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
      <div className="w-full min-w-[100vw] min-h-[100vh] overflow-hidden relative flex items-center justify-center cursor-grab select-none" touch-action-none style={{ background: "#EEEEEE" }} onPointerDown={ptrDown} onPointerMove={ptrMove} onPointerUp={ptrUp}>
        <div
          style={{
            position: "absolute", inset: 0,
            backgroundImage: "radial-gradient(circle, #c4c4c4 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            pointerEvents: "none",
          }}
        />
        <div
          className="relative"
          style={{
            transform: "translate(" + pan.x + "px," + pan.y + "px)",
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
