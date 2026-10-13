use std::sync::Mutex;
use tauri::{ipc::{InvokeBody, Request, Response}, AppHandle, Emitter, Manager, RunEvent, WebviewWindow};

/// File passati all'avvio (doppio clic, “Apri con”) prima che l'interfaccia fosse pronta.
#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

fn is_pdf(path: &str) -> bool {
    path.to_lowercase().ends_with(".pdf")
}

/// Estrae i percorsi PDF dagli argomenti della riga di comando.
fn pdf_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter().skip(1).filter(|a| is_pdf(a)).collect()
}

fn deliver(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    // se la finestra c'è già ricevo l'evento subito, altrimenti il frontend li chiede all'avvio
    app.state::<Pending>().0.lock().unwrap().extend(paths.clone());
    let _ = app.emit("open-files", paths);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Impossibile leggere {path}: {e}"))
}

/// Il contenuto arriva come corpo binario; il percorso nell'intestazione `path` (codificato).
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Percorso mancante")?;
    let path = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .to_string();
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Dati non validi".into());
    };
    std::fs::write(&path, data).map_err(|e| format!("Impossibile scrivere {path}: {e}"))
}

#[tauri::command]
fn take_pending_files(state: tauri::State<'_, Pending>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // una sola finestra: aprire un altro PDF lo manda all'app già in esecuzione
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            deliver(app, pdf_args(args));
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Pending(Mutex::new(pdf_args(std::env::args()))))
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            take_pending_files,
            print_page,
            exit_app
        ])
        .build(tauri::generate_context!())
        .expect("errore durante l'avvio di PDFolio");

    app.run(|handle, event| {
        // su macOS i file aperti dal Finder arrivano come evento, non come argomenti
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = &event {
            let paths = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .filter(|p| is_pdf(p))
                .collect();
            deliver(handle, paths);
        }
        let _ = (handle, &event);
    });
}
