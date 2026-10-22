import * as mupdf from "mupdf";
import type { PlicoDoc, Point, Quad, Rect } from "./plicoDoc";

export type RGB = [number, number, number];

export interface Style {
  color: string; // #rrggbb
  width: number;
  fontSize: number;
}

export interface Signature {
  id: string;
  /** Tratti normalizzati nel riquadro 0..1 (y verso il basso). Vuoti se la firma è un'immagine. */
  strokes: Point[][];
  /** larghezza / altezza */
  aspect: number;
  /** Firma da foto: PNG (data URL) con inchiostro nero su sfondo trasparente. */
  image?: string;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: number[]): string {
  const [r, g, b] = c.length === 1 ? [c[0], c[0], c[0]] : c;
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Con la fusione “moltiplica” di MuPDF il testo resta nero e il colore è vivo. */
const HIGHLIGHT_OPACITY = 1;

export type MarkupKind = "Highlight" | "Underline" | "StrikeOut";
export type ShapeKind = "Square" | "Circle";

/** Tipi che l'utente può selezionare, spostare ed eliminare. */
export const SIGNATURE_LABEL = "Firma";
const EDITABLE = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly", "Square", "Circle", "Line", "Ink", "FreeText", "Text", "Stamp"]);
export const isEditable = (type: string) => EDITABLE.has(type);
export const isMarkup = (type: string) => type === "Highlight" || type === "Underline" || type === "StrikeOut" || type === "Squiggly";
export const isResizable = (type: string) => type === "Square" || type === "Circle" || type === "FreeText" || type === "Ink" || type === "Stamp";
/** Le firme si ridimensionano senza deformarsi. */
export const keepsAspect = (ref: { type: string; contents: string }) => ref.type === "Stamp" || ref.contents === SIGNATURE_LABEL;
export const isMovable = (type: string) => !isMarkup(type);

export interface AnnotRef {
  /** numero dell'oggetto PDF: resta stabile anche se ricarico la pagina */
  id: number;
  page: number;
  type: string;
  bounds: Rect;
  contents: string;
  color: string;
  width: number;
  fontSize: number;
}

function objId(a: mupdf.PDFAnnotation): number {
  const o = a.getObject();
  return o.isIndirect() ? o.asIndirect() : -1;
}

export function describe(a: mupdf.PDFAnnotation, page: number): AnnotRef {
  const type = a.getType();
  let color = "#000000";
  let fontSize = 16;
  try {
    if (type === "FreeText") {
      const da = a.getDefaultAppearance();
      color = rgbToHex(da.color.length ? da.color : [0]);
      fontSize = da.size;
    } else {
      const c = a.getColor();
      if (c.length) color = rgbToHex(c);
    }
  } catch { /* colore non disponibile */ }
  let width = 1;
  try { width = a.getBorderWidth(); } catch { /* nessun bordo */ }
  let contents = "";
  try { contents = a.getContents(); } catch { /* nessun testo */ }
  return { id: objId(a), page, type, bounds: a.getBounds(), contents, color, width, fontSize };
}

export function listAnnotations(doc: PlicoDoc, page: number): { ref: AnnotRef; annot: mupdf.PDFAnnotation }[] {
  return doc
    .page(page)
    .getAnnotations()
    .filter((a) => isEditable(a.getType()))
    .map((annot) => ({ ref: describe(annot, page), annot }));
}

export function findAnnotation(doc: PlicoDoc, page: number, id: number): mupdf.PDFAnnotation | null {
  return doc.page(page).getAnnotations().find((a) => objId(a) === id) ?? null;
}

/** Annotazione sotto il punto (coordinate pagina). Le evidenziazioni si prendono solo se `includeMarkup`. */
export function hitTest(doc: PlicoDoc, page: number, p: Point, tol: number, includeMarkup: boolean): AnnotRef | null {
  const list = listAnnotations(doc, page).reverse();
  for (const { ref, annot } of list) {
    if (isMarkup(ref.type) && !includeMarkup) continue;
    if (hits(annot, ref, p, tol)) return ref;
  }
  return null;
}

function hits(a: mupdf.PDFAnnotation, ref: AnnotRef, p: Point, tol: number): boolean {
  const [x0, y0, x1, y1] = ref.bounds;
  if (ref.type === "Line") {
    const [s, e] = a.getLine();
    return distToSegment(p, s, e) <= tol + ref.width / 2 + 2;
  }
  if (isMarkup(ref.type)) {
    for (const q of a.getQuadPoints()) {
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      if (p[0] >= Math.min(...xs) - tol && p[0] <= Math.max(...xs) + tol && p[1] >= Math.min(...ys) - tol && p[1] <= Math.max(...ys) + tol) return true;
    }
    return false;
  }
  if (ref.type === "Ink") {
    for (const stroke of a.getInkList()) {
      for (let i = 1; i < stroke.length; i++) if (distToSegment(p, stroke[i - 1], stroke[i]) <= tol + ref.width / 2 + 2) return true;
    }
    return false;
  }
  return p[0] >= x0 - tol && p[0] <= x1 + tol && p[1] >= y0 - tol && p[1] <= y1 + tol;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// ----- creazione -----

export function createMarkup(doc: PlicoDoc, page: number, kind: MarkupKind, quads: Quad[], color: string) {
  if (!quads.length) return;
  doc.run(markupName(kind), () => {
    const a = doc.page(page).createAnnotation(kind);
    a.setColor(hexToRgb(color));
    if (kind === "Highlight") a.setOpacity(HIGHLIGHT_OPACITY);
    const model = doc.textModel(page);
    a.setQuadPoints(kind === "Highlight" ? quads.map((q) => trimToInk(doc, page, model.tighten(q))) : quads);
    a.update();
    if (kind === "Highlight") squareHighlight(doc, a);
  });
}

/**
 * Accorcia la barra ai lati: il riquadro di un carattere comprende un po' di aria prima della prima lettera
 * e dopo l'ultima. Disegno la pagina (senza annotazioni) nella sola zona della barra e guardo dove inizia
 * e finisce l'inchiostro. Se qualcosa non torna, lascio la barra com'è.
 */
function trimToInk(doc: PlicoDoc, page: number, q: Quad): Quad {
  const K = 4, PAD = 0.3;
  const x0 = q[0], x1 = q[2], y0 = q[1], y1 = q[5];
  if (!(x1 - x0 > 2) || !(y1 - y0 > 2)) return q;
  let pm: mupdf.Pixmap | null = null, dev: mupdf.DrawDevice | null = null;
  try {
    pm = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [Math.floor(x0 * K), Math.floor(y0 * K), Math.ceil(x1 * K), Math.ceil(y1 * K)], false);
    pm.clear(255);
    dev = new mupdf.DrawDevice(mupdf.Matrix.scale(K, K), pm);
    doc.page(page).runPageContents(dev, mupdf.Matrix.identity);
    dev.close();
    const w = pm.getWidth(), h = pm.getHeight(), n = pm.getNumberOfComponents(), stride = pm.getStride(), px = pm.getPixels();
    // colore di fondo: valore centrale della riga in alto
    const bg = [0, 1, 2].map((c) => {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(px[x * n + c]);
      return row.sort((a, b) => a - b)[w >> 1];
    });
    const inked = (x: number) => {
      for (let y = 0; y < h; y++) {
        const i = y * stride + x * n;
        if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 90) return true;
      }
      return false;
    };
    let l = 0, r = w - 1;
    while (l < w && !inked(l)) l++;
    while (r > l && !inked(r)) r--;
    if (l >= w) return q; // niente inchiostro (testo invisibile o immagine): non tocco nulla
    const nx0 = Math.max(x0, Math.floor(x0 * K) / K + l / K - PAD);
    const nx1 = Math.min(x1, Math.floor(x0 * K) / K + (r + 1) / K + PAD);
    return nx1 - nx0 > 1 ? [nx0, q[1], nx1, q[3], nx0, q[5], nx1, q[7]] : q;
  } catch {
    return q;
  } finally {
    dev?.destroy();
    pm?.destroy();
  }
}

