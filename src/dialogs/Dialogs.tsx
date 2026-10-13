import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FilePlus2, Trash2 } from "lucide-react";
import { PlicoDoc, uid } from "../engine/plicoDoc";
import * as T from "../engine/tools";
import type { Signature } from "../engine/annotations";
import * as platform from "../platform";
import { activeDoc, saveSignatures, toast, useStore } from "../state/store";
import * as act from "../state/actions";
import { Modal } from "../components/ui";

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const doc = useStore(activeDoc);
  const patch = useStore((s) => s.patch);
  if (!dialog) return null;
  const close = () => patch({ dialog: null });
  if (dialog === "merge") return <MergeDialog onClose={close} />;
  if (dialog === "signature") return <SignatureDialog onClose={close} />;
  if (dialog === "compress") return <CompressDialog doc={doc} onClose={close} />;
  if (!doc) return null;
  switch (dialog) {
    case "split": return <SplitDialog doc={doc} onClose={close} />;
    case "protect": return <ProtectDialog doc={doc} onClose={close} />;
    case "info": return <InfoDialog doc={doc} onClose={close} />;
    case "images": return <ImagesDialog doc={doc} onClose={close} />;
  }
  return null;
}

const Footer = (p: { children: React.ReactNode }) => <div className="modal-footer">{p.children}</div>;

// ---------- Dividi ----------

function SplitDialog({ doc, onClose }: { doc: PlicoDoc; onClose: () => void }) {
  const [mode, setMode] = useState<"single" | "every" | "ranges">("single");
  const [every, setEvery] = useState(2);
  const [ranges, setRanges] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const groups = T.splitGroups(mode, doc.pageCount, every, ranges);
    if (!groups) { setError(`Intervalli non validi. Usa numeri tra 1 e ${doc.pageCount}, ad esempio “1-3, 5, 7-9”.`); return; }
    const folder = await platform.pickFolder();
    if (!folder) return;
    setBusy(true);
    try {
      const digits = String(groups.length).length;
      const base = act.stripPdf(doc.name);
      for (const [k, g] of groups.entries()) {
        await platform.writeInFolder(folder, `${base} – parte ${String(k + 1).padStart(digits, "0")}.pdf`, T.extractPages(doc, g));
        await new Promise((r) => setTimeout(r, 0));
      }
      toast(`Creati ${groups.length} file`);
      platform.revealFolder(folder);
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <Modal title="Dividi PDF" onClose={onClose}>
      <p className="muted">Il documento ha {doc.pageCount} pagine. L'originale non viene modificato.</p>
      <label className="radio"><input type="radio" checked={mode === "single"} onChange={() => setMode("single")} /> Una pagina per file</label>
      <label className="radio"><input type="radio" checked={mode === "every"} onChange={() => setMode("every")} /> Ogni
        <input className="num" type="number" min={1} value={every} onChange={(e) => setEvery(Math.max(1, +e.target.value))} onFocus={() => setMode("every")} /> pagine</label>
      <label className="radio"><input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} /> Intervalli personalizzati</label>
      {mode === "ranges" && <input className="text" placeholder="Es. 1-3, 4-7, 9" value={ranges} onChange={(e) => setRanges(e.target.value)} data-testid="ranges" />}
      {error && <p className="error">{error}</p>}
      <Footer><button onClick={onClose}>Annulla</button><button className="primary" disabled={busy} onClick={run} data-testid="split-run">Dividi…</button></Footer>
    </Modal>
  );
}

// ---------- Riduci dimensioni ----------

interface CompressSource { name: string; size: number; pdf: ReturnType<typeof T.openPdf> }

