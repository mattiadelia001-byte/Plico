import { useEffect, useMemo, useRef, useState } from "react";
import type { FolioDoc, Point, Quad, Rect } from "../engine/folioDoc";
import type { Pos } from "../engine/textModel";
import * as A from "../engine/annotations";
import { toast, useStore, type ToolId } from "../state/store";
import { styleOf } from "../state/actions";
import { viewerApi } from "../state/viewerApi";
import { openExternal } from "../platform";
import { ContextMenu, type MenuItem } from "./ui";

type Drag =
  | { kind: "create"; tool: ToolId; start: Point; cur: Point; pts: Point[] }
  | { kind: "move"; id: number; start: Point; dx: number; dy: number; moved: boolean }
  | { kind: "resize"; id: number; orig: Rect; next: Rect }
  | { kind: "select-text"; start: Point; cur: Point; moved: boolean; anchor: Pos | null; quads: Quad[]; text: string };

interface Editor {
  mode: "text" | "note" | "edit";
  at: Point;
  width?: number;
  id?: number;
  type?: string;
  initial: string;
  fontSize: number;
  color: string;
}

const isTextMarkupTool = (t: ToolId) => t === "highlight" || t === "underline" || t === "strike";
const polygon = (q: Quad) => `${q[0]},${q[1]} ${q[2]},${q[3]} ${q[6]},${q[7]} ${q[4]},${q[5]}`;
const norm = (a: Point, b: Point): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];

