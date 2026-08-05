# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Virtual Judge MTG

App web (PWA) che funge da arbitro virtuale per Magic: The Gathering. L'utente fa domande in linguaggio naturale (o allega una foto del tavolo), può proseguire la conversazione su più turni, e riceve un verdetto basato su fonti ufficiali reali, non sulla "memoria" del modello IA.

## Persona non tecnica

Chi sviluppa (Augusto) non sa programmare. Ogni istruzione data va accompagnata da: percorso file esatto, codice completo senza omissioni, comandi terminale esatti. Preferisce procedere un modulo alla volta, testando ad ogni passo.

## Comandi principali

- `npm run dev` — avvia il server di sviluppo (Turbopack) su `http://localhost:3000`
- `npm run build` — build di produzione
- `npm run lint` — ESLint
- `node scripts/prepara-regole.mjs` — da lanciare UNA TANTUM (o ogni volta che `data/comprehensive-rules.txt` viene aggiornato) per rigenerare `data/regole-compatte.json`

Non esiste una suite di test automatici. Il metodo di verifica standard del progetto è: avviare `npm run dev`, poi testare l'endpoint con `Invoke-RestMethod` da PowerShell (vedi "Note di stile" sotto) e/o dal browser.

## Stack tecnologico
- Next.js 16.2.12 (App Router), TypeScript, Tailwind CSS
- Nessuna cartella src/ — app/ è direttamente nella root del progetto
- Hosting previsto: Vercel (piano gratuito, non ancora pubblicato — il progetto non è ancora un repository git: `git init` non è mai stato eseguito nella cartella, nonostante il programma `git` sia installato sulla macchina)
- IA: Google Gemini via libreria @google/generative-ai (deprecata ma funzionante)
- Dati carte: API pubblica Scryfall (nessuna chiave richiesta)
- Regole ufficiali: Comprehensive Rules di Wizards, scaricate e pre-processate localmente

## Struttura del progetto