/**
 * MuPDF disegna le evidenziazioni con gli estremi arrotondati e un po' più alte del dovuto.
 * Scrivo io l'aspetto: rettangoli netti sulle righe, con fusione “moltiplica” così il testo resta nero.
 * Va richiamato dopo ogni `update()`, che rigenera l'aspetto di serie.
 */
function squareHighlight(doc: PlicoDoc, a: mupdf.PDFAnnotation) {
  const obj = a.getObject();
  const rect = obj.get("Rect").asJS() as number[];
  const quads = obj.get("QuadPoints").asJS() as number[];
  const c = obj.get("C").asJS() as number[];
  let body = "";
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const q = quads.slice(i, i + 8);
    // ordine dei punti: alto-sx, alto-dx, basso-sx, basso-dx → poligono alto-sx, alto-dx, basso-dx, basso-sx
    body += `${q[0]} ${q[1]} m ${q[2]} ${q[3]} l ${q[6]} ${q[7]} l ${q[4]} ${q[5]} l h f\n`;
  }
  let alpha = 1;
  try { alpha = a.getOpacity(); } catch { /* opacità piena */ }
  const stream = doc.pdf.addStream(`/GS gs ${(c.length ? c : [1, 0.84, 0.04]).join(" ")} rg\n${body}`, {
    Type: "XObject",
    Subtype: "Form",
    BBox: rect,
    Resources: { ExtGState: { GS: { Type: "ExtGState", BM: "Multiply", ca: alpha, CA: alpha } } },
  });
  let ap = obj.get("AP");
  if (ap.isNull()) { obj.put("AP", doc.pdf.newDictionary()); ap = obj.get("AP"); }
  ap.put("N", stream);
}

