import { useEffect, useRef, useState, type DragEvent } from "react";
import { FilePlus2, FolderOpen, Lock, Merge } from "lucide-react";
import { activeDoc, toast, useStore } from "./state/store";
import * as act from "./state/actions";
import * as platform from "./platform";
import { isMac } from "./platform";
import { TopBar, useDocVersion } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { MarkupBar } from "./components/MarkupBar";
import { Viewer } from "./components/Viewer";
import { Dialogs } from "./dialogs/Dialogs";
import appIcon from "./assets/app-icon.png";
import type { FolioDoc } from "./engine/folioDoc";
import { viewerApi } from "./state/viewerApi";

export function App() {
  const doc = useStore(activeDoc);
  const sidebar = useStore((s) => s.sidebar);
  const markupBar = useStore((s) => s.markupBar);
  const toastMsg = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  const [dragOver, setDragOver] = useState(false);
  const counter = useRef(0);

  useShortcuts();

  useEffect(() => {
    let off: (() => void)[] = [];
    platform.onOpenFiles(act.openPaths).then((u) => off.push(u));
    platform.onCloseRequested(async () => {
      const ok = await act.confirmCloseAll();
      return ok;
    }).then((u) => off.push(u));
    return () => off.forEach((f) => f());
  }, []);

  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const sel = useStore.getState().selection;
      const t = e.target as HTMLElement;
      if (!sel?.text || t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      e.clipboardData?.setData("text/plain", sel.text);
      e.preventDefault();
      toast("Testo copiato", 1500);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    counter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name));
    if (files.length) act.openPicked(await Promise.all(files.map(platform.fromFile)));
  };

  return (
    <div className={"app" + (isMac ? " mac" : "")}
      onDragEnter={(e) => { if (hasFiles(e)) { counter.current++; setDragOver(true); } }}
      onDragLeave={(e) => { if (hasFiles(e) && --counter.current <= 0) setDragOver(false); }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDrop={onDrop}>
      <TopBar />
      {doc ? (
        <div className="workspace">
          {sidebar && !doc.locked && <Sidebar doc={doc} />}
          <div className="main">
            {markupBar && !doc.locked && <MarkupBar />}
            {doc.locked ? <LockedView doc={doc} /> : <Viewer key={doc.id} doc={doc} />}
            {!doc.locked && <StatusBar doc={doc} />}
          </div>
        </div>
      ) : (
        <Welcome />
      )}
      <Dialogs />
      {dragOver && <div className="drop-overlay"><FolderOpen size={44} /><p>Rilascia i PDF per aprirli</p></div>}
      {busy && <div className="busy"><div className="spinner" />{busy}</div>}
      {toastMsg && <div className="toast" role="status" data-testid="toast">{toastMsg}</div>}
    </div>
  );
}

function Welcome() {
  const patch = useStore((s) => s.patch);
  return (
    <div className="welcome" data-testid="welcome">
      <img className="logo" src={appIcon} alt="" draggable={false} />
      <h1>Folio</h1>
      <p>Leggi, annota e riorganizza i tuoi PDF.</p>
      <div className="welcome-actions">
        <button className="primary" onClick={act.openDialog} data-testid="welcome-open"><FolderOpen size={17} /> Apri un PDF</button>
        <button onClick={() => patch({ dialog: "merge" })}><Merge size={17} /> Unisci PDF</button>
        <button onClick={act.newDocument}><FilePlus2 size={17} /> Nuovo documento</button>
      </div>
      <small>Oppure trascina qui un file.</small>
    </div>
  );
}

function LockedView({ doc }: { doc: FolioDoc }) {
  const [pw, setPw] = useState("");
  const [wrong, setWrong] = useState(false);
  const submit = () => {
    if (doc.unlock(pw)) { useStore.getState().patch({ currentPage: 0, selectedPages: [0] }); }
    else { setWrong(true); setPw(""); }
  };
  return (
    <div className="locked">
      <Lock size={36} />
      <h2>Documento protetto da password</h2>
      <input className="text" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} data-testid="unlock-input" />
      {wrong && <p className="error">Password errata</p>}
      <button className="primary" onClick={submit} data-testid="unlock-run">Sblocca</button>
    </div>
  );
}

function StatusBar({ doc }: { doc: FolioDoc }) {
  useDocVersion(doc);
  const page = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(page + 1)); }, [page, focus]);
  return (
    <div className="statusbar">
      <span>Pagina</span>
      <input value={text} onFocus={(e) => { setFocus(true); e.target.select(); }} onBlur={() => setFocus(false)}
        onChange={(e) => setText(e.target.value)} data-testid="page-input"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = parseInt(text, 10);
            if (n >= 1 && n <= doc.pageCount) { useStore.getState().patch({ selectedPages: [n - 1] }); viewerApi.scrollToPage(n - 1); }
            (e.target as HTMLInputElement).blur();
          }
        }} />
      <span data-testid="page-count">di {doc.pageCount}</span>
      <span className="grow" />
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const doc = activeDoc(s);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      const key = e.key.toLowerCase();

      if (mod && !e.altKey) {
        if (key === "o") { e.preventDefault(); act.openDialog(); return; }
        if (key === "n") { e.preventDefault(); act.newDocument(); return; }
        if (key === "m" && e.shiftKey) { e.preventDefault(); s.patch({ dialog: "merge" }); return; }
        if (!doc) return;
        if (key === "s") { e.preventDefault(); act.saveDoc(doc, e.shiftKey); return; }
        if (key === "w") { e.preventDefault(); act.closeDoc(doc.id); return; }
        if (key === "p") { e.preventDefault(); act.printDoc(); return; }
        if (key === "f") { e.preventDefault(); document.getElementById("search-input")?.focus(); return; }
        if (key === "i") { e.preventDefault(); s.patch({ dialog: "info" }); return; }
        if (typing) return;
        if (key === "z") { e.preventDefault(); e.shiftKey ? act.redo() : act.undo(); return; }
        if (key === "y") { e.preventDefault(); act.redo(); return; }
        if (key === "l") { e.preventDefault(); act.rotate(-90); return; }
        if (key === "r") { e.preventDefault(); act.rotate(90); return; }
        if (key === "backspace" || key === "delete") { e.preventDefault(); act.deletePages(); return; }
        if (key === "=" || key === "+") { e.preventDefault(); s.patch({ fit: "none", zoom: Math.min(8, s.zoom * 1.2) }); return; }
        if (key === "-") { e.preventDefault(); s.patch({ fit: "none", zoom: Math.max(0.1, s.zoom / 1.2) }); return; }
        if (key === "0") { e.preventDefault(); s.patch({ fit: "none", zoom: 1 }); return; }
        if (key === "9") { e.preventDefault(); s.patch({ fit: "width" }); return; }
        return;
      }
      if (typing || !doc) return;
      if (e.key === "Escape") {
        if (s.selectedAnnot) s.patch({ selectedAnnot: null });
        else if (s.selection) s.patch({ selection: null });
        else if (s.tool !== "select") s.setTool("select");
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selectedAnnot) { e.preventDefault(); act.deleteSelectedAnnotation(); return; }
      if (s.layout === "single") {
        if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); viewerApi.scrollToPage(Math.min(doc.pageCount - 1, s.currentPage + 1)); }
        if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); viewerApi.scrollToPage(Math.max(0, s.currentPage - 1)); }
      }
      if (e.key === "Home") { e.preventDefault(); viewerApi.scrollToPage(0); }
      if (e.key === "End") { e.preventDefault(); viewerApi.scrollToPage(doc.pageCount - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
