import {
  MousePointer2, Highlighter, Underline, Strikethrough, Type, StickyNote, Square, Circle, Minus, MoveUpRight,
  Pencil, PenLine, Crop, Trash2, X, ChevronDown,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import { SignatureThumb } from "./SignatureThumb";
import { activeDoc, saveSignatures, useStore, type ToolId } from "../state/store";
import * as act from "../state/actions";
import * as A from "../engine/annotations";
import { IconButton, Menu } from "./ui";

const TOOLS: { id: ToolId; title: string; icon: ReactNode }[] = [
  { id: "select", title: "Seleziona", icon: <MousePointer2 size={17} /> },
  { id: "highlight", title: "Evidenzia", icon: <Highlighter size={17} /> },
  { id: "underline", title: "Sottolinea", icon: <Underline size={17} /> },
  { id: "strike", title: "Barra il testo", icon: <Strikethrough size={17} /> },
  { id: "text", title: "Testo", icon: <Type size={17} /> },
  { id: "note", title: "Nota", icon: <StickyNote size={17} /> },
  { id: "rect", title: "Rettangolo", icon: <Square size={17} /> },
  { id: "oval", title: "Ovale", icon: <Circle size={17} /> },
  { id: "line", title: "Linea", icon: <Minus size={17} /> },
  { id: "arrow", title: "Freccia", icon: <MoveUpRight size={17} /> },
  { id: "draw", title: "Disegno a mano libera", icon: <Pencil size={17} /> },
  { id: "signature", title: "Firma", icon: <PenLine size={17} /> },
  { id: "crop", title: "Ritaglia pagina", icon: <Crop size={17} /> },
];

const COLORS: { hex: string; name: string }[] = [
  { hex: "#ff3b30", name: "Rosso" },
  { hex: "#ff9500", name: "Arancione" },
  { hex: "#ffd60a", name: "Giallo" },
  { hex: "#34c759", name: "Verde" },
  { hex: "#0a84ff", name: "Blu" },
  { hex: "#af52de", name: "Viola" },
  { hex: "#111111", name: "Nero" },
  { hex: "#ffffff", name: "Bianco" },
];

function Dot({ color }: { color: string }) {
  return <span className="color-dot" style={{ background: color }} />;
}

function StrokeSample({ w, color }: { w: number; color: string }) {
  return <svg width="28" height="16" viewBox="0 0 28 16"><line x1="3" y1="8" x2="25" y2="8" stroke={color} strokeWidth={w} strokeLinecap="round" /></svg>;
}

export function MarkupBar() {
  const s = useStore();
  const doc = activeDoc(s);

  const selType = (() => {
    if (!doc || !s.selectedAnnot) return null;
    return A.listAnnotations(doc, s.selectedAnnot.page).find((l) => l.ref.id === s.selectedAnnot!.id)?.ref.type ?? null;
  })();

  const showWidth = ["rect", "oval", "line", "arrow", "draw"].includes(s.tool) || ["Square", "Circle", "Line", "Ink"].includes(selType ?? "");
  const showFont = s.tool === "text" || selType === "FreeText";

  const paletteRef = useRef<HTMLInputElement>(null);
  const current = COLORS.find((c) => c.hex === s.color.toLowerCase());
  const setColor = (c: string) => { s.patch({ color: c }); act.applyStyleToSelection({ color: c }); };

  const pickTool = (t: ToolId) => {
    const next = s.tool === t && t !== "select" ? "select" : t;
    s.setTool(next);
    // se c'è già del testo selezionato, il segno si applica subito
    const sel = useStore.getState().selection;
    if (sel && doc && (t === "highlight" || t === "underline" || t === "strike")) {
      const kind = t === "highlight" ? "Highlight" : t === "underline" ? "Underline" : "StrikeOut";
      A.createMarkup(doc, sel.page, kind, sel.quads, useStore.getState().color);
      useStore.getState().patch({ selection: null });
    }
  };

  const sig = s.signatures.find((x) => x.id === s.signatureId) ?? s.signatures[s.signatures.length - 1];

  return (
    <div className="markupbar" data-testid="markup-bar">
      {TOOLS.map((t) => (
        <IconButton key={t.id} title={t.title} active={s.tool === t.id} onClick={() => pickTool(t.id)} testId={`tool-${t.id}`}>{t.icon}</IconButton>
      ))}
      <span className="sep" />
      <div className="color-pick">
        <Menu
          testId="color-menu"
          title="Colore"
          label={<span className="color-label"><Dot color={s.color} />{current?.name ?? "Personalizzato"}<ChevronDown size={13} /></span>}
          items={[
            ...COLORS.map((c) => ({
              label: c.name, checked: c.hex === s.color.toLowerCase(), icon: <Dot color={c.hex} />, testId: `color-${c.hex.slice(1)}`,
              onClick: () => setColor(c.hex),
            })),
            { separator: true },
            { label: "Tavolozza colori…", testId: "color-palette", onClick: () => paletteRef.current?.click() },
          ]}
        />
        <input ref={paletteRef} type="color" className="color-native" value={s.color} tabIndex={-1} aria-hidden
          onChange={(e) => setColor(e.target.value)} />
      </div>
      {showWidth && (
        <div className="stroke" title="Spessore del tratto" data-testid="stroke-control">
          <Menu
            testId="stroke-menu"
            label={<span className="stroke-label"><StrokeSample w={s.width} color={s.color} /><ChevronDown size={13} /></span>}
            items={[1, 3, 6, 10].map((w) => ({
              label: `${w} pt`, checked: s.width === w, testId: `stroke-${w}`, icon: <StrokeSample w={w} color={s.color} />,
              onClick: () => { s.patch({ width: w }); act.applyStyleToSelection({ width: w }); },
            }))}
          />
          <input type="range" min={1} max={24} step={1} value={s.width} data-testid="width-range"
            onChange={(e) => { const v = +e.target.value; s.patch({ width: v }); act.applyStyleToSelection({ width: v }); }} />
          <span className="stroke-value" data-testid="width-value">{s.width} pt</span>
        </div>
      )}
      {showFont && (
        <label className="slider" title="Dimensione del testo">
          <span>Testo {s.fontSize}pt</span>
          <input type="range" min={8} max={72} step={1} value={s.fontSize} data-testid="font-range"
            onChange={(e) => { const v = +e.target.value; s.patch({ fontSize: v }); act.applyStyleToSelection({ fontSize: v }); }} />
        </label>
      )}
      {s.tool === "signature" && (
        <Menu
          testId="menu-signature"
          label={<span className="sig-label">{sig ? <SignatureThumb sig={sig} width={64} height={24} /> : "Firma"} <ChevronDown size={13} /></span>}
          items={[
            ...s.signatures.map((x, i) => ({ label: "", icon: <SignatureThumb sig={x} />, checked: x.id === sig?.id, testId: `sig-item-${i}`, onClick: () => s.patch({ signatureId: x.id }) })),
            ...(s.signatures.length ? [{ separator: true } as const] : []),
            { label: "Nuova firma…", onClick: () => s.patch({ dialog: "signature" }) },
            ...(sig ? [{ label: "Elimina la firma scelta", onClick: () => { const rest = s.signatures.filter((x) => x.id !== sig.id); saveSignatures(rest, rest.slice(-1)[0]?.id ?? null); } }] : []),
          ]}
        />
      )}
      <span className="grow" />
      {s.selectedAnnot && (
        <IconButton title="Elimina l'annotazione selezionata" onClick={act.deleteSelectedAnnotation} testId="delete-annot"><Trash2 size={17} /></IconButton>
      )}
      <IconButton title="Chiudi gli strumenti" onClick={() => s.patch({ markupBar: false, tool: "select" })}><X size={17} /></IconButton>
    </div>
  );
}