const markupName = (k: MarkupKind) => (k === "Highlight" ? "Evidenzia" : k === "Underline" ? "Sottolinea" : "Barra testo");

export function createShape(doc: PlicoDoc, page: number, kind: ShapeKind, rect: Rect, style: Style): number {
  return doc.run(kind === "Square" ? "Rettangolo" : "Ovale", () => {
    const a = doc.page(page).createAnnotation(kind);
    a.setRect(rect);
    a.setColor(hexToRgb(style.color));
    a.setBorderWidth(style.width);
    a.update();
    return objId(a);
  });
}

export function createLine(doc: PlicoDoc, page: number, p1: Point, p2: Point, arrow: boolean, style: Style): number {
  return doc.run(arrow ? "Freccia" : "Linea", () => {
    const a = doc.page(page).createAnnotation("Line");
    a.setLine(p1, p2);
    if (arrow) {
      a.setLineEndingStyles("None", "ClosedArrow");
      a.setInteriorColor(hexToRgb(style.color));
    }
    a.setColor(hexToRgb(style.color));
    a.setBorderWidth(style.width);
    a.update();
    return objId(a);
  });
}

export function createInk(doc: PlicoDoc, page: number, strokes: Point[][], style: Style, name = "Disegno", contents?: string): number {
  return doc.run(name, () => {
    const a = doc.page(page).createAnnotation("Ink");
    a.setColor(hexToRgb(style.color));
    a.setBorderWidth(style.width);
    a.setInkList(strokes);
    if (contents) a.setContents(contents);
    a.update();
    return objId(a);
  });
}

export function createNote(doc: PlicoDoc, page: number, at: Point, text: string, color: string): number {
  return doc.run("Nota", () => {
    const a = doc.page(page).createAnnotation("Text");
    a.setRect([at[0], at[1], at[0] + 24, at[1] + 24]);
    a.setColor(hexToRgb(color));
    a.setContents(text);
    a.update();
    return objId(a);
  });
}

