// Evita la finestra del terminale su Windows nelle build di rilascio.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folio_lib::run()
}
