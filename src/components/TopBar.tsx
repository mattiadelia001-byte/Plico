import { useSyncExternalStore } from "react";
import {
  Columns2, FileDown, FilePlus2, FolderOpen, PanelLeft, PencilLine, RotateCcw, RotateCw, Save, Undo2, Redo2,
  ZoomIn, ZoomOut, X, Share, Plus, Search, ChevronUp, ChevronDown, FileText,
} from "lucide-react";
import { activeDoc, useStore } from "../state/store";
import * as act from "../state/actions";
import { isMac } from "../platform";
import { IconButton, Menu, type MenuItem } from "./ui";
import type { PlicoDoc } from "../engine/plicoDoc";

const mod = isMac ? "⌘" : "Ctrl+";
const noop = () => () => {};

export function useDocVersion(doc: PlicoDoc | null) {
  return useSyncExternalStore(doc ? doc.subscribe : noop, doc ? doc.getSnapshot : () => 0);
}

export function TopBar() {
  const s = useStore();
  const doc = activeDoc(s);
  useDocVersion(doc);
  const has = !!doc;

  const fileItems: MenuItem[] = [
    { label: "Nuovo documento", shortcut: `${mod}N`, onClick: act.newDocument },
    { label: "Apri…", shortcut: `${mod}O`, onClick: act.openDialog },
    { separator: true },
    { label: "Salva", shortcut: `${mod}S`, disabled: !has, onClick: () => doc && act.saveDoc(doc) },
    { label: "Salva con nome…", shortcut: `${mod}⇧S`, disabled: !has, onClick: () => doc && act.saveDoc(doc, true) },
    { separator: true },
    { label: "Unisci PDF…", shortcut: `${mod}⇧M`, onClick: () => s.patch({ dialog: "merge" }) },
    { label: "Stampa…", shortcut: `${mod}P`, disabled: !has, onClick: act.printDoc },
    { separator: true },
    { label: "Chiudi scheda", shortcut: `${mod}W`, disabled: !has, onClick: () => doc && act.closeDoc(doc.id) },
  ];

  const pagesItems: MenuItem[] = [
    { label: "Ruota a sinistra", shortcut: `${mod}L`, onClick: () => act.rotate(-90) },
    { label: "Ruota a destra", shortcut: `${mod}R`, onClick: () => act.rotate(90) },
    { separator: true },
    { label: "Inserisci pagina vuota", onClick: act.insertBlank },
    { label: "Inserisci pagine da PDF…", onClick: () => act.insertFromPdfs() },
    { label: "Duplica pagine", onClick: () => act.duplicatePages() },
    { label: "Estrai pagine in un nuovo PDF…", onClick: () => act.extractPages() },
    { separator: true },
    { label: "Elimina pagine", shortcut: `${mod}⌫`, onClick: () => act.deletePages() },
    { separator: true },
    { label: "Ripristina ritaglio", onClick: act.resetCrop },
  ];

  const exportItems: MenuItem[] = [
    { label: "Come immagini…", onClick: () => s.patch({ dialog: "images" }) },
    { label: "Dividi in più file…", onClick: () => s.patch({ dialog: "split" }) },
    { separator: true },
    { label: "Riduci dimensioni…", onClick: () => s.patch({ dialog: "compress" }) },
    { label: "Copia con password…", onClick: () => s.patch({ dialog: "protect" }) },
    { separator: true },
    { label: "Proprietà documento…", shortcut: `${mod}I`, onClick: () => s.patch({ dialog: "info" }) },
  ];

  const pct = `${Math.round(s.zoom * 100)}%`;
  const zoomItems: MenuItem[] = [
    { label: "Adatta alla larghezza", checked: s.fit === "width", onClick: () => s.patch({ fit: "width" }) },
    { label: "Adatta alla pagina", checked: s.fit === "page", onClick: () => s.patch({ fit: "page" }) },
    { label: "Dimensione reale", shortcut: `${mod}0`, onClick: () => s.patch({ fit: "none", zoom: 1 }) },
    { separator: true },
    ...[0.5, 0.75, 1.25, 1.5, 2, 3].map((z) => ({ label: `${z * 100}%`, onClick: () => s.patch({ fit: "none" as const, zoom: z }) })),
    { separator: true },
    { label: "Scorrimento continuo", checked: s.layout === "continuous", onClick: () => s.patch({ layout: "continuous" }) },
    { label: "Una pagina alla volta", checked: s.layout === "single", onClick: () => s.patch({ layout: "single" }) },
    { label: "Due pagine affiancate", checked: s.layout === "two", onClick: () => s.patch({ layout: "two" }) },
  ];

  const zoomBy = (f: number) => s.patch({ fit: "none", zoom: Math.max(0.1, Math.min(8, s.zoom * f)) });

  return (
    <div className="topbar">
      {s.docs.length > 0 && (
        <div className="tabs" role="tablist">
          {s.docs.map((d) => (
            <div key={d.id} role="tab" aria-selected={d.id === s.activeId} className={"tab" + (d.id === s.activeId ? " active" : "")}
              onClick={() => act.activate(d.id)} onAuxClick={(e) => { if (e.button === 1) act.closeDoc(d.id); }} title={d.path ?? d.name}>
              <FileText size={14} />
              <span className="tab-name">{d.name}{d.dirty ? " •" : ""}</span>
              <button className="tab-close" aria-label="Chiudi" onClick={(e) => { e.stopPropagation(); act.closeDoc(d.id); }}><X size={13} /></button>
            </div>
          ))}
          <button className="tab-new" title="Apri un PDF" onClick={act.openDialog}><Plus size={16} /></button>
        </div>
      )}
      <div className="toolbar">
        <IconButton title="Mostra o nascondi la barra laterale" active={s.sidebar} onClick={() => s.patch({ sidebar: !s.sidebar })} testId="toggle-sidebar"><PanelLeft size={18} /></IconButton>
        <Menu label="File" items={fileItems} testId="menu-file" />
        <span className="sep" />
        <IconButton title="Apri" onClick={act.openDialog}><FolderOpen size={18} /></IconButton>
        <IconButton title={`Salva (${mod}S)`} disabled={!has || !doc?.dirty} onClick={() => doc && act.saveDoc(doc)} testId="save"><Save size={18} /></IconButton>
        <IconButton title="Condividi" disabled={!has} onClick={(e) => doc && act.shareDoc(doc, e.currentTarget.getBoundingClientRect())} testId="share"><Share size={18} /></IconButton>
        <span className="sep" />
        <IconButton title={`Annulla (${mod}Z)`} disabled={!doc?.canUndo} onClick={act.undo} testId="undo"><Undo2 size={18} /></IconButton>
        <IconButton title={`Ripristina (${mod}⇧Z)`} disabled={!doc?.canRedo} onClick={act.redo} testId="redo"><Redo2 size={18} /></IconButton>
        <span className="sep" />
        <IconButton title="Riduci zoom" disabled={!has} onClick={() => zoomBy(1 / 1.2)} testId="zoom-out"><ZoomOut size={18} /></IconButton>
        <Menu label={<span className="zoom-label" data-testid="zoom-label">{pct}</span>} title="Zoom e visualizzazione" items={zoomItems} testId="menu-zoom" />
        <IconButton title="Aumenta zoom" disabled={!has} onClick={() => zoomBy(1.2)} testId="zoom-in"><ZoomIn size={18} /></IconButton>
        <span className="sep" />
        <IconButton title={`Ruota a sinistra (${mod}L)`} disabled={!has} onClick={() => act.rotate(-90)} testId="rotate-left"><RotateCcw size={18} /></IconButton>
        <IconButton title={`Ruota a destra (${mod}R)`} disabled={!has} onClick={() => act.rotate(90)} testId="rotate-right"><RotateCw size={18} /></IconButton>
        <Menu label="Pagine" items={pagesItems} testId="menu-pages" />
        <Menu label="Esporta" items={exportItems} testId="menu-export" />
        <span className="grow" />
        <IconButton title="Mostra gli strumenti di annotazione" active={s.markupBar} disabled={!has} onClick={() => s.patch({ markupBar: !s.markupBar, ...(s.markupBar ? { tool: "select" as const } : {}) })} label="Annota" testId="toggle-markup">
          <PencilLine size={18} />
        </IconButton>
        <SearchBox disabled={!has} />
      </div>
    </div>
  );
}

function SearchBox({ disabled }: { disabled: boolean }) {
  const q = useStore((s) => s.searchQuery);
  const hits = useStore((s) => s.hits);
  const idx = useStore((s) => s.hitIndex);
  return (
    <div className="search">
      <Search size={15} />
      <input
        id="search-input"
        data-testid="search-input"
        placeholder="Cerca"
        value={q}
        disabled={disabled}
        onChange={(e) => act.setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") act.showHit(idx + (e.shiftKey ? -1 : 1));
          if (e.key === "Escape") { act.setSearchQuery(""); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {q && <span className="count" data-testid="search-count">{hits.length ? `${idx + 1}/${hits.length}` : "0"}</span>}
      {hits.length > 0 && (
        <>
          <button className="mini" title="Precedente" onClick={() => act.showHit(idx - 1)}><ChevronUp size={14} /></button>
          <button className="mini" title="Successivo" onClick={() => act.showHit(idx + 1)}><ChevronDown size={14} /></button>
        </>
      )}
    </div>
  );
}