export function createFreeText(doc: PlicoDoc, page: number, topLeft: Point, text: string, style: Style, width?: number): number {
  const size = measureText(text, style.fontSize, width);
  return doc.run("Testo", () => {
    const a = doc.page(page).createAnnotation("FreeText");
    a.setRect([topLeft[0], topLeft[1], topLeft[0] + size[0], topLeft[1] + size[1]]);
    a.setDefaultAppearance("Helv", style.fontSize, hexToRgb(style.color));
    a.setContents(text);
    a.update();
    return objId(a);
  });
}

/** Spessore del tratto di una firma disegnata, in proporzione alla sua larghezza. */
export const signatureStrokeWidth = (width: number) => Math.max(1.4, width / 80);

export function createSignature(doc: PlicoDoc, page: number, sig: Signature, center: Point, width: number, color: string): number {
  const height = width / Math.max(sig.aspect, 0.1);
  const ox = center[0] - width / 2, oy = center[1] - height / 2;
  const strokes = sig.strokes.map((s) => s.map((p): Point => [ox + p[0] * width, oy + p[1] * height]));
  return createInk(doc, page, strokes, { color, width: signatureStrokeWidth(width), fontSize: 12 }, "Firma", SIGNATURE_LABEL);
}

/** Firma da immagine: un timbro con lo sfondo trasparente, che si sposta e si ridimensiona come le altre forme. */
export function createSignatureImage(doc: PlicoDoc, page: number, png: Uint8Array, aspect: number, center: Point, width: number): number {
  const height = width / Math.max(aspect, 0.1);
  return doc.run("Firma", () => {
    const a = doc.page(page).createAnnotation("Stamp");
    a.setStampImage(new mupdf.Image(png));
    a.setRect([center[0] - width / 2, center[1] - height / 2, center[0] + width / 2, center[1] + height / 2]);
    a.setContents(SIGNATURE_LABEL);
    a.update();
    return objId(a);
  });
}

/** Misura il testo (Helvetica) per dimensionare la casella di un testo libero. */
export function measureText(text: string, fontSize: number, maxWidth = 360): [number, number] {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = `${fontSize}px Helvetica, Arial, sans-serif`;
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  return [Math.ceil(w) + 10, Math.ceil(lines.length * fontSize * 1.25) + 6];
}

// ----- modifica -----

export function moveAnnotation(doc: PlicoDoc, page: number, id: number, dx: number, dy: number) {
  const a = findAnnotation(doc, page, id);
  if (!a) return;
  doc.run("Sposta", () => translate(a, dx, dy));
}

/** Sposta senza registrare un'operazione (per l'anteprima durante il trascinamento). */
export function translate(a: mupdf.PDFAnnotation, dx: number, dy: number) {
  const type = a.getType();
  if (type === "Ink") {
    a.setInkList(a.getInkList().map((s) => s.map((p): Point => [p[0] + dx, p[1] + dy])));
  } else if (type === "Line") {
    const [s, e] = a.getLine();
    a.setLine([s[0] + dx, s[1] + dy], [e[0] + dx, e[1] + dy]);
  } else {
    const r = a.getRect();
    a.setRect([r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]);
  }
  a.update();
}