/** Riduce i punti di un tratto a mano libera senza perdere la forma. */
function thin(pts: Point[], minDist: number): Point[] {
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const l = out[out.length - 1];
    if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= minDist) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function PageOverlay(props: { doc: FolioDoc; index: number; S: number; w: number; h: number; version: number }) {
  const { doc, index, S, w, h, version } = props;
  const store = useStore;
  const tool = useStore((s) => s.tool);
  const color = useStore((s) => s.color);
  const width = useStore((s) => s.width);
  const selection = useStore((s) => s.selection);
  const selectedAnnot = useStore((s) => s.selectedAnnot);
  const hits = useStore((s) => s.hits);
  const hitIndex = useStore((s) => s.hitIndex);

  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };

  // PointerEvent.detail vale sempre 0: i clic ravvicinati li conto io
  const wordMarked = useRef(false);
  const lastClick = useRef({ t: 0, x: 0, y: 0, n: 0 });
  const clickCount = (e: React.PointerEvent): number => {
    const l = lastClick.current, now = e.timeStamp;
    const n = now - l.t < 450 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 6 ? l.n + 1 : 1;
    lastClick.current = { t: now, x: e.clientX, y: e.clientY, n };
    return n;
  };

  const selectedRef = useMemo(() => {
    if (!selectedAnnot || selectedAnnot.page !== index) return null;
    return A.listAnnotations(doc, index).find((l) => l.ref.id === selectedAnnot.id)?.ref ?? null;
  }, [doc, index, selectedAnnot, version]);

  const pageHits = useMemo(
    () => hits.map((hit, i) => ({ hit, i })).filter((x) => x.hit.page === index),
    [hits, index],
  );

  const toPage = (e: { clientX: number; clientY: number }): Point => {
    const r = layerRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / S, (e.clientY - r.top) / S];
  };

  const select = (id: number | null) =>
    store.getState().patch({ selectedAnnot: id === null ? null : { page: index, id }, selection: null });

  // Esc annulla un trascinamento in corso
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) { setDrag(null); e.stopPropagation(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ---------- puntatore ----------

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || editor) return;
    const p = toPage(e);
    const t = store.getState().tool;
    layerRef.current!.setPointerCapture(e.pointerId);

    if (t === "select" || isTextMarkupTool(t)) {
      if (selectedRef && A.isResizable(selectedRef.type)) {
        const hx = selectedRef.bounds[2] * S, hy = selectedRef.bounds[3] * S;
        if (Math.hypot(p[0] * S - hx, p[1] * S - hy) <= 11) {
          setDrag({ kind: "resize", id: selectedRef.id, orig: selectedRef.bounds, next: selectedRef.bounds });
          return;
        }
      }
      const hit = A.hitTest(doc, index, p, 4 / S, false);
      if (hit) {
        select(hit.id);
        setDrag({ kind: "move", id: hit.id, start: p, dx: 0, dy: 0, moved: false });
        return;
      }
      store.getState().patch({ selectedAnnot: null, selection: null });
      setDrag({ kind: "select-text", start: p, cur: p, moved: false, anchor: doc.textModel(index).locate(p[0], p[1]), quads: [], text: "" });
      return;
    }
    store.getState().patch({ selectedAnnot: null, selection: null });
    setDrag({ kind: "create", tool: t, start: p, cur: p, pts: [p] });
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const p = toPage(e);
    if (d.kind === "create") {
      const last = d.pts[d.pts.length - 1];
      const pts = d.tool === "draw" && Math.hypot(p[0] - last[0], p[1] - last[1]) * S > 1.5 ? [...d.pts, p] : d.pts;
      setDrag({ ...d, cur: p, pts });
    } else if (d.kind === "move") {
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      setDrag({ ...d, dx, dy, moved: d.moved || Math.hypot(dx, dy) * S > 3 });
    } else if (d.kind === "resize") {
      setDrag({ ...d, next: [d.orig[0], d.orig[1], Math.max(d.orig[0] + 6, p[0]), Math.max(d.orig[1] + 6, p[1])] });
    } else {
      const moved = d.moved || Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) * S > 3;
      let { quads, text } = d;
      if (moved && d.anchor) {
        const model = doc.textModel(index);
        const focus = model.locate(p[0], p[1]);
        if (focus) ({ quads, text } = model.range(d.anchor, focus));
      }
      setDrag({ ...d, cur: p, moved, quads, text });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const p = toPage(e);
    setDrag(null);
    try { layerRef.current?.releasePointerCapture(e.pointerId); } catch { /* già rilasciato */ }
    const s = store.getState();
    const clicks = d.kind === "create" ? 1 : clickCount(e);

    if (d.kind === "move") {
      if (d.moved) A.moveAnnotation(doc, index, d.id, d.dx, d.dy);
      else if (clicks === 2) editAnnotation(d.id);
    } else if (d.kind === "resize") {
      if (d.next.some((v, i) => Math.abs(v - d.orig[i]) > 0.01)) A.resizeAnnotation(doc, index, d.id, d.next);
    } else if (d.kind === "select-text") {
      if (d.moved && d.quads.length) {
        if (isTextMarkupTool(s.tool)) applyMarkup(s.tool, d.quads);
        else s.patch({ selection: { page: index, quads: d.quads, text: d.text } });
      } else if (!d.moved) {
        clickAt(p, clicks);
      }
    } else if (d.kind === "create") {
      finishCreate(d, p);
    }
  }

  function applyMarkup(t: ToolId, quads: Quad[]) {
    const kind = t === "highlight" ? "Highlight" : t === "underline" ? "Underline" : "StrikeOut";
    A.createMarkup(doc, index, kind, quads, store.getState().color);
    store.getState().patch({ selection: null });
  }

  function clickAt(p: Point, clicks: number) {
    // doppio e triplo clic: parola e riga (con lo strumento evidenziatore la segnano subito)
    if (clicks >= 2) {
      const model = doc.textModel(index);
      const r = clicks >= 3 ? model.line(p[0], p[1]) : model.word(p[0], p[1]);
      if (r.quads.length) {
        const tool = store.getState().tool;
        if (isTextMarkupTool(tool)) {
          if (clicks >= 3 && wordMarked.current) doc.undo(); // la riga sostituisce la parola già segnata
          applyMarkup(tool, r.quads);
          wordMarked.current = clicks === 2;
        } else {
          store.getState().patch({ selection: { page: index, quads: r.quads, text: r.text } });
        }
        return;
      }
    }
    // clic su una evidenziazione: la seleziona
    const markup = A.hitTest(doc, index, p, 3 / S, true);
    if (markup) { select(markup.id); return; }
    // clic su un collegamento
    try {
      for (const link of doc.page(index).getLinks()) {
        const [x0, y0, x1, y1] = link.getBounds();
        if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
        const uri = link.getURI();
        if (link.isExternal()) openExternal(uri);
        else {
          const target = doc.pdf.resolveLink(uri);
          if (target >= 0) { store.getState().patch({ selectedPages: [target] }); viewerApi.scrollToPage(target); }
        }
        return;
      }
    } catch { /* nessun link */ }
  }

  function finishCreate(d: Extract<Drag, { kind: "create" }>, p: Point) {
    const st = store.getState();
    const style = styleOf();
    const r = norm(d.start, p);
    const big = r[2] - r[0] > 4 && r[3] - r[1] > 4;
    const revert = () => store.getState().setTool("select");
    const done = (id: number) => { store.getState().patch({ selectedAnnot: { page: index, id } }); };
    switch (d.tool) {
      case "rect":
      case "oval":
        if (big) { done(A.createShape(doc, index, d.tool === "rect" ? "Square" : "Circle", r, style)); revert(); }
        break;
      case "line":
      case "arrow":
        if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 4) { done(A.createLine(doc, index, d.start, p, d.tool === "arrow", style)); revert(); }
        break;
      case "draw": {
        const pts = thin(d.pts, 1.2 / S * 1.5);
        if (pts.length > 1) done(A.createInk(doc, index, [pts], style));
        break;
      }
      case "text": {
        const dragged = r[2] - r[0] > 40;
        setEditor({ mode: "text", at: [r[0], r[1]], width: dragged ? r[2] - r[0] : undefined, initial: "", fontSize: st.fontSize, color: st.color });
        break;
      }
      case "note":
        setEditor({ mode: "note", at: d.start, initial: "", fontSize: 13, color: st.color });
        break;
      case "signature": {
        const sig = st.signatures.find((x) => x.id === st.signatureId) ?? st.signatures[st.signatures.length - 1];
        if (!sig) { st.patch({ dialog: "signature" }); break; }
        done(A.createSignature(doc, index, sig, p, 150, st.color));
        revert();
        break;
      }
      case "crop":
        if (big) { doc.setCropBox(index, r); revert(); }
        break;
    }
  }

  function editAnnotation(id: number) {
    const found = A.listAnnotations(doc, index).find((l) => l.ref.id === id);
    if (!found || (found.ref.type !== "FreeText" && found.ref.type !== "Text")) return;
    const { ref } = found;
    if (ref.type === "FreeText") A.hideForEditing(doc, index, id, true);
    setEditor({
      mode: "edit", id, type: ref.type, at: [ref.bounds[0], ref.bounds[1]], width: ref.bounds[2] - ref.bounds[0],
      initial: ref.contents, fontSize: ref.type === "FreeText" ? ref.fontSize : 13, color: ref.type === "FreeText" ? ref.color : "#000000",
    });
  }

  function commitEditor(text: string | null) {
    const ed = editor;
    if (!ed) return;
    setEditor(null);
    const st = store.getState();
    if (ed.mode === "edit" && ed.id !== undefined) {
      if (ed.type === "FreeText") A.hideForEditing(doc, index, ed.id, false);
      if (text !== null && text.trim() && text !== ed.initial) A.setAnnotationText(doc, index, ed.id, text);
      return;
    }
    if (text === null || !text.trim()) return;
    const style = styleOf();
    if (ed.mode === "text") {
      const id = A.createFreeText(doc, index, ed.at, text, style, ed.width);
      st.patch({ selectedAnnot: { page: index, id } });
    } else {
      const id = A.createNote(doc, index, ed.at, text, st.color);
      st.patch({ selectedAnnot: { page: index, id } });
    }
    st.setTool("select");
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const p = toPage(e);
    const hit = A.hitTest(doc, index, p, 4 / S, true);
    const items: MenuItem[] = [];
    if (hit) {
      select(hit.id);
      if (hit.type === "FreeText" || hit.type === "Text") items.push({ label: "Modifica testo…", onClick: () => editAnnotation(hit.id) });
      items.push({ label: "Elimina", onClick: () => { A.deleteAnnotation(doc, index, hit.id); store.getState().patch({ selectedAnnot: null }); } });
    } else if (selection && selection.page === index && selection.text) {
      items.push({ label: "Copia", onClick: () => navigator.clipboard?.writeText(selection.text).catch(() => toast("Impossibile copiare")) });
      for (const [label, t] of [["Evidenzia", "highlight"], ["Sottolinea", "underline"], ["Barra", "strike"]] as const) {
        items.push({ label, onClick: () => applyMarkup(t, selection.quads) });
      }
    }
    if (items.length) setMenu({ x: e.clientX, y: e.clientY, items });
  }

  // ---------- disegno ----------

  const cursor = tool === "select" || isTextMarkupTool(tool) ? (tool === "select" ? "default" : "text") : tool === "text" ? "text" : "crosshair";
  const sw = (px: number) => px / S; // spessore costante a schermo

  const preview = drag && drag.kind === "create" ? (() => {
    const r = norm(drag.start, drag.cur);
    const common = { fill: "none", stroke: color, strokeWidth: width, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    switch (drag.tool) {
      case "rect": return <rect x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} {...common} />;
      case "oval": return <ellipse cx={(r[0] + r[2]) / 2} cy={(r[1] + r[3]) / 2} rx={(r[2] - r[0]) / 2} ry={(r[3] - r[1]) / 2} {...common} />;
      case "line":
      case "arrow": return <line x1={drag.start[0]} y1={drag.start[1]} x2={drag.cur[0]} y2={drag.cur[1]} {...common} />;
      case "draw": return <polyline points={drag.pts.map((q) => q.join(",")).join(" ")} {...common} />;
      case "text":
      case "crop": return (
        <>
          {drag.tool === "crop" && <path d={`M0,0H${w}V${h}H0Z M${r[0]},${r[1]}V${r[3]}H${r[2]}V${r[1]}Z`} fill="rgba(0,0,0,.35)" fillRule="evenodd" />}
          <rect x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill="none" stroke="var(--accent)" strokeWidth={sw(1.5)} strokeDasharray={`${sw(5)} ${sw(3)}`} />
        </>
      );
      default: return null;
    }
  })() : null;

  const frame: Rect | null = (() => {
    if (!selectedRef) return null;
    if (drag?.kind === "move" && drag.id === selectedRef.id) {
      const b = selectedRef.bounds;
      return [b[0] + drag.dx, b[1] + drag.dy, b[2] + drag.dx, b[3] + drag.dy];
    }
    if (drag?.kind === "resize") return drag.next;
    return selectedRef.bounds;
  })();

  return (
    <>
      <svg className="overlay" viewBox={`0 0 ${w} ${h}`} width={w * S} height={h * S} data-testid={`overlay-${index}`}>
        {pageHits.map(({ hit, i }) =>
          hit.quads.map((q, k) => (
            <polygon key={`${i}-${k}`} points={polygon(q)} fill={i === hitIndex ? "rgba(255,140,0,.55)" : "rgba(255,214,10,.45)"} style={{ mixBlendMode: "multiply" }} />
          )),
        )}
        {selection?.page === index && selection.quads.map((q, k) => <polygon key={k} points={polygon(q)} fill="rgba(10,132,255,.32)" />)}
        {drag?.kind === "select-text" && drag.quads.map((q, k) => <polygon key={k} points={polygon(q)} fill="rgba(10,132,255,.32)" />)}
        {preview}
        {frame && (
          <g>
            <rect x={frame[0] - sw(2)} y={frame[1] - sw(2)} width={frame[2] - frame[0] + sw(4)} height={frame[3] - frame[1] + sw(4)}
              fill="none" stroke="var(--accent)" strokeWidth={sw(1.5)} strokeDasharray={`${sw(5)} ${sw(3)}`} data-testid="annot-frame" />
            {selectedRef && A.isResizable(selectedRef.type) && (
              <circle cx={frame[2]} cy={frame[3]} r={sw(5.5)} fill="#fff" stroke="var(--accent)" strokeWidth={sw(2)} data-testid="annot-handle" />
            )}
          </g>
        )}
      </svg>
      <div
        ref={layerRef}
        className="interaction"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onContextMenu={onContextMenu}
        data-testid={`page-${index}`}
      />
      {editor && <InlineEditor editor={editor} S={S} onCommit={commitEditor} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}

function InlineEditor(props: { editor: Editor; S: number; onCommit: (text: string | null) => void }) {
  const { editor, S, onCommit } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(editor.initial);
  const finished = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [text]);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onCommit(value);
  };
  const isNote = editor.mode === "note" || editor.type === "Text";
  return (
    <textarea
      ref={ref}
      className={"inline-editor" + (isNote ? " note" : "")}
      data-testid="inline-editor"
      value={text}
      placeholder={isNote ? "Scrivi la nota…" : "Scrivi qui…"}
      style={{
        left: editor.at[0] * S,
        top: editor.at[1] * S + (isNote ? 28 : 0),
        width: isNote ? 220 : Math.max((editor.width ?? 200) * S, 120),
        fontSize: editor.fontSize * S,
        color: isNote ? undefined : editor.color,
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(null);
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finish(text);
      }}
    />
  );
}
