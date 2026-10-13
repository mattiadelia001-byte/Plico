# Plico

Lettore ed editor di PDF per Mac e Windows. Interfaccia in React + TypeScript, guscio nativo in Rust
([Tauri](https://tauri.app)), motore PDF [MuPDF](https://mupdf.com) (WebAssembly).

Funzioni: schede, miniature con riordino e trascinamento, unione e divisione, ruota / elimina / duplica /
inserisci / estrai pagine, annotazioni vere nel PDF (evidenzia, sottolinea, barra, testo, note, forme,
frecce, disegno, firma), ritaglio, ricerca, indice, annulla/ripristina illimitato, riduzione delle dimensioni,
copia con password AES-256, esportazione in immagini, proprietà, stampa, tema chiaro e scuro.

## Sviluppo

```sh
npm install
npm run tauri dev        # app nativa con ricarica automatica
npm run dev              # solo interfaccia nel browser (http://localhost:1420)
```

Serve [Node](https://nodejs.org) 20+ e [Rust](https://rustup.rs). Su Windows servono anche gli
"Strumenti di compilazione C++" di Visual Studio e WebView2 (già presente in Windows 10/11).

## Compilare l'app

```sh
npm run build:mac                          # Mac: crea Plico.app (firma locale)
npm run tauri build                      # Windows: crea l'installer .exe e .msi
```

Su Mac l'app compilata è in `src-tauri/target.noindex/release/bundle/macos/Plico.app`;
su Windows gli installer sono in `src-tauri/target.noindex/release/bundle/nsis` e `.../msi`.

Non hai un PC Windows a portata di mano? Carica il progetto su GitHub e avvia il flusso
**Actions → Compila Plico**: produce l'installer per Windows e l'app per Mac.

## Test

```sh
npx tsx tests/engine.test.ts      # motore PDF, da riga di comando
npm run dev &                     # poi, con l'interfaccia attiva:
node tests/e2e/smoke.mjs          # test dell'interfaccia con un browser vero
node tests/e2e/interact.mjs       # selezione, annotazioni, annulla
node tests/e2e/pages.mjs          # pagine, unisci, dividi, password, compressione
BROWSER=webkit node tests/e2e/pages.mjs   # stessi test con il motore di Safari (finestra del Mac)
```

I percorsi dei PDF di prova in `tests/e2e/lib.mjs` e `tests/engine.test.ts` vanno adattati.

## Licenza

MuPDF è distribuito con licenza **AGPL-3.0**. Usare Plico per sé o in famiglia non pone problemi; se lo
distribuisci ad altri, anche gratis, devi rendere disponibile il codice sorgente dell'app oppure acquistare
una licenza commerciale da Artifex.

## Nota su macOS

L'app non è firmata con un certificato Apple: sul Mac che l'ha compilata si apre normalmente. Se la copi su un altro
Mac e compare "app danneggiata", apri il Terminale ed esegui `xattr -cr /percorso/di/Plico.app`.