/** Con un PDF aperto comprime quello; dalla home chiede di scegliere un file. */
function CompressDialog({ doc, onClose }: { doc: PlicoDoc | null; onClose: () => void }) {
  const [preset, setPreset] = useState<T.CompressionPreset["id"]>("media");
  const [picked, setPicked] = useState<CompressSource | null>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const pick = (f?: platform.PickedFile) => {
    if (!f) return;
    setError(""); setResult("");
    try {
      const pdf = T.openPdf(f.bytes);
      if (pdf.needsPassword()) { setError(`“${f.name}” è protetto da password: aprilo prima e inserisci la password.`); return; }
      setPicked({ name: f.name, size: f.bytes.length, pdf });
    } catch { setError(`“${f.name}” non è un PDF valido.`); }
  };

  const source: { name: string; pdf: CompressSource["pdf"]; size: () => number } | null =
    doc ? { name: doc.name, pdf: doc.pdf, size: () => doc.toBytes().length }
    : picked ? { name: picked.name, pdf: picked.pdf, size: () => picked.size } : null;

  const run = async () => {
    if (!source) return;
    setError(""); setResult("");
    try {
      const original = source.size();
      const p = T.PRESETS.find((x) => x.id === preset)!;
      setProgress([0, 1]);
      const bytes = await T.compress(source, p, (d, t) => setProgress([d, t]));
      setProgress(null);
      const saved = await platform.saveAs(bytes, `${act.stripPdf(source.name)} – compresso.pdf`);
      if (saved) setResult(`Fatto: da ${fmt(original)} a ${fmt(bytes.length)}.`);
    } catch (e) { setProgress(null); setError((e as Error).message); }
  };

  return (
    <Modal title="Comprimi" onClose={onClose}>
      <p className="muted">Crea una copia più leggera ricomprimendo le immagini. Il testo resta selezionabile e ricercabile, e il file originale non cambia.</p>
      {!doc && (
        <div className={"dropzone" + (over ? " over" : "")} style={{ minHeight: 110, marginBottom: 12 }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={async (e) => { e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files).find((x) => /\.pdf$/i.test(x.name)); if (f) pick(await platform.fromFile(f)); }}>
          <div className="dz-empty">
            {picked ? <p><strong>{picked.name}</strong> · {fmt(picked.size)}</p> : <><FilePlus2 size={28} /><p>Trascina qui il PDF da comprimere</p></>}
            <button onClick={async () => pick((await platform.pickPdfs(false))[0])} data-testid="compress-pick">{picked ? "Scegli un altro file…" : "Scegli il file…"}</button>
          </div>
        </div>
      )}
      {T.PRESETS.map((p) => (
        <label key={p.id} className="radio block"><input type="radio" checked={preset === p.id} onChange={() => setPreset(p.id)} />
          <span><strong>{p.label}</strong><small>{p.description}</small></span></label>
      ))}
      {progress && <progress value={progress[0]} max={progress[1]} />}
      {result && <p className="ok" data-testid="compress-result">{result}</p>}
      {error && <p className="error">{error}</p>}
      <Footer><button onClick={onClose}>{result ? "Chiudi" : "Annulla"}</button><button className="primary" disabled={!!progress || !source} onClick={run} data-testid="compress-run">Crea copia…</button></Footer>
    </Modal>
  );
}

const fmt = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------- Password ----------