- `app/page.tsx` — interfaccia utente: chat multi-turno (cronologia dei messaggi utente/giudice), upload/scatto foto del tavolo con anteprima, pulsanti di risposta rapida ai chiarimenti del giudice
- `app/api/judge/route.ts` — endpoint principale (`POST`), orchestratore di tutta la logica: estrazione parole chiave/carte, ricerca regole, ricerca Scryfall, costruzione del prompt finale e chiamata a Gemini (anche multimodale, se è allegata un'immagine)
- `lib/rules.ts` — ricerca a due fasi (macro capitolo poi micro blocco) nel testo delle CR, legge `data/regole-compatte.json`
- `lib/scryfall.ts` — interrogazione API Scryfall per Oracle Text e Rulings, con cascata di ricerca fuzzy → autocomplete → ricerca testuale (quest'ultima con verifica di somiglianza del nome, per evitare di accettare una carta sbagliata)
- `data/comprehensive-rules.txt` — testo grezzo ufficiale scaricato da media.wizards.com
- `data/regole-compatte.json` — versione pre-elaborata (capitoli + blocchi) generata da `scripts/prepara-regole.mjs`
- `scripts/prepara-regole.mjs` — script Node (ESM) da lanciare per rigenerare `regole-compatte.json` da `comprehensive-rules.txt`

**File morti da NON modificare (residuo di una versione precedente):** `app/lib/rules.ts` e `app/data/comprehensive-rules.txt` esistono sul disco ma non sono mai eseguiti — l'alias `@/*` in `tsconfig.json` punta alla root del progetto, quindi ogni `import ... from "@/lib/rules"` risolve sempre a `lib/rules.ts` (root), mai a `app/lib/rules.ts`. Dettagli in `REVISIONE.md`.

`lib/dizionario.ts` (dizionario italiano-inglese locale per l'estrazione di keyword senza Gemini) **non esiste ancora** — è un'ottimizzazione proposta ma non applicata, vedi "Cosa manca ancora".

## Decisioni architetturali importanti

Perché non mandiamo l'intero regolamento a Gemini ogni volta: consumerebbe troppa quota gratuita. Invece:
1. Una prima mini-chiamata a Gemini (FASE A) estrae parole chiave inglesi + numeri di regola citati + nomi di carte, analizzando il messaggio corrente **insieme a tutta la cronologia della conversazione fin qui** (non solo l'ultimo messaggio, altrimenti una carta già identificata in un turno precedente "sparisce" se il turno successivo non la rinomina esplicitamente).
2. `cercaRegolePertinenti()` in `lib/rules.ts` cerca localmente (gratis, zero token) i blocchi di regole più pertinenti, prima per capitolo (macro) poi per singolo blocco (micro).
3. Se ci sono nomi di carte, `cercaDatiCarta()` in `lib/scryfall.ts` interroga Scryfall in parallelo (Promise.all, massimo 3 carte per richiesta) per Oracle Text + Rulings.
4. Una seconda chiamata a Gemini (FASE D) genera il verdetto finale, con SOLO gli estratti reali trovati come contesto, istruito a citare esclusivamente quei numeri di regola — mai a memoria. Se è allegata una foto, questa chiamata è multimodale (l'immagine viene passata insieme al prompt testuale).

Gerarchia delle fonti nel prompt: dati specifici di una carta (Scryfall) hanno priorità sulle regole generali (Comprehensive Rules) — istruzione esplicita nel prompt di sistema.

Controllo di ambiguità: il prompt istruisce il modello a fare SOLO le domande la cui risposta cambierebbe davvero il verdetto (non a chiedere qualunque dettaglio mancante), assumendo lo scenario standard/più comune per il resto e dichiarandolo nel verdetto. Se restano domande davvero dirimenti, al massimo 2-3 per turno, tutte insieme, mai una alla volta — la risposta deve iniziare ESATTAMENTE con "⚠️ Ho bisogno di alcuni chiarimenti prima di poter rispondere correttamente:".

Pulsanti di risposta rapida ai chiarimenti: quando il giudice chiede chiarimenti, il prompt gli impone di aggiungere in coda alla risposta un blocco delimitato da `===OPZIONI_CHIARIMENTO===` / `===FINE_OPZIONI===` contenente un JSON con, per ogni domanda posta, un elenco di 2-4 possibili risposte brevi (o un array vuoto se la domanda è aperta). `app/page.tsx` estrae questo blocco, lo rimuove dal testo mostrato all'utente, e mostra un pulsante per ogni opzione: cliccarlo inserisce (non invia) il testo `Riguardo a "<domanda>": <opzione>` nel campo di testo, così l'utente può cliccare più risposte e poi inviarle insieme.

Conversazione multi-turno: `app/page.tsx` mantiene uno stato `cronologia` (`{ruolo: "utente"|"giudice", testo}[]`) e lo invia ad ogni richiesta insieme al nuovo messaggio; `route.ts` lo usa sia in FASE A (per non perdere carte/regole già citate) sia in FASE D (per dare un verdetto coerente con quanto già detto, specialmente se l'utente ha appena risposto a una richiesta di chiarimento).

Il sistema non si presenta MAI come giudice certificato/L2 — è un requisito esplicito del progetto (accuratezza verso l'utente): il prompt dice chiaramente al modello di non rivendicare certificazioni Wizards/DCI che non possiede.

## Modelli Gemini: storia e stato attuale
- gemini-1.5-flash: NON disponibile per progetti nuovi (ritirato aprile 2025)
- gemini-2.5-flash: NON disponibile per nuovi utenti (dismissione ottobre 2026)
- gemini-3.6-flash: funziona ma quota gratuita di sole 20 richieste/GIORNO (troppo poche per uso frequente)
- gemini-3.5-flash-lite: MODELLO ATTUALMENTE USATO in route.ts, quota gratuita molto più generosa, adatto a questo caso d'uso

Se in futuro un modello dà errore 404/429, verificare via web search il nome/quota aggiornati prima di cambiare codice — Google aggiorna spesso la disponibilità dei modelli.

## Problema noto (risolto): OneDrive
Il progetto era originariamente in C:\Users\augus\OneDrive\Desktop\virtual-judge-mtg — causava file salvati a 0 byte (placeholder cloud non sincronizzati, attributo ReparsePoint) e conflitti di lockfile. Il progetto è stato spostato in C:\ProgettiDev\virtual-judge-mtg, FUORI da OneDrive. Non ricreare mai il progetto dentro cartelle sincronizzate da OneDrive/Dropbox/Google Drive.

## Cosa è già stato implementato
- Form domanda testuale + verdetto con citazioni reali da CR
- Integrazione Scryfall per carte specifiche (Oracle Text + Rulings), con cascata fuzzy → autocomplete → ricerca testuale e verifica di somiglianza del nome per evitare falsi positivi
- Controllo di ambiguità nel prompt, con limite di domande per turno e verdetti condizionali quando possibile
- Rimozione di qualsiasi rivendicazione di certificazione da parte del "giudice"
- Upload/scatto foto del tavolo (con anteprima e rimozione), analizzata da Gemini in modo multimodale
- Conversazione multi-turno con cronologia mantenuta lato client e inviata ad ogni richiesta
- Pulsanti di risposta rapida alle domande di chiarimento del giudice
- Script `prepara-regole.mjs` per compattare il regolamento in JSON (146 capitoli, 3869 blocchi trovati nell'ultimo run)
- Validazione input in `route.ts`: lunghezza massima della domanda (2000 caratteri), tipo di immagine consentito (PNG/JPEG/WEBP) e dimensione massima dell'immagine (~8MB, calcolata sulla lunghezza della stringa base64) — **non è invece ancora presente un limite sulla lunghezza/numero di messaggi della cronologia**, vedi "Cosa manca ancora"
- Log di debug (`[DEBUG]` in `route.ts` e `[DEBUG Scryfall]` in `lib/scryfall.ts`) disattivabili tramite la variabile d'ambiente `DEBUG_JUDGE` (attivi solo se `DEBUG_JUDGE=true` in `.env.local`, altrimenti silenziosi)

## Cosa manca ancora (in ordine di priorità discusso con l'utente)
- PWA installabile — **`manifest.json` non esiste ancora nel progetto** (nonostante fosse stato dato per "preparato" in una chat precedente, non risulta salvato su disco), mancano le icone reali (`icon-192.png`, `icon-512.png`) e l'aggiornamento di `app/layout.tsx` con i metadata (attualmente ancora quelli di default di `create-next-app`)
- Pubblicazione su Vercel — checklist pronta, non ancora eseguita; **serve prima `git init` nella cartella del progetto** (non ancora fatto) e la creazione del repository GitHub
- Ottimizzazione velocità — attualmente ogni domanda fa 2+ chiamate Gemini sequenziali (percepito come lento dall'utente); soluzione ibrida proposta (dizionario locale IT-EN in `lib/dizionario.ts`, fallback a Gemini solo se il dizionario non basta) — **non ancora applicata**, il file non esiste
- Rifinitura estetica dell'interfaccia (da fare insieme, gusto personale)
- Uniformare tutti i messaggi di errore con un tono più simpatico (in corso, l'utente ne aveva già modificato uno)
- Validazione della lunghezza della cronologia — a differenza di domanda e immagine (già validate in `route.ts`), il numero/lunghezza dei messaggi in `cronologia` inviati dal client non ha ancora un limite: un payload molto lungo potrebbe comunque gonfiare il prompt e consumare quota Gemini
- Pulizia dei problemi noti elencati in `REVISIONE.md` (file morti — ora rimossi —, limite di 3 carte per richiesta — ora alzato a 6 —, ecc.: vedi `REVISIONE.md` per l'elenco completo aggiornato)

## Note di stile per chi genera codice su questo progetto
- Tutti i commenti, nomi di variabili/funzioni e messaggi rivolti all'utente sono in ITALIANO
- Il codice inglese va bene solo per keyword/parole chiave tecniche interne (termini di ricerca inviati a Scryfall/regole)
- Niente omissioni di codice ("// resto invariato") — sempre file completi quando si modifica qualcosa
- Testare sempre con npm run dev + Invoke-RestMethod (PowerShell) prima di considerare una modifica conclusa
