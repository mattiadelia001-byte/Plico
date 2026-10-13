import * as mupdf from "mupdf";
import { TextModel } from "./textModel";

export type Rect = mupdf.Rect;
export type Point = mupdf.Point;
export type Quad = mupdf.Quad;

let counter = 0;
export const uid = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;

export interface OutlineEntry {
  title: string;
  page: number | null;
  children: OutlineEntry[];
}

export interface SearchHit {
  page: number;
  quads: Quad[];
  snippet: string;
}

/** Un documento PDF aperto: contiene il motore MuPDF e tutta la logica di modifica. */
export class PDFolioDoc {
  readonly id = uid();
  name: string;
  path: string | null;
  pdf: mupdf.PDFDocument;
  /** Protetto da password e non ancora sbloccato. */
  locked: boolean;
  dirty = false;
  /** Cambia a ogni modifica visibile (annotazioni, pagine, annulla/ripristina). */
  version = 0;
  /** Cambia quando cambia la struttura delle pagine. */
  structVersion = 0;

  private pageCache = new Map<number, mupdf.PDFPage>();
  private sizeCache = new Map<number, [number, number]>();
  private stextCache = new Map<number, mupdf.StructuredText>();
  private modelCache = new Map<number, TextModel>();
  private listeners = new Set<() => void>();

  private constructor(pdf: mupdf.PDFDocument, name: string, path: string | null) {
    this.pdf = pdf;
    this.name = name;
    this.path = path;
    this.locked = pdf.needsPassword();
    if (!this.locked) this.pdf.enableJournal();
  }

  static open(bytes: Uint8Array, name: string, path: string | null = null): PDFolioDoc {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const pdf = doc.asPDF();
    if (!pdf) throw new Error("Il file non è un PDF valido.");
    return new PDFolioDoc(pdf, name, path);
  }

  static blank(name = "Senza titolo"): PDFolioDoc {
    const pdf = new mupdf.PDFDocument();
    const page = pdf.addPage([0, 0, 595, 842], 0, {}, "");
    pdf.insertPage(-1, page);
    const d = new PDFolioDoc(pdf, name, null);
    return d;
  }

  // ----- sottoscrizione (useSyncExternalStore) -----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.version;

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private clearCaches() {
    this.pageCache.clear();
    this.sizeCache.clear();
    this.stextCache.forEach((s) => s.destroy());
    this.stextCache.clear();
    this.modelCache.clear();
  }

  /** Chiede alla vista di ridisegnare senza segnare il documento come modificato. */
  refresh() {
    this.version++;
    this.notify();
  }

  /** Segna il documento come modificato e avvisa la vista. */
  touch(structural = false) {
    this.dirty = true;
    this.version++;
    if (structural) {
      this.structVersion++;
      this.clearCaches();
    }
    this.notify();
  }

  // ----- password -----

  unlock(password: string): boolean {
    const ok = this.pdf.authenticatePassword(password) > 0;
    if (ok) {
      this.locked = false;
      this.pdf.enableJournal();
      this.clearCaches();
      this.structVersion++;
      this.version++;
      this.notify();
    }
    return ok;
  }

  // ----- pagine -----

  get pageCount(): number {
    return this.locked ? 0 : this.pdf.countPages();
  }

  page(i: number): mupdf.PDFPage {
    let p = this.pageCache.get(i);
    if (!p) {
      p = this.pdf.loadPage(i);
      this.pageCache.set(i, p);
    }
    return p;
  }

  /** Dimensioni in punti PDF (già ruotate e ritagliate). */
  size(i: number): [number, number] {
    let s = this.sizeCache.get(i);
    if (!s) {
      const b = this.page(i).getBounds();
      s = [b[2] - b[0], b[3] - b[1]];
      this.sizeCache.set(i, s);
    }
    return s;
  }

