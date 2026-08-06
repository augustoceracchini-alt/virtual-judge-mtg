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
- `node scripts/prepara-regole.mjs` — da lanciare ogni volta che `data/comprehensive-rules.txt` viene aggiornato, per rigenerare `data/regole-compatte.json`
- `node scripts/prepara-regole-torneo.mjs` — da lanciare ogni volta che `data/tournament-rules.pdf` viene aggiornato, per rigenerare `data/mtr-compatte.json`

Non esiste una suite di test automatici. Il metodo di verifica standard del progetto è: avviare `npm run dev`, poi testare l'endpoint con `Invoke-RestMethod` da PowerShell (vedi "Note di stile" sotto) e/o dal browser.

## Stack tecnologico
- Next.js 16.2.12 (App Router), TypeScript, Tailwind CSS
- Nessuna cartella src/ — app/ è direttamente nella root del progetto
- Hosting: Vercel (piano gratuito), pubblicato su https://virtual-judge-mtg.vercel.app; repository git su GitHub (`origin/master`), il deploy parte automaticamente a ogni push
- IA: Google Gemini via libreria @google/generative-ai (deprecata ma funzionante)
- Dati carte: API pubblica Scryfall (nessuna chiave richiesta)
- Regole ufficiali: due documenti di Wizards, scaricati e pre-processati localmente — le Comprehensive Rules (meccaniche di gioco) e il Magic Tournament Rules (procedure e policy di torneo)

## Struttura del progetto