export function resizeAnnotation(doc: PlicoDoc, page: number, id: number, next: Rect) {
  const a = findAnnotation(doc, page, id);
  if (!a) return;
  doc.run("Ridimensiona", () => {
    const type = a.getType();
    if (type === "Ink") {
      // la scala si calcola sui punti veri del tratto; il riquadro include anche lo spessore
      const strokes = a.getInkList();
      const xs = strokes.flat().map((p) => p[0]), ys = strokes.flat().map((p) => p[1]);
      const [mx0, my0, mx1, my1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const [bx0, by0, bx1, by1] = a.getBounds();
      const [nx0, ny0, nx1, ny1] = [next[0] + (mx0 - bx0), next[1] + (my0 - by0), next[2] - (bx1 - mx1), next[3] - (by1 - my1)];
      const sx = Math.max(nx1 - nx0, 1) / Math.max(mx1 - mx0, 1e-3), sy = Math.max(ny1 - ny0, 1) / Math.max(my1 - my0, 1e-3);
      a.setInkList(strokes.map((s) => s.map((p): Point => [nx0 + (p[0] - mx0) * sx, ny0 + (p[1] - my0) * sy])));
      if (a.getContents() === SIGNATURE_LABEL) a.setBorderWidth(Math.max(0.8, a.getBorderWidth() * Math.sqrt(sx * sy)));
    } else {
      a.setRect(next);
    }
    a.update();
  });
}

export function deleteAnnotation(doc: PlicoDoc, page: number, id: number) {
  const a = findAnnotation(doc, page, id);
  if (!a) return;
  doc.run("Elimina annotazione", () => doc.page(page).deleteAnnotation(a));
}

export function setAnnotationStyle(doc: PlicoDoc, page: number, id: number, patch: Partial<Style>) {
  const a = findAnnotation(doc, page, id);
  if (!a) return;
  const type = a.getType();
  doc.run("Stile", () => {
    if (type === "FreeText") {
      const da = a.getDefaultAppearance();
      a.setDefaultAppearance(da.font || "Helv", patch.fontSize ?? da.size, patch.color ? hexToRgb(patch.color) : da.color);
    } else {
      if (patch.color) {
        a.setColor(hexToRgb(patch.color));
        if (type === "Line") { try { a.setInteriorColor(hexToRgb(patch.color)); } catch { /* senza punta */ } }
      }
      if (patch.width !== undefined && !isMarkup(type) && type !== "Text") a.setBorderWidth(patch.width);
    }
    a.update();
    if (type === "Highlight") squareHighlight(doc, a); // update() ha rigenerato l'aspetto tondo
  });
}

export function setAnnotationText(doc: PlicoDoc, page: number, id: number, text: string) {
  const a = findAnnotation(doc, page, id);
  if (!a) return;
  doc.run("Modifica testo", () => {
    a.setContents(text);
    if (a.getType() === "FreeText") {
      const da = a.getDefaultAppearance();
      const r = a.getRect();
      const size = measureText(text, da.size, Math.max(r[2] - r[0], 120));
      a.setRect([r[0], r[1], r[0] + Math.max(size[0], r[2] - r[0]), r[1] + size[1]]);
    }
    a.update();
  });
}

export function hideForEditing(doc: PlicoDoc, page: number, id: number, hidden: boolean, refresh = true) {
  const a = findAnnotation(doc, page, id);
  if (!a) return;
  a.setHiddenForEditing(hidden);
  if (refresh) doc.refresh();
}

/**
 * Immagine dell'annotazione da sola, con sfondo trasparente.
 * Serve a mostrarla mentre la si trascina, così si muove insieme al suo bordo.
 * `rect` è la posizione in coordinate pagina.
 */
export function annotationSprite(doc: PlicoDoc, page: number, id: number, scale: number): { url: string; rect: Rect } | null {
  const a = findAnnotation(doc, page, id);
  if (!a) return null;
  const pm = a.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, true);
  try {
    const w = pm.getWidth(), h = pm.getHeight(), n = pm.getNumberOfComponents(), stride = pm.getStride();
    const src = pm.getPixels();
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      let s = y * stride, d = y * w * 4;
      for (let x = 0; x < w; x++, s += n, d += 4) {
        const al = n > 3 ? src[s + 3] : 255;
        // MuPDF restituisce i colori già moltiplicati per la trasparenza: li riporto a colori pieni
        const k = al > 0 && al < 255 ? 255 / al : 1;
        out[d] = src[s] * k; out[d + 1] = src[s + 1] * k; out[d + 2] = src[s + 2] * k; out[d + 3] = al;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.putImageData(new ImageData(out, w, h), 0, 0);
    const x = pm.getX(), y = pm.getY();
    return { url: canvas.toDataURL("image/png"), rect: [x / scale, y / scale, (x + w) / scale, (y + h) / scale] };
  } finally {
    pm.destroy();
  }
}
