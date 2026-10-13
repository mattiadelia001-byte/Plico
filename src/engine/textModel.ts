import type * as mupdf from "mupdf";
import type { Quad } from "./folioDoc";

export interface Ch { c: string; x0: number; x1: number; y0: number; y1: number }
export interface TLine { chars: Ch[]; x0: number; x1: number; y0: number; y1: number }
/** Posizione tra due caratteri: `ch` è l'indice di inserimento (0..lunghezza). */
export interface Pos { line: number; ch: number }
export interface Range { quads: Quad[]; text: string }

const isSpace = (c: string) => /\s/.test(c);
const cmp = (a: Pos, b: Pos) => (a.line !== b.line ? a.line - b.line : a.ch - b.ch);

/**
 * Modello del testo di una pagina, costruito dal testo strutturato di MuPDF.
 * Serve a selezionare anche partendo da un punto fuori dalle lettere (tra due righe, a lato,
 * sopra la prima riga): la selezione si aggancia sempre alla riga e alla lettera più vicine,
 * e ogni riga viene evidenziata con una barra alta come la riga stessa.
 */
export class TextModel {
  lines: TLine[] = [];

  static build(st: mupdf.StructuredText): TextModel {
    const m = new TextModel();
    let cur: TLine | null = null;
    st.walk({
      beginLine() { cur = { chars: [], x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }; },
      onChar(c, _origin, _font, _size, q) {
        if (!cur) return;
        const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
        const ch = { c, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        cur.chars.push(ch);
        cur.x0 = Math.min(cur.x0, ch.x0); cur.x1 = Math.max(cur.x1, ch.x1);
        cur.y0 = Math.min(cur.y0, ch.y0); cur.y1 = Math.max(cur.y1, ch.y1);
      },
      endLine() {
        if (cur && cur.chars.some((k) => !isSpace(k.c))) m.lines.push(cur);
        cur = null;
      },
    });
    return m;
  }

  get empty() { return this.lines.length === 0; }

  /** Posizione di inserimento più vicina al punto (coordinate pagina). */
  locate(x: number, y: number): Pos | null {
    if (!this.lines.length) return null;
    let best = -1, bestScore = Infinity;
    this.lines.forEach((l, i) => {
      const dy = y < l.y0 ? l.y0 - y : y > l.y1 ? y - l.y1 : 0;
      const dx = x < l.x0 ? l.x0 - x : x > l.x1 ? x - l.x1 : 0;
      const score = dy * 1000 + dx; // la riga conta più della distanza laterale
      if (score < bestScore) { bestScore = score; best = i; }
    });
    const l = this.lines[best];
    let ch = l.chars.length;
    for (let i = 0; i < l.chars.length; i++) {
      if (x < (l.chars[i].x0 + l.chars[i].x1) / 2) { ch = i; break; }
    }
    return { line: best, ch };
  }

  /** Indice del carattere più vicino al punto, nella riga di `p`. */
  private nearestChar(p: Pos, x: number): number {
    const l = this.lines[p.line];
    let best = 0, bd = Infinity;
    l.chars.forEach((k, i) => {
      // a parità di distanza (bordo tra due caratteri) vince la lettera, non lo spazio
      const d = (x < k.x0 ? k.x0 - x : x > k.x1 ? x - k.x1 : 0) + (isSpace(k.c) ? 2.5 : 0);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  range(a: Pos, b: Pos): Range {
    if (cmp(a, b) > 0) [a, b] = [b, a];
    const quads: Quad[] = [];
    const parts: string[] = [];
    for (let li = a.line; li <= b.line; li++) {
      const l = this.lines[li];
      const from = li === a.line ? a.ch : 0;
      const to = li === b.line ? b.ch : l.chars.length;
      let seg = l.chars.slice(from, to);
      while (seg.length && isSpace(seg[0].c)) seg = seg.slice(1);
      while (seg.length && isSpace(seg[seg.length - 1].c)) seg = seg.slice(0, -1);
      if (!seg.length) continue;
      const x0 = seg[0].x0, x1 = seg[seg.length - 1].x1;
      quads.push([x0, l.y0, x1, l.y0, x0, l.y1, x1, l.y1]);
      parts.push(seg.map((k) => k.c).join(""));
    }
    return { quads, text: parts.join("\n") };
  }

  /** Selezione tra due punti. */
  between(x0: number, y0: number, x1: number, y1: number): Range {
    const a = this.locate(x0, y0), b = this.locate(x1, y1);
    return a && b ? this.range(a, b) : { quads: [], text: "" };
  }

  word(x: number, y: number): Range {
    const p = this.locate(x, y);
    if (!p) return { quads: [], text: "" };
    const l = this.lines[p.line];
    let i = this.nearestChar(p, x);
    if (isSpace(l.chars[i].c)) return { quads: [], text: "" };
    let s = i, e = i;
    while (s > 0 && !isSpace(l.chars[s - 1].c)) s--;
    while (e < l.chars.length - 1 && !isSpace(l.chars[e + 1].c)) e++;
    return this.range({ line: p.line, ch: s }, { line: p.line, ch: e + 1 });
  }

  line(x: number, y: number): Range {
    const p = this.locate(x, y);
    if (!p) return { quads: [], text: "" };
    return this.range({ line: p.line, ch: 0 }, { line: p.line, ch: this.lines[p.line].chars.length });
  }
}