  /** Disegna una pagina in un buffer RGBA. `sx`/`sy` = pixel per punto PDF. */
  render(i: number, sx: number, sy = sx): ImageData {
    const pm = this.page(i).toPixmap(mupdf.Matrix.scale(sx, sy), mupdf.ColorSpace.DeviceRGB, false, true);
    try {
      const w = pm.getWidth(), h = pm.getHeight(), n = pm.getNumberOfComponents(), stride = pm.getStride();
      const src = pm.getPixels();
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        let s = y * stride, d = y * w * 4;
        for (let x = 0; x < w; x++, s += n, d += 4) {
          out[d] = src[s];
          out[d + 1] = src[s + 1];
          out[d + 2] = src[s + 2];
          out[d + 3] = 255;
        }
      }
      return new ImageData(out, w, h);
    } finally {
      pm.destroy();
    }
  }

  stext(i: number): mupdf.StructuredText {
    let s = this.stextCache.get(i);
    if (!s) {
      s = this.page(i).toStructuredText("preserve-whitespace");
      this.stextCache.set(i, s);
    }
    return s;
  }

  /** Modello del testo per selezionare e evidenziare in modo robusto. */
  textModel(i: number): TextModel {
    let m = this.modelCache.get(i);
    if (!m) {
      m = TextModel.build(this.stext(i));
      this.modelCache.set(i, m);
    }
    return m;
  }

  // ----- operazioni annullabili -----

  /** Esegue `fn` come singola operazione annullabile. */
  run<T>(name: string, fn: () => T, structural = false): T {
    this.pdf.beginOperation(name);
    try {
      const r = fn();
      this.pdf.endOperation();
      this.touch(structural);
      return r;
    } catch (e) {
      this.pdf.abandonOperation();
      throw e;
    }
  }

  get canUndo() { return !this.locked && this.pdf.canUndo(); }
  get canRedo() { return !this.locked && this.pdf.canRedo(); }

  undo() {
    if (!this.canUndo) return;
    this.pdf.undo();
    this.touch(true);
  }

  redo() {
    if (!this.canRedo) return;
    this.pdf.redo();
    this.touch(true);
  }

  // ----- struttura delle pagine -----

  rotate(pages: number[], delta: number) {
    this.run("Ruota", () => {
      for (const i of pages) {
        const obj = this.page(i).getObject();
        const cur = obj.getInheritable("Rotate");
        const now = cur.isNull() ? 0 : cur.asNumber();
        obj.put("Rotate", (((now + delta) % 360) + 360) % 360);
      }
    }, true);
  }

  deletePages(pages: number[]): boolean {
    if (pages.length >= this.pageCount) return false;
    this.run("Elimina pagine", () => {
      for (const i of [...pages].sort((a, b) => b - a)) this.pdf.deletePage(i);
    }, true);
    return true;
  }

  insertBlank(after: number) {
    const [w, h] = this.size(Math.min(after, this.pageCount - 1));
    this.run("Inserisci pagina vuota", () => {
      const obj = this.pdf.addPage([0, 0, w, h], 0, {}, "");
      this.pdf.insertPage(after + 1, obj);
    }, true);
  }

  duplicatePages(pages: number[]) {
    const sorted = [...pages].sort((a, b) => a - b);
    const last = sorted[sorted.length - 1];
    this.run("Duplica pagine", () => {
      sorted.forEach((p, k) => graftPage(this.pdf, last + 1 + k, this.pdf, p));
    }, true);
  }

  /** Inserisce tutte le pagine di `src` a partire dalla posizione `at` (compresa tra 0 e pageCount). */
  insertDocument(src: mupdf.PDFDocument, at: number) {
    const n = src.countPages();
    this.run("Inserisci PDF", () => {
      for (let k = 0; k < n; k++) graftPage(this.pdf, at + k, src, k);
    }, true);
  }

  /** `order[k]` è l'indice (nel documento attuale) della pagina che deve finire in posizione k. */
  reorder(order: number[]) {
    this.run("Sposta pagine", () => this.pdf.rearrangePages(order), true);
  }

  setCropBox(i: number, rectPageSpace: Rect) {
    const page = this.page(i);
    // MuPDF converte da solo dalle coordinate della pagina (già ruotata e ritagliata) a quelle del PDF
    this.run("Ritaglia", () => page.setPageBox("CropBox", rectPageSpace), true);
  }

  resetCrop(pages: number[]) {
    this.run("Ripristina ritaglio", () => {
      for (const i of pages) {
        const obj = this.page(i).getObject();
        if (!obj.get("CropBox").isNull()) obj.delete("CropBox");
      }
    }, true);
  }

  // ----- metadati -----

  getMeta(key: string): string {
    return this.pdf.getMetaData(key) ?? "";
  }

  setMeta(values: Record<string, string>) {
    this.run("Modifica proprietà", () => {
      for (const [k, v] of Object.entries(values)) this.pdf.setMetaData(k, v);
    });
  }

  // ----- indice e ricerca -----

  outline(): OutlineEntry[] {
    const conv = (items: any[] | null): OutlineEntry[] =>
      (items ?? []).map((it) => ({
        title: it.title ?? "Senza titolo",
        page: typeof it.page === "number" && it.page >= 0 ? it.page : this.resolvePage(it.uri),
        children: conv(it.down ?? null),
      }));
    try {
      return conv(this.pdf.loadOutline());
    } catch {
      return [];
    }
  }

  private resolvePage(uri?: string): number | null {
    if (!uri) return null;
    try {
      const p = this.pdf.resolveLink(uri);
      return p >= 0 ? p : null;
    } catch {
      return null;
    }
  }

  search(query: string, limit = 500): SearchHit[] {
    const hits: SearchHit[] = [];
    const q = query.trim();
    if (!q) return hits;
    for (let i = 0; i < this.pageCount && hits.length < limit; i++) {
      const results = this.page(i).search(q, {});
      if (!results.length) continue;
      const st = this.stext(i);
      for (const quads of results) {
        if (hits.length >= limit) break;
        hits.push({ page: i, quads, snippet: snippetAround(st, quads) });
      }
    }
    return hits;
  }

  // ----- salvataggio -----

  toBytes(options = "garbage=compact,compress=yes"): Uint8Array {
    const buf = this.pdf.saveToBuffer(options);
    const bytes = buf.asUint8Array().slice();
    buf.destroy();
    return bytes;
  }

  markSaved(path?: string, name?: string) {
    if (path !== undefined) this.path = path;
    if (name !== undefined) this.name = name;
    this.dirty = false;
    this.version++;
    this.notify();
  }
}