function ProtectDialog({ doc, onClose }: { doc: PlicoDoc; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const run = async () => {
    if (pw !== pw2) { setError("Le due password non coincidono."); return; }
    try {
      const saved = await platform.saveAs(T.protect(doc, pw), `${act.stripPdf(doc.name)} – protetto.pdf`);
      if (saved) { toast("Copia protetta salvata"); onClose(); }
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title="Salva copia con password" onClose={onClose}>
      <p className="muted">Chi apre la copia dovrà inserire la password (cifratura AES-256). Il documento aperto resta senza protezione.</p>
      <input className="text" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="pw1" autoFocus />
      <input className="text" type="password" placeholder="Ripeti la password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="pw2" />
      {error && <p className="error">{error}</p>}
      <Footer><button onClick={onClose}>Annulla</button><button className="primary" disabled={!pw} onClick={run} data-testid="protect-run">Salva…</button></Footer>
    </Modal>
  );
}

// ---------- Proprietà ----------

function InfoDialog({ doc, onClose }: { doc: PlicoDoc; onClose: () => void }) {
  const [v, setV] = useState({
    "info:Title": doc.getMeta("info:Title"), "info:Author": doc.getMeta("info:Author"),
    "info:Subject": doc.getMeta("info:Subject"), "info:Keywords": doc.getMeta("info:Keywords"),
  });
  const field = (key: keyof typeof v, label: string) => (
    <label className="field"><span>{label}</span><input className="text" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} data-testid={key} /></label>
  );
  return (
    <Modal title="Proprietà del documento" onClose={onClose}>
      {field("info:Title", "Titolo")}{field("info:Author", "Autore")}{field("info:Subject", "Oggetto")}{field("info:Keywords", "Parole chiave")}
      <dl className="facts">
        <dt>Pagine</dt><dd>{doc.pageCount}</dd>
        <dt>Formato</dt><dd>{doc.getMeta("format") || "PDF"}</dd>
        <dt>Cifratura</dt><dd>{doc.getMeta("encryption") || "nessuna"}</dd>
      </dl>
      <Footer><button onClick={onClose}>Annulla</button><button className="primary" data-testid="info-save" onClick={() => { doc.setMeta(v); onClose(); }}>Salva</button></Footer>
    </Modal>
  );
}

// ---------- Immagini ----------

function ImagesDialog({ doc, onClose }: { doc: PlicoDoc; onClose: () => void }) {
  const [format, setFormat] = useState<T.ImageFormat>("png");
  const [dpi, setDpi] = useState(150);
  const [onlySel, setOnlySel] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState("");
  const selected = act.targetPages(doc);

  const run = async () => {
    const folder = await platform.pickFolder();
    if (!folder) return;
    const pages = onlySel ? selected : Array.from({ length: doc.pageCount }, (_, i) => i);
    setProgress([0, pages.length]);
    try {
      for await (const r of T.renderImages(doc, pages, format, dpi, act.stripPdf(doc.name))) {
        await platform.writeInFolder(folder, r.name, r.bytes);
        setProgress([r.done, pages.length]);
      }
      toast(`Esportate ${pages.length} immagini`);
      platform.revealFolder(folder);
      onClose();
    } catch (e) { setError((e as Error).message); setProgress(null); }
  };

  return (
    <Modal title="Esporta come immagini" onClose={onClose}>
      <div className="row">
        <label className="field"><span>Formato</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as T.ImageFormat)}><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
        <label className="field"><span>Risoluzione</span>
          <select value={dpi} onChange={(e) => setDpi(+e.target.value)}><option value={72}>72 dpi (schermo)</option><option value={150}>150 dpi</option><option value={300}>300 dpi (stampa)</option></select></label>
      </div>
      <label className="radio"><input type="radio" checked={!onlySel} onChange={() => setOnlySel(false)} /> Tutte le pagine ({doc.pageCount})</label>
      <label className="radio"><input type="radio" checked={onlySel} onChange={() => setOnlySel(true)} /> Solo le pagine selezionate ({selected.length})</label>
      {progress && <progress value={progress[0]} max={progress[1]} />}
      {error && <p className="error">{error}</p>}
      <Footer><button onClick={onClose}>Annulla</button><button className="primary" disabled={!!progress} onClick={run} data-testid="images-run">Esporta…</button></Footer>
    </Modal>
  );
}

// ---------- Firma ----------

function SignatureDialog({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<[number, number][][]>([]);
  const cur = useRef<[number, number][] | null>(null);
  const [count, setCount] = useState(0);

  const redraw = () => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "rgba(128,128,128,.45)";
    ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(16, 150); ctx.lineTo(424, 150); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = getComputedStyle(document.body).color;
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      ctx.stroke();
    }
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = 440 * dpr; c.height = 180 * dpr;
    redraw();
  }, []);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const save = () => {
    const all = strokes.current.flat();
    if (all.length < 3) return;
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
    const sig: Signature = { id: uid(), aspect: w / h, strokes: strokes.current.map((s) => s.map(([x, y]) => [(x - x0) / w, (y - y0) / h] as [number, number])) };
    const st = useStore.getState();
    saveSignatures([...st.signatures, sig], sig.id);
    st.setTool("signature");
    onClose();
  };

  return (
    <Modal title="Disegna la tua firma" onClose={onClose} width={480}>
      <p className="muted">Tieni premuto e disegna con il mouse, il trackpad o un tablet.</p>
      <canvas ref={canvasRef} className="sig-canvas" style={{ width: 440, height: 180 }} data-testid="sig-canvas"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); cur.current = [pos(e)]; redraw(); }}
        onPointerMove={(e) => { if (cur.current) { cur.current.push(pos(e)); redraw(); } }}
        onPointerUp={() => { if (cur.current) { strokes.current.push(cur.current); cur.current = null; setCount(strokes.current.length); redraw(); } }} />
      <Footer>
        <button onClick={() => { strokes.current = []; cur.current = null; setCount(0); redraw(); }} disabled={!count}>Cancella</button>
        <span className="grow" />
        <button onClick={onClose}>Annulla</button>
        <button className="primary" disabled={!count} onClick={save} data-testid="sig-save">Salva firma</button>
      </Footer>
    </Modal>
  );
}

