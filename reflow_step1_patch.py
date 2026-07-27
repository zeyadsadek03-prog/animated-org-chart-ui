import pathlib
p = pathlib.Path('src/app/App.tsx')
s = p.read_text(encoding='utf-8')
s = s.replace(
"""const ROOT_NODE = buildLayout(ORG as any, ROOT_X, ROOT_Y);""",
"""const ROOT_NODE = buildLayout(ORG as any, ROOT_X, ROOT_Y);
// ─── ISO-visible layout (additive helper, additive spacing only) ─────────────────
function visibleSubtreeW(node: LayoutNode, collapsed: Set<string>): number {
  if (!node.children.length) return NODE_W;
  if (collapsed.has(node.id)) return NODE_W;
  return node.children.reduce((s, c) => s + visibleSubtreeW(c, collapsed), 0) + (node.children.length - 1) * H_GAP;
}
function buildVisibleLayout(node: LayoutNode, cx: number, cy: number, collapsed: Set<string>): LayoutNode {
  const widths = node.children.map(c => visibleSubtreeW(c, collapsed));
  const total  = widths.reduce((s, w) => s + w, 0) + (node.children.length - 1) * H_GAP;
  let ox = cx - total / 2;
  const children = node.children.map((child, i) => {
    const lc = buildVisibleLayout(child, ox + widths[i] / 2, cy + V_GAP, collapsed);
    ox += widths[i] + H_GAP;
    return lc;
  });
  return { id: node.id, name: node.name, bg: node.bg, x: cx, y: cy, children };
}"""
)
s = s.replace(
"""export default function App() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(ALL_NODES.filter(n => n.children.length > 0).map(n => n.id)));""",
"""export default function App() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(ALL_NODES.filter(n => n.children.length > 0).map(n => n.id)));
  // Step 1 diagnostic: log recomputed positions without changing rendered output
  useMemo(() => {
    const layout = buildVisibleLayout(ROOT_NODE, ROOT_X, ROOT_Y, collapsed);
    console.log("[reflow] visible layout ids:", layout.id, layout.children.map(x => ({ id: x.id, x: x.x })));
  }, [collapsed]);"""
)
p.write_text(s, encoding='utf-8')
print('step1 patch written')