- `app/page.tsx` — interfaccia utente: chat multi-turno (cronologia dei messaggi utente/giudice), upload/scatto foto del tavolo con anteprima, pulsanti di risposta rapida ai chiarimenti del giudice
- `app/api/judge/route.ts` — endpoint principale (`POST`), orchestratore di tutta la logica: estrazione parole chiave/carte, ricerca regole, ricerca Scryfall, costruzione del prompt finale e chiamata a Gemini (anche multimodale, se è allegata un'immagine)
- `lib/rules.ts` — ricerca in entrambi i regolamenti, con due strategie diverse perché i due documenti hanno strutture opposte (vedi "Decisioni architetturali"): `cercaRegolePertinenti()` per le CR (a due fasi: macro capitolo poi micro blocco) e `cercaRegoleTorneo()` per l'MTR (per titolo di sottosezione)
- `lib/errata.ts` — `cercaErrataPertinenti()`, corrispondenza per nome esatto (case-insensitive) contro `data/errata-locali.json`; vedi "Correzioni manuali" più sotto
- `lib/scryfall.ts` — interrogazione API Scryfall per Oracle Text, Rulings e legalità nei formati principali, con cascata di ricerca fuzzy → autocomplete → ricerca testuale (quest'ultima con verifica di somiglianza del nome, per evitare di accettare una carta sbagliata)
- `data/comprehensive-rules.txt` — testo grezzo ufficiale scaricato da media.wizards.com
- `data/tournament-rules.pdf` — PDF ufficiale del Magic Tournament Rules scaricato da media.wizards.com
- `data/regole-compatte.json` e `data/mtr-compatte.json` — versioni pre-elaborate (`{dataEfficacia, capitoli, blocchi}`) generate dai due script; **entrambe vanno committate** perché sono i file letti a runtime, e **dichiarate in `next.config.ts` sotto `outputFileTracingIncludes`**, altrimenti Vercel non le include nel pacchetto e in produzione la ricerca falla pur funzionando in locale
- `data/errata-locali.json` — lista di correzioni manuali scritte a mano (non generata da uno script); anche questa va committata e dichiarata in `next.config.ts`, stessa regola degli altri due file dati
- `scripts/prepara-regole.mjs` — script Node (ESM) che rigenera `regole-compatte.json` da `comprehensive-rules.txt`
- `scripts/prepara-regole-torneo.mjs` — script Node (ESM) che rigenera `mtr-compatte.json` da `tournament-rules.pdf` (usa `pdf-parse`, dipendenza di sviluppo: non finisce nel bundle di produzione)

## Correzioni manuali a rulings superati (`data/errata-locali.json`)

Quando Wizards modifica una regola generale delle Comprehensive Rules, i rulings già pubblicati
per le carte specifiche interessate NON vengono aggiornati automaticamente su Scryfall — restano
scritti come se la regola vecchia fosse ancora in vigore. Il modello, davanti a un ruling molto
specifico sulla carta esatta che contraddice una regola generale astratta, tende a fidarsi del
ruling anche quando le istruzioni gli chiedono di dare priorità alla regola più recente (caso
concreto: Urza's Saga + Blood Moon, benchmark del progetto, che senza questa correzione sbagliava
circa una volta su quattro-cinque).

Per i casi noti, si aggiunge una voce a `data/errata-locali.json`:

```json
{ "carte": ["Nome Esatto Della Carta"], "nota": "Spiegazione in italiano di perché il ruling vecchio è superato e qual è la conclusione corretta oggi." }
```

`carte` può elencare più nomi se la stessa nota vale per più carte. Il confronto è per nome esatto
(case-insensitive, non parziale). La nota viene iniettata nel prompt con **priorità assoluta**,
sopra anche le Comprehensive Rules — deve quindi affermare direttamente la conclusione corretta,
non solo segnalare che il ruling vecchio è dubbio. Dopo aver aggiunto una voce, va anche eseguito
di nuovo `npm run build` e verificato che `data/errata-locali.json` compaia nel file
`.next/server/app/api/judge/route.js.nft.json`, altrimenti la correzione funziona in locale ma non
in produzione.

`lib/dizionario.ts` (dizionario italiano-inglese locale per l'estrazione di keyword senza Gemini) **non esiste ancora** — è un'ottimizzazione proposta ma non applicata, vedi "Cosa manca ancora".

## Decisioni architetturali importanti

Perché non mandiamo l'intero regolamento a Gemini ogni volta: consumerebbe troppa quota gratuita. Invece:
1. Una prima mini-chiamata a Gemini (FASE A) estrae parole chiave inglesi + numeri di regola citati + nomi di carte, analizzando il messaggio corrente **insieme a tutta la cronologia della conversazione fin qui** (non solo l'ultimo messaggio, altrimenti una carta già identificata in un turno precedente "sparisce" se il turno successivo non la rinomina esplicitamente).
2. `cercaRegolePertinenti()` in `lib/rules.ts` cerca localmente (gratis, zero token) i blocchi di regole più pertinenti, prima per capitolo (macro) poi per singolo blocco (micro).
3. Se ci sono nomi di carte, `cercaDatiCarta()` in `lib/scryfall.ts` interroga Scryfall per Oracle Text + Rulings + legalità (massimo 6 carte per richiesta, **una dopo l'altra e non in parallelo**: ogni carta è una catena di più chiamate che al proprio interno già rispetta una pausa, e lanciarne sei insieme superava di molto il ritmo richiesto dall'API pubblica di Scryfall).
4. Una seconda chiamata a Gemini (FASE D) genera il verdetto finale, con SOLO gli estratti reali trovati come contesto, istruito a citare esclusivamente quei numeri di regola — mai a memoria. Se è allegata una foto, questa chiamata è multimodale (l'immagine viene passata insieme al prompt testuale).
5. Se gli estratti contengono una regola condizionale a più clausole, una terza chiamata (FASE E) ricontrolla la conclusione in modo isolato, con un procedimento a tre passi: prima ricalcola dai soli regolamenti, poi guarda i rulling delle carte, infine confronta col verdetto già scritto e lo corregge solo se contraddice il proprio calcolo.

Gerarchia delle fonti nel prompt (attenzione: è stata **invertita** rispetto alla versione iniziale del progetto): le Comprehensive Rules sono la fonte primaria per le meccaniche di gioco, perché vengono aggiornate a mano a ogni pubblicazione di Wizards e quindi riflettono il funzionamento attuale, mentre un ruling di carta resta fermo alla data in cui è stato scritto. Sulle procedure di torneo prevale l'MTR, come dichiara il documento stesso nella propria introduzione. Il testo Oracle resta la fonte per sapere cosa fa la carta, e i rulings servono per le interazioni specifiche — ma se un ruling è anteriore alla data di validità delle CR fornite e le contraddice, prevalgono le CR. Il caso che ha motivato questa inversione: un ruling del 2021 su Urza's Saga è stato superato dalla modifica della regola 714.4 del 2025, e il giudice continuava ad applicare il ruling vecchio.

Ricerca nei due regolamenti — perché due strategie diverse: le CR hanno 3869 blocchi brevi su 146 capitoli dai titoli specifici ("Sagas", "Lands"), quindi selezionare prima i capitoli pertinenti e poi i blocchi dentro ciascuno evita che un capitolo prolisso soffochi quello decisivo. L'MTR ha invece 94 blocchi lunghi su appena 16 capitoli dai titoli quasi identici (la parola "Tournament" compare in cinque titoli su sedici): lì la selezione per capitolo produce pareggi e scarta il capitolo giusto, quindi si usa il titolo della sottosezione con cui ogni blocco inizia ("5.2 Bribery: ...", "2.8 Deck Checks: ..."). Quel titolo fa anche da filtro di pertinenza: se nessuna sottosezione tocca la domanda, l'MTR non viene incluso affatto, così non inquina le domande di pura meccanica di gioco. **Non riusare la ricerca delle CR per l'MTR**: è già stato provato e produceva risposte sbagliate.

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
- Validazione input in `route.ts`: lunghezza massima della domanda (2000 caratteri), tipo di immagine consentito (PNG/JPEG/WEBP), dimensione massima dell'immagine (~8MB, calcolata sulla lunghezza della stringa base64) e cronologia validata nella forma (solo elementi con `ruolo` ammesso e `testo` di tipo stringa) e limitata a 16000 caratteri complessivi, tenendo i messaggi più recenti
- Log di debug (`[DEBUG]` in `route.ts` e `[DEBUG Scryfall]` in `lib/scryfall.ts`) disattivabili tramite la variabile d'ambiente `DEBUG_JUDGE` (attivi solo se `DEBUG_JUDGE=true` in `.env.local`, altrimenti silenziosi)

## Cosa manca ancora (in ordine di priorità discusso con l'utente)
- PWA installabile — **`manifest.json` non esiste ancora nel progetto**, mancano le icone reali (`icon-192.png`, `icon-512.png`) e i metadata relativi in `app/layout.tsx`
- Affidabilità sulle regole condizionali — il ragionamento su regole a più clausole (azioni basate sullo stato con confronti numerici) resta corretto in circa il 70-80% dei casi anche con la FASE E. Ulteriori istruzioni nel prompt hanno mostrato rendimenti decrescenti: ogni aggiustamento spostava il tipo di errore invece di eliminarlo. La strada rimasta è un livello di modello superiore per le FASI D/E, da valutare contro la quota gratuita — **decisione non ancora presa dall'utente**
- Ottimizzazione velocità — ogni domanda fa 2 chiamate Gemini sequenziali (3 se scatta la FASE E), percepite come lente; soluzione ibrida proposta (dizionario locale IT-EN in `lib/dizionario.ts`, fallback a Gemini solo se il dizionario non basta) — **non ancora applicata**, il file non esiste
- Nessun limite di richieste per utente — l'app è pubblica e la quota Gemini è condivisa da chiunque abbia il link
- Uniformare tutti i messaggi di errore con un tono più simpatico (in corso, l'utente ne aveva già modificato uno)
- Semplificazioni individuate e non ancora applicate: estrarre i testi dei prompt da `route.ts` (che è lungo circa 400 righe, di cui buona parte stringhe di prompt) in un modulo dedicato; spezzare `app/page.tsx` in componenti; unificare la funzione `logDebug` duplicata fra `route.ts` e `lib/scryfall.ts`
- Le note di lavoro personali (fra cui `REVISIONE.md`) sono in `note-di-lavoro/`, cartella esclusa da git

## Note di stile per chi genera codice su questo progetto
- Tutti i commenti, nomi di variabili/funzioni e messaggi rivolti all'utente sono in ITALIANO
- Il codice inglese va bene solo per keyword/parole chiave tecniche interne (termini di ricerca inviati a Scryfall/regole)
- Niente omissioni di codice ("// resto invariato") — sempre file completi quando si modifica qualcosa
- Testare sempre con npm run dev + Invoke-RestMethod (PowerShell) prima di considerare una modifica conclusa