// ---------- Unisci ----------

interface MergeItem { key: string; name: string; pages: number; pdf: ReturnType<typeof T.openPdf> }

function MergeDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dragKey = useRef<string | null>(null);

  const add = async (files: platform.PickedFile[]) => {
    const added: MergeItem[] = [];
    for (const f of files) {
      try {
        const pdf = T.openPdf(f.bytes);
        if (pdf.needsPassword()) { setError(`“${f.name}” è protetto da password e non può essere unito.`); continue; }
        added.push({ key: uid(), name: f.name, pages: pdf.countPages(), pdf });
      } catch { setError(`“${f.name}” non è un PDF valido.`); }
    }
    setItems((cur) => [...cur, ...added]);
  };

  const move = (key: string, d: number) => setItems((cur) => {
    const i = cur.findIndex((x) => x.key === key), j = i + d;
    if (i < 0 || j < 0 || j >= cur.length) return cur;
    const next = [...cur]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const run = async () => {
    setBusy(true); setError("");
    try {
      const bytes = await T.merge(items);
      const doc = PlicoDoc.open(bytes, "PDF unito.pdf");
      doc.dirty = true;
      useStore.getState().patch({ docs: [...useStore.getState().docs, doc], dialog: null });
      act.activate(doc.id);
      toast("PDF uniti: salva il risultato quando vuoi");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <Modal title="Unisci PDF" onClose={onClose} width={520}>
      <div className={"dropzone" + (over ? " over" : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); const fs = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name)); if (fs.length) add(await Promise.all(fs.map(platform.fromFile))); }}>
        {items.length === 0 ? (
          <div className="dz-empty"><FilePlus2 size={32} /><p>Trascina qui i PDF da unire</p><button onClick={async () => add(await platform.pickPdfs(true))} data-testid="merge-add">Scegli i file…</button></div>
        ) : (
          <ul className="merge-list" data-testid="merge-list">
            {items.map((it, i) => (
              <li key={it.key} draggable onDragStart={() => (dragKey.current = it.key)}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const from = dragKey.current; if (!from || from === it.key) return;
                  setItems((cur) => { const a = cur.findIndex((x) => x.key === from), b = cur.findIndex((x) => x.key === it.key); const next = [...cur]; const [m] = next.splice(a, 1); next.splice(b, 0, m); return next; }); }}>
                <span className="n">{i + 1}</span>
                <span className="grow"><strong>{it.name}</strong><small>{it.pages} pagine</small></span>
                <button className="mini" onClick={() => move(it.key, -1)} disabled={i === 0} title="Su"><ArrowUp size={14} /></button>
                <button className="mini" onClick={() => move(it.key, 1)} disabled={i === items.length - 1} title="Giù"><ArrowDown size={14} /></button>
                <button className="mini" onClick={() => setItems(items.filter((x) => x.key !== it.key))} title="Rimuovi"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <Footer>
        <button onClick={async () => add(await platform.pickPdfs(true))}>Aggiungi…</button>
        <span className="grow" />
        {items.length > 0 && <span className="muted">{items.length} file · {items.reduce((n, x) => n + x.pages, 0)} pagine</span>}
        <button onClick={onClose}>Annulla</button>
        <button className="primary" disabled={items.length < 2 || busy} onClick={run} data-testid="merge-run">Unisci</button>
      </Footer>
    </Modal>
  );
}
