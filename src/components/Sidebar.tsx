import type React from "react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ChevronDown, ChevronUp, FileSearch, Grid2x2, ListTree, MessageSquareText } from "lucide-react";
import type { PlicoDoc, OutlineEntry } from "../engine/plicoDoc";
import * as A from "../engine/annotations";
import { fromFile } from "../platform";
import { useStore, type SidebarMode } from "../state/store";
import * as act from "../state/actions";
import { viewerApi } from "../state/viewerApi";
import { ContextMenu, type MenuItem } from "./ui";
import { useDocVersion } from "./TopBar";

const MODES: { id: SidebarMode; title: string; icon: React.ReactElement }[] = [
  { id: "thumbs", title: "Miniature", icon: <Grid2x2 size={16} /> },
  { id: "outline", title: "Indice", icon: <ListTree size={16} /> },
  { id: "annots", title: "Annotazioni", icon: <MessageSquareText size={16} /> },
  { id: "search", title: "Risultati della ricerca", icon: <FileSearch size={16} /> },
];

export function Sidebar({ doc }: { doc: PlicoDoc }) {
  const mode = useStore((s) => s.sidebarMode);
  const patch = useStore((s) => s.patch);
  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="seg">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? "on" : ""} title={m.title} onClick={() => patch({ sidebarMode: m.id })} data-testid={`side-${m.id}`}>{m.icon}</button>
        ))}
      </div>
      {mode === "thumbs" && <Thumbnails doc={doc} />}
      {mode === "outline" && <Outline doc={doc} />}
      {mode === "annots" && <AnnotList doc={doc} />}
      {mode === "search" && <SearchResults />}
    </aside>
  );
}

// ---------------- miniature ----------------

