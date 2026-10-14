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

/// Percorso nella cartella temporanea dove mettere la copia da condividere.
#[tauri::command]
fn share_temp_path(name: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("Plico-condividi");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // il nome arriva dall'interfaccia: tengo solo l'ultima parte per non uscire dalla cartella
    let file = std::path::Path::new(&name).file_name().ok_or("Nome non valido")?;
    Ok(dir.join(file).to_string_lossy().to_string())
}

/// Su Mac apre il foglio di condivisione del sistema (Mail, Messaggi, AirDrop…) accanto al pulsante.
/// `x`, `y`, `w`, `h` sono il riquadro del pulsante nella finestra, in pixel dell'interfaccia.
#[cfg(target_os = "macos")]
#[tauri::command]
fn share_file(window: WebviewWindow, path: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    use objc2::{runtime::AnyObject, AnyThread};
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};

    let view = window.ns_view().map_err(|e| e.to_string())? as usize;
    window
        .run_on_main_thread(move || unsafe {
            let view: &NSView = &*(view as *const NSView);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            let item: &AnyObject = &url;
            let items = NSArray::from_slice(&[item]);
            let picker = NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items);
            // le coordinate dell'interfaccia partono dall'alto; la vista può partire dal basso
            let top = if view.isFlipped() { y } else { view.bounds().size.height - y - h };
            let rect = NSRect::new(NSPoint::new(x, top), NSSize::new(w, h));
            picker.showRelativeToRect_ofView_preferredEdge(rect, view, NSRectEdge::NSMinYEdge);
        })
        .map_err(|e| e.to_string())
}

/// Su Windows mostra il file in Esplora risorse, dove c'è il pulsante Condividi di sistema.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn share_file(path: String, _x: f64, _y: f64, _w: f64, _h: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    let _ = path;
    Ok(())
}

/// Su Mac legge/imposta l'app predefinita per i PDF tramite Launch Services.
#[cfg(target_os = "macos")]
mod default_app {
    use objc2::rc::Retained;
    use objc2_foundation::NSString;
    use std::ffi::c_void;

    const PDF_TYPE: &str = "com.adobe.pdf";
    const ALL_ROLES: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(content_type: *const c_void, role: u32) -> *mut NSString;
        fn LSSetDefaultRoleHandlerForContentType(content_type: *const c_void, role: u32, handler: *const c_void) -> i32;
    }

    pub fn current() -> Option<String> {
        let kind = NSString::from_str(PDF_TYPE);
        // la funzione restituisce una stringa già “posseduta” da noi (Copy)
        let raw = unsafe { LSCopyDefaultRoleHandlerForContentType(&*kind as *const NSString as *const c_void, ALL_ROLES) };
        let handler = unsafe { Retained::from_raw(raw) }?;
        Some(handler.to_string())
    }

    pub fn set(bundle_id: &str) -> Result<(), String> {
        let kind = NSString::from_str(PDF_TYPE);
        let handler = NSString::from_str(bundle_id);
        let status = unsafe {
            LSSetDefaultRoleHandlerForContentType(
                &*kind as *const NSString as *const c_void,
                ALL_ROLES,
                &*handler as *const NSString as *const c_void,
            )
        };
        if status == 0 { Ok(()) } else { Err(format!("Il sistema ha rifiutato la richiesta (codice {status})")) }
    }
}

/// `Some(true)` se Plico è già l'app predefinita per i PDF, `Some(false)` se no,
/// `None` se non si può sapere (su Windows il sistema non lo permette).
#[tauri::command]
fn is_default_pdf_app(app: AppHandle) -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        let me = app.config().identifier.to_lowercase();
        return Some(default_app::current().map(|h| h.to_lowercase() == me).unwrap_or(false));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

/// Su Mac imposta Plico come app predefinita per i PDF. Su Windows il sistema non lo consente
/// a un programma (serve la scelta dell'utente): apre la pagina “App predefinite” delle Impostazioni.
#[tauri::command]
fn set_default_pdf_app(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return default_app::set(&app.config().identifier);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = app;
        return std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .creation_flags(0x0800_0000) // senza finestra nera
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Err("Non disponibile su questo sistema".into())
    }
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
            share_temp_path,
            share_file,
            is_default_pdf_app,
            set_default_pdf_app,
            exit_app
        ])
        .build(tauri::generate_context!())
        .expect("errore durante l'avvio di Plico");

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
