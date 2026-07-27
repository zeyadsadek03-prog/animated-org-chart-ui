p='src/app/App.tsx'
s=open(p,'r',encoding='utf-8').read()

old1='  const toggleNode = (id: string) =>'
new1='''  const [pan, setPan] = useState({ x: 0, y: 0 });
  const r = { on: false, sx: 0, sy: 0, px: 0, py: 0 };

  const ptrDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    r.on = false; r.sx = e.clientX; r.sy = e.clientY;
    r.px = pan.x; r.py = pan.y;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const ptrMove = (e: React.PointerEvent) => {
    if (!r.on) {
      if ((e.clientX - r.sx)**2 + (e.clientY - r.sy)**2 > 9) r.on = true;
      return;
    }
    const dx = e.clientX - r.sx, dy = e.clientY - r.sy;
    setPan({
      x: Math.max(-CANVAS_W + 120, Math.min(window.innerWidth - 120, r.px + dx)),
      y: Math.max(-CANVAS_H + 120, Math.min(window.innerHeight - 120, r.py + dy)),
    });
  };
  const ptrUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    r.on = false;
  };

  const toggleNode = (id: string) =>'''
s=s.replace(old1, new1, 1)

old2='''          style={{
            width: CANVAS_W, height: CANVAS_H,
            minWidth: "100%", minHeight: "100%",
          }}'''
new2='''          style={{
            transform: "translate(" + pan.x + "px," + pan.y + "px)",
            width: CANVAS_W, height: CANVAS_H,
            minWidth: "100%", minHeight: "100%",
          }}'''
s=s.replace(old2, new2, 1)

old3='''className="w-full min-w-[100vw] min-h-[100vh] overflow-auto relative flex items-start justify-center pt-20"'''
new3='''className="w-full min-w-[100vw] min-h-[100vh] overflow-hidden relative flex items-start justify-center pt-20 cursor-grab select-none"'''
s=s.replace(old3, new3, 1)

open(p,'w',encoding='utf-8').write(s)
print('pan patch applied')