function snippetAround(st: mupdf.StructuredText, quads: Quad[]): string {
  const q = quads[0];
  if (!q) return "";
  const ys = [q[1], q[3], q[5], q[7]];
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
  try {
    const line = st.copy([0, midY], [100000, midY]).trim().replace(/\s+/g, " ");
    return line.length > 120 ? line.slice(0, 120) + "…" : line;
  } catch {
    return "";
  }
}

/**
 * Copia una pagina da `src` a `dst` mantenendo le annotazioni.
 * `graftPage` di MuPDF le scarta, quindi le ricopio una per una.
 * Restano fuori link e campi dei moduli, che puntano a oggetti del documento di origine.
 */
export function graftPage(dst: mupdf.PDFDocument, to: number, src: mupdf.PDFDocument, srcIndex: number) {
  dst.graftPage(to, src, srcIndex);
  const destIndex = to < 0 ? dst.countPages() - 1 : to;
  const srcAnnots = src.findPage(srcIndex).get("Annots");
  if (srcAnnots.isNull() || !srcAnnots.isArray() || srcAnnots.length === 0) return;

  const map = dst.newGraftMap();
  const out = dst.newArray();
  const skip = new Set(["P", "Parent", "Popup", "IRT", "Dest", "A", "Next", "Prev"]);
  const skipTypes = new Set(["Link", "Widget", "Popup"]);
  for (let k = 0; k < srcAnnots.length; k++) {
    const a = srcAnnots.get(k).resolve();
    if (!a.isDictionary()) continue;
    const sub = a.get("Subtype");
    if (sub.isNull() || skipTypes.has(sub.asName())) continue;
    const copy = dst.newDictionary();
    a.forEach((val, key) => {
      if (skip.has(String(key))) return;
      copy.put(String(key), map.graftObject(val));
    });
    out.push(dst.addObject(copy));
  }
  if (out.length > 0) dst.findPage(destIndex).put("Annots", out);
}