function Thumbnails({ doc }: { doc: PlicoDoc }) {
  useDocVersion(doc);
  const selected = useStore((s) => s.selectedPages);
  const current = useStore((s) => s.currentPage);
  const patch = useStore((s) => s.patch);
  const n = doc.pageCount;
  const anchor = useRef(0);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(`[data-thumb="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onClick = (e: React.MouseEvent, i: number) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      patch({ selectedPages: Array.from({ length: b - a + 1 }, (_, k) => a + k) });
    } else if (mod) {
      patch({ selectedPages: selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i] });
      anchor.current = i;
    } else {
      patch({ selectedPages: [i] });
      anchor.current = i;
      viewerApi.scrollToPage(i);
    }
  };

  const onContext = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    const pages = selected.includes(i) ? [...selected].sort((a, b) => a - b) : [i];
    if (!selected.includes(i)) patch({ selectedPages: [i] });
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "Ruota a sinistra", onClick: () => act.rotate(-90, pages) },
        { label: "Ruota a destra", onClick: () => act.rotate(90, pages) },
        { separator: true },
        { label: "Duplica", onClick: () => act.duplicatePages(pages) },
        { label: "Estrai in un nuovo PDF…", onClick: () => act.extractPages(pages) },
        { separator: true },
        { label: "Elimina", onClick: () => act.deletePages(pages) },
      ],
    });
  };

  const onDragStart = (e: DragEvent, i: number) => {
    const pages = selected.includes(i) ? [...selected].sort((a, b) => a - b) : [i];
    if (!selected.includes(i)) patch({ selectedPages: [i] });
    e.dataTransfer.setData("application/x-plico-pages", JSON.stringify(pages));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: DragEvent, i: number) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // il rilascio non deve risalire al contenitore e ripetersi
    const at = dropAt ?? n;
    setDropAt(null);
    const raw = e.dataTransfer.getData("application/x-plico-pages");
    if (raw) { act.reorderPages(JSON.parse(raw), at); return; }
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name));
    if (files.length) { e.stopPropagation(); act.insertFromPdfs(await Promise.all(files.map(fromFile)), at); }
  };

  return (
    <div className="thumbs" ref={listRef} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropAt(null); }}
      onDragOver={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setDropAt(n); } }} onDrop={onDrop} data-testid="thumbs">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="thumb-wrap" onDragOver={(e) => onDragOver(e, i)} onDrop={onDrop}>
          {dropAt === i && <div className="drop-line" />}
          <Thumb doc={doc} index={i} selected={selected.includes(i)} current={i === current}
            onClick={(e) => onClick(e, i)} onContext={(e) => onContext(e, i)} onDragStart={(e) => onDragStart(e, i)} onDragEnd={() => setDropAt(null)} />
          {dropAt === n && i === n - 1 && <div className="drop-line bottom" />}
        </div>
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Thumb(props: {
  doc: PlicoDoc; index: number; selected: boolean; current: boolean;
  onClick: (e: React.MouseEvent) => void; onContext: (e: React.MouseEvent) => void;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const { doc, index } = props;
  const version = useDocVersion(doc);
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [pw, ph] = doc.size(index);
  const W = 140, H = Math.round((W * ph) / pw);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
      try {
        const img = doc.render(index, cw / pw, ch / ph);
        if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
        c.getContext("2d")!.putImageData(img, 0, 0);
      } catch { /* miniatura non disponibile */ }
    }, 40);
    return () => window.clearTimeout(t);
  }, [visible, version, doc, index, W, H, pw, ph]);

  return (
    <div ref={ref} className={"thumb" + (props.selected ? " selected" : "") + (props.current ? " current" : "")} data-thumb={index}
      draggable onDragStart={props.onDragStart} onDragEnd={props.onDragEnd} onClick={props.onClick} onContextMenu={props.onContext} data-testid={`thumb-${index}`}>
      <canvas ref={canvasRef} style={{ width: W, height: H }} />
      <span className="thumb-num">{index + 1}</span>
    </div>
  );
}

// ---------------- indice ----------------

function Outline({ doc }: { doc: PlicoDoc }) {
  const items = useMemo(() => doc.outline(), [doc, doc.structVersion]);
  if (!items.length) return <div className="empty"><ListTree size={28} /><p>Questo PDF non ha un indice.</p></div>;
  return <div className="outline"><OutlineList items={items} depth={0} /></div>;
}

function OutlineList({ items, depth }: { items: OutlineEntry[]; depth: number }) {
  return (
    <ul>
      {items.map((it, i) => (
        <li key={i}>
          <button style={{ paddingLeft: 8 + depth * 14 }} onClick={() => it.page !== null && (useStore.getState().patch({ selectedPages: [it.page] }), viewerApi.scrollToPage(it.page))}>
            {it.title}
          </button>
          {it.children.length > 0 && <OutlineList items={it.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

// ---------------- annotazioni ----------------

const KIND: Record<string, string> = {
  Highlight: "Evidenziazione", Underline: "Sottolineatura", StrikeOut: "Testo barrato", Squiggly: "Ondulata",
  Square: "Rettangolo", Circle: "Ovale", Line: "Linea", Ink: "Disegno", FreeText: "Testo", Text: "Nota",
};

function AnnotList({ doc }: { doc: PlicoDoc }) {
  useDocVersion(doc);
  const selected = useStore((s) => s.selectedAnnot);
  const items = [];
  for (let p = 0; p < doc.pageCount; p++) for (const { ref } of A.listAnnotations(doc, p)) items.push(ref);
  if (!items.length) return <div className="empty"><MessageSquareText size={28} /><p>Evidenziazioni, note e disegni compariranno qui.</p></div>;
  return (
    <ul className="annot-list" data-testid="annot-list">
      {items.map((a) => (
        <li key={`${a.page}-${a.id}`}>
          <button className={selected?.id === a.id && selected.page === a.page ? "on" : ""} onClick={() => {
            useStore.getState().patch({ selectedAnnot: { page: a.page, id: a.id }, tool: "select" });
            viewerApi.reveal(a.page, a.bounds);
          }}>
            <span className="dot" style={{ background: a.color }} />
            <span className="grow">
              <strong>{KIND[a.type] ?? a.type}</strong>
              {a.contents && <small>{a.contents}</small>}
            </span>
            <small>p. {a.page + 1}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------- ricerca ----------------

function SearchResults() {
  const hits = useStore((s) => s.hits);
  const idx = useStore((s) => s.hitIndex);
  const q = useStore((s) => s.searchQuery);
  if (!hits.length) return <div className="empty"><FileSearch size={28} /><p>{q ? "Nessun risultato." : "Scrivi nel campo “Cerca” in alto."}</p></div>;
  return (
    <div className="results">
      <div className="results-head">
        <span>{idx + 1} di {hits.length}</span>
        <button className="mini" onClick={() => act.showHit(idx - 1)}><ChevronUp size={14} /></button>
        <button className="mini" onClick={() => act.showHit(idx + 1)}><ChevronDown size={14} /></button>
      </div>
      <ul data-testid="results">
        {hits.map((h, i) => (
          <li key={i}><button className={i === idx ? "on" : ""} onClick={() => act.showHit(i)}><span>{h.snippet || "…"}</span><small>Pagina {h.page + 1}</small></button></li>
        ))}
      </ul>
    </div>
  );
}
