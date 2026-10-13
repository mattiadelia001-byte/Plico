# Folio: istruzioni per Claude

Folio è l'app per leggere e modificare PDF di Mattia (Mac e Windows): Tauri 2 (Rust) + React/TypeScript + MuPDF in WebAssembly.
Mattia parla italiano: rispondi in italiano, in prosa semplice e senza gergo tecnico inutile.

## Dopo ogni modifica al codice: ricompila e installa l'app

L'app che Mattia usa è `/Applications/Folio.app`, una copia compilata: modificare i file non la cambia.
Quindi, a lavoro finito (non dopo ogni minima modifica intermedia), esegui sempre:

1. `npx tsc --noEmit` e i test pertinenti (vedi sotto). Se qualcosa fallisce, correggi prima di installare.
2. Chiudi Folio se è aperta: `pkill -x folio`.
3. `export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH" && npm run build:mac` (circa 2-3 minuti).
4. Sostituisci l'app: `rm -rf /Applications/Folio.app && cp -R src-tauri/target.noindex/release/bundle/macos/Folio.app /Applications/Folio.app`
5. Controlla che si avvii (es. aprila con un PDF e verifica che la finestra compaia), poi dì a Mattia di riaprire l'app.

Non creare altre copie di `Folio.app` fuori da `/Applications` e da `src-tauri/target.noindex`: Spotlight e Launchpad le mostrerebbero come icone doppie.

## Verificare le modifiche

- Motore PDF: `npx tsx tests/engine.test.ts`
- Interfaccia, con un browser vero: avvia `npx vite --port 1420` in background, poi
  `node tests/e2e/smoke.mjs`, `interact.mjs`, `pages.mjs`, `fixes.mjs` (anche con `BROWSER=webkit`, il motore della finestra su Mac).
  Per i controlli visivi guarda gli screenshot salvati da `shot()`; non fidarti solo dei test logici.
- I percorsi dei PDF di prova in `tests/e2e/lib.mjs` e `tests/engine.test.ts` puntano a una cartella temporanea: se non esistono, genera due PDF di prova.
- Termina il server di prova (`pkill -f "vite --port 1420"`) quando hai finito.

## Struttura

- `src/components/`: interfaccia. `PageOverlay.tsx` gestisce mouse, selezione del testo e disegno.
- `src/engine/`: logica PDF. `annotations.ts` (annotazioni, evidenziatore squadrato), `textModel.ts` (selezione del testo), `tools.ts` (unisci, dividi, comprimi, password), `folioDoc.ts` (documento, annulla/ripristina).
- `src-tauri/`: guscio Rust (file, finestra, stampa, apertura dei PDF dal sistema).
- `src/styles.css`: colori e stile.

## Cose da sapere

- Windows non è mai stato compilato né provato (nessun PC Windows). C'è `.github/workflows/build.yml`; il progetto non è su GitHub.
- MuPDF ha licenza AGPL: va ricordato se Mattia distribuisce l'app.
- Le evidenziazioni hanno un aspetto scritto a mano (`squareHighlight`): va richiamato dopo ogni `update()` di MuPDF, che altrimenti torna all'aspetto tondo di serie.
- In un PointerEvent `detail` vale sempre 0: i doppi clic si contano a mano.
