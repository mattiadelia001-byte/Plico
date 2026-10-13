import { create } from "zustand";
import type { PDFolioDoc, Quad, SearchHit } from "../engine/pdfolioDoc";
import type { Signature } from "../engine/annotations";

export type ToolId =
  | "select" | "highlight" | "underline" | "strike" | "text" | "note"
  | "rect" | "oval" | "line" | "arrow" | "draw" | "signature" | "crop";

export type SidebarMode = "thumbs" | "outline" | "annots" | "search";
export type Layout = "continuous" | "single" | "two";
export type Fit = "width" | "page" | "none";
export type DialogId = "split" | "compress" | "protect" | "info" | "images" | "signature" | "merge" | null;

export const TOOL_COLORS: Partial<Record<ToolId, string>> = {
  highlight: "#ffd60a",
  underline: "#ff3b30",
  strike: "#ff3b30",
  signature: "#111111",
};

export interface TextSelection {
  page: number;
  quads: Quad[];
  text: string;
}

export interface SelectedAnnot {
  page: number;
  id: number;
}

interface State {
  docs: PDFolioDoc[];
  activeId: string | null;

  sidebar: boolean;
  sidebarMode: SidebarMode;
  markupBar: boolean;
  tool: ToolId;
  color: string;
  width: number;
  fontSize: number;

  zoom: number;
  fit: Fit;
  layout: Layout;
  currentPage: number;
  selectedPages: number[];

  selection: TextSelection | null;
  selectedAnnot: SelectedAnnot | null;

  searchQuery: string;
  hits: SearchHit[];
  hitIndex: number;

  dialog: DialogId;
  toast: string | null;
  busy: string | null;

  signatures: Signature[];
  signatureId: string | null;

  patch: (p: Partial<State>) => void;
  setTool: (t: ToolId) => void;
}

const loadSignatures = (): Signature[] => {
  try { return JSON.parse(localStorage.getItem("folio.signatures") ?? "[]"); } catch { return []; }
};

export const useStore = create<State>((set, get) => ({
  docs: [],
  activeId: null,

  sidebar: true,
  sidebarMode: "thumbs",
  markupBar: false,
  tool: "select",
  color: "#ff3b30",
  width: 3,
  fontSize: 16,

  zoom: 1,
  fit: "width",
  layout: "continuous",
  currentPage: 0,
  selectedPages: [0],

  selection: null,
  selectedAnnot: null,

  searchQuery: "",
  hits: [],
  hitIndex: 0,

  dialog: null,
  toast: null,
  busy: null,

  signatures: loadSignatures(),
  signatureId: loadSignatures().slice(-1)[0]?.id ?? null,

  patch: (p) => set(p),
  setTool: (t) => {
    const prev = get().tool;
    const p: Partial<State> = { tool: t, selection: null };
    if (t !== "select") p.selectedAnnot = null;
    const preset = TOOL_COLORS[t];
    if (preset) p.color = preset;
    else if (prev !== t && TOOL_COLORS[prev]) p.color = "#ff3b30";
    if (t !== "select") p.markupBar = true;
    // senza firme salvate, scegliere lo strumento apre subito la finestra per disegnarne una
    if (t === "signature" && get().signatures.length === 0) p.dialog = "signature";
    set(p);
  },
}));

export const activeDoc = (s: { docs: PDFolioDoc[]; activeId: string | null }) =>
  s.docs.find((d) => d.id === s.activeId) ?? null;

export function saveSignatures(list: Signature[], selected: string | null) {
  localStorage.setItem("folio.signatures", JSON.stringify(list));
  useStore.getState().patch({ signatures: list, signatureId: selected });
}

let toastTimer: number | undefined;
export function toast(message: string, ms = 3500) {
  useStore.getState().patch({ toast: message });
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => useStore.getState().patch({ toast: null }), ms);
}
