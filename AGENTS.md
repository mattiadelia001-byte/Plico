# Plico: istruzioni per Codex

Plico è l'app per leggere e modificare PDF di Mattia (Mac e Windows): Tauri 2 (Rust) + React/TypeScript + MuPDF in WebAssembly.
Mattia parla italiano: rispondi in italiano, in prosa semplice e senza gergo tecnico inutile.

## Dopo ogni modifica al codice: ricompila e installa l'app

L'app che Mattia usa è `/Applications/Plico.app`, una copia compilata: modificare i file non la cambia.
Quindi, a lavoro finito (non dopo ogni minima modifica intermedia), esegui sempre:

1. `npx tsc --noEmit` e i test pertinenti (vedi sotto). Se qualcosa fallisce, correggi prima di installare.
2. Chiudi Plico se è aperta: `pkill -x plico`.
3. `export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH" && npm run build:mac` (circa 2-3 minuti).
4. Sostituisci l'app: `rm -rf /Applications/Plico.app && cp -R src-tauri/target.noindex/release/bundle/macos/Plico.app /Applications/Plico.app`
5. Controlla che si avvii (es. aprila con un PDF e verifica che la finestra compaia), poi dì a Mattia di riaprire l'app.

Non creare altre copie di `Plico.app` fuori da `/Applications` e da `src-tauri/target.noindex`: Spotlight e Launchpad le mostrerebbero come icone doppie.

## Verificare le modifiche

- Motore PDF: `npx tsx tests/engine.test.ts`
- Interfaccia, con un browser vero: avvia `npx vite --port 1420` in background, poi
  `node tests/e2e/smoke.mjs`, `interact.mjs`, `pages.mjs`, `fixes.mjs` (anche con `BROWSER=webkit`, il motore della finestra su Mac).
  Per i controlli visivi guarda gli screenshot salvati da `shot()`; non fidarti solo dei test logici.
- I percorsi dei PDF di prova in `tests/e2e/lib.mjs` e `tests/engine.test.ts` puntano a una cartella temporanea: se non esistono, genera due PDF di prova.
- Termina il server di prova (`pkill -f "vite --port 1420"`) quando hai finito.

## Struttura

- `src/components/`: interfaccia. `PageOverlay.tsx` gestisce mouse, selezione del testo e disegno.
- `src/engine/`: logica PDF. `annotations.ts` (annotazioni, evidenziatore squadrato), `textModel.ts` (selezione del testo), `tools.ts` (unisci, dividi, comprimi, password), `plicoDoc.ts` (documento, annulla/ripristina).
- `src-tauri/`: guscio Rust (file, finestra, stampa, apertura dei PDF dal sistema).
- `src/styles.css`: colori e stile.

## La repo è pubblica: controlla cosa finisce su GitHub

La repo https://github.com/mattiadelia001-byte/Plico è pubblica: tutto ciò che viene pushato lo vede chiunque (e resta nella cronologia anche se poi si cancella).
- Prima di ogni commit controlla `git status` e `git diff`: niente dati personali (percorsi del Mac, nome o email in giro, password, chiavi, token, certificati), niente file di lavoro o di prova.
- Restano solo sul computer di Mattia, già in `.gitignore`: `AGENTS.md`, `tests/`, `.Codex`. Non toglierli dall'elenco e non metterli in un commit.
- Non fare commit né push da solo: li fa Mattia. Dopo aver finito, dì quali file sono cambiati e se c'è qualcosa da ricontrollare prima di pubblicarli.
- Il README è rivolto al pubblico: tienilo aggiornato e senza riferimenti personali.

## Nuova release: aggiorna anche gli installer di Mac e Windows

Ogni volta che si pubblica una nuova versione, gli installer scaricabili dal sito (`Plico-mac.dmg` per Mac, universale Apple/Intel, e `Plico-windows-setup.exe` per Windows) vanno rifatti con il nuovo codice. Non basta cambiare il codice.
1. Alza il numero di versione in tutti e tre i posti, che devono restare uguali: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (poi `npm install --package-lock-only` e controlla `src-tauri/Cargo.lock`).
2. Dopo che Mattia ha fatto commit e push, serve un tag che inizia con `v` (es. `git tag v1.1.0 && git push origin v1.1.0`): `.github/workflows/build.yml` compila `.dmg` e `.exe` e li pubblica nella pagina Releases con quei nomi fissi, che il sito usa per i link `.../releases/latest/download/<nome>`.
3. Quando finisce, controlla nella scheda Actions che entrambi i lavori (Mac e Windows) siano riusciti e che la release contenga i due file.
4. Fai anche l'installazione locale descritta all'inizio (`/Applications/Plico.app`): è un'altra cosa.
5. Se cambia qualcosa che il sito o il README raccontano (funzioni, requisiti, istruzioni), aggiornali.

## Il sito di download

- Il sito è https://plico-silk.vercel.app (React, pubblicato su Vercel). Vive in una cartella e in una repo separate da questa: non è in questo progetto.
- I pulsanti puntano a `https://github.com/mattiadelia001-byte/Plico/releases/latest/download/Plico-mac.dmg` e `.../Plico-windows-setup.exe`: i nomi dei file nella release non vanno cambiati senza aggiornare il sito. Numero di versione e data li legge da soli dalla release più recente (API di GitHub), quindi per una nuova versione non serve toccare il sito, a meno che cambino funzioni o istruzioni.
- Funzioni mostrate sul sito: leggere, annotare, organizzare le pagine, unire, dividere, comprimere, password, esportare come immagini. Se se ne aggiungono o tolgono, ricordare a Mattia di aggiornare il sito.
- Le istruzioni sul sito per l'avviso di macOS e di Windows (app non firmata) vanno tolte quando l'app verrà firmata.

## Cose da sapere

- Windows: l'installer viene compilato da GitHub (`.github/workflows/build.yml`, riuscito per la v1.0.0) ma non è mai stato provato su un PC Windows vero (Mattia non ne ha uno). Il progetto è su GitHub: https://github.com/mattiadelia001-byte/Plico.
- L'app non è firmata da Apple (solo firma "adhoc", `signingIdentity: "-"` in `tauri.conf.json`): chi la scarica vede l'avviso di macOS al primo avvio e il sito deve spiegare come consentirla. Mattia farà l'account Apple Developer più avanti: allora il flusso di compilazione va esteso con firma e notarizzazione.
- MuPDF ha licenza AGPL: va ricordato se Mattia distribuisce l'app.
- Le evidenziazioni hanno un aspetto scritto a mano (`squareHighlight`): va richiamato dopo ogni `update()` di MuPDF, che altrimenti torna all'aspetto tondo di serie.
- In un PointerEvent `detail` vale sempre 0: i doppi clic si contano a mano.
