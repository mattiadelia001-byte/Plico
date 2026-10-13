// Strato che nasconde le differenze tra l'app Tauri (Mac/Windows) e il browser
// (usato solo per sviluppo e test automatici).

export interface PickedFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

async function tauriInvoke<T>(cmd: string, args?: any, opts?: any): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args, opts);
}

export async function readPath(path: string): Promise<PickedFile> {
  const data = await tauriInvoke<ArrayBuffer>("read_file", { path });
  return { name: baseName(path), path, bytes: new Uint8Array(data) };
}

export async function writePath(path: string, bytes: Uint8Array): Promise<void> {
  await tauriInvoke<void>("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

/** Finestra “Apri”: restituisce i PDF scelti. */
export async function pickPdfs(multiple = true): Promise<PickedFile[]> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!res) return [];
    const paths = Array.isArray(res) ? res : [res];
    return Promise.all(paths.map(readPath));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = multiple;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(fromFile)));
    };
    input.click();
  });
}

export async function fromFile(f: File): Promise<PickedFile> {
  return { name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) };
}

export interface Saved {
  path: string | null;
  name: string;
}

/** Salva in un percorso scelto dall'utente. Restituisce null se annullato. */
export async function saveAs(bytes: Uint8Array, suggested: string): Promise<Saved | null> {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return null;
    await writePath(path, bytes);
    return { path, name: baseName(path) };
  }
  download(bytes, suggested, "application/pdf");
  return { path: null, name: suggested };
}

export async function pickFolder(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false });
    return typeof res === "string" ? res : null;
  }
  return "browser";
}

/** Scrive un file in una cartella scelta con `pickFolder`. */
export async function writeInFolder(folder: string, name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri) {
    const sep = folder.includes("\\") ? "\\" : "/";
    await writePath(folder.replace(/[\\/]$/, "") + sep + name, bytes);
  } else {
    download(bytes, name, "application/octet-stream");
  }
}

export async function revealFolder(folder: string): Promise<void> {
  if (!isTauri) return;
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(folder);
  } catch { /* non critico */ }
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export function download(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function confirmDialog(message: string, okLabel = "OK", cancelLabel = "Annulla"): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title: "PDFolio", kind: "warning", okLabel, cancelLabel });
  }
  return window.confirm(message);
}

/** Tre scelte: salva / non salvare / annulla. */
export async function askSave(name: string): Promise<"save" | "discard" | "cancel"> {
  if (isTauri) {
    const { message } = await import("@tauri-apps/plugin-dialog");
    const res = await message(`Vuoi salvare le modifiche a “${name}” prima di chiuderlo?`, {
      title: "PDFolio",
      kind: "warning",
      buttons: { yes: "Salva", no: "Non salvare", cancel: "Annulla" },
    } as any);
    if (res === "Yes" || res === "Salva") return "save";
    if (res === "No" || res === "Non salvare") return "discard";
    return "cancel";
  }
  if (window.confirm(`Salvare le modifiche a “${name}”?`)) return "save";
  return window.confirm("Chiudere senza salvare?") ? "discard" : "cancel";
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

/** Riceve i file aperti dal sistema (doppio clic, “Apri con”, seconda istanza). */
export async function onOpenFiles(cb: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un = await listen<string[]>("open-files", (e) => cb(e.payload));
  // file passati all'avvio, prima che l'interfaccia fosse pronta
  const pending = await tauriInvoke<string[]>("take_pending_files");
  if (pending.length) cb(pending);
  return un;
}

export async function onCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  if (!isTauri) {
    const fn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    return () => window.removeEventListener("beforeunload", fn);
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  return w.onCloseRequested(async (e) => {
    if (!(await handler())) e.preventDefault();
  });
}

export async function exitApp() {
  if (isTauri) await tauriInvoke("exit_app");
}

export async function printPage() {
  if (isTauri) await tauriInvoke("print_page");
  else window.print();
}
