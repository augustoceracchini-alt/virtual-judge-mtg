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
- `npm run prova-ricerca` — banco di prova della ricerca locale nei regolamenti: importa le funzioni reali di `lib/rules.ts` e verifica su casi fissi che i blocchi decisivi vengano recuperati, senza chiamare Gemini (gratuito, istantaneo, deterministico); usarlo per capire se una modifica a `lib/rules.ts` migliora o peggiora il recupero, invece di indovinarlo

Non esiste una suite di test automatici end-to-end. Il metodo di verifica standard del progetto è: avviare `npm run dev`, poi testare l'endpoint con `Invoke-RestMethod` da PowerShell (vedi "Note di stile" sotto) e/o dal browser; per la sola ricerca nei regolamenti c'è anche `npm run prova-ricerca` (vedi sopra).

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
non solo segnalare che il ruling vecchio è dubbio.

**La nota deve enunciare la regola in modo coerente col testo CR che il modello riceve nello stesso
prompt.** Avendo priorità assoluta, e ricevendo il modello l'istruzione di applicarla «senza
ricalcolarla né metterla in discussione», una nota che contraddice le CR mette in conflitto due
fonti dando la precedenza a quella sbagliata. Verificato dal vivo su Urza's Saga: la prima versione
della nota diceva che il sacrificio scatta «SOLO se la Saga NON ha più nessuna abilità di capitolo»,
cioè l'esatto rovescio della 714.4 (che richiede che la Saga ABBIA una o più abilità di capitolo).
Il giudice arrivava sì alla conclusione giusta, ma prima sprecava un turno chiedendo all'utente
*perché* la carta avesse perso le abilità — una distinzione che la 714.4 non fa — e poi insegnava
all'utente la regola al contrario. Riscritta la nota in accordo con le CR, la risposta arriva
diretta al primo turno e con la regola enunciata correttamente. Conviene anche dire esplicitamente
nella nota quali domande NON porre, se una formulazione precedente ne ha indotta una inutile.

Dopo aver aggiunto una voce, va anche eseguito
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
- gemini-3.6-flash: quota gratuita di sole ~20 richieste/GIORNO (troppo poche per usarlo su ogni domanda), ma ragiona meglio di flash-lite — usato SOLO nella FASE E (vedi sotto)
- gemini-3.5-flash-lite: MODELLO STANDARD usato in route.ts per FASI A e D (ogni domanda), quota gratuita molto più generosa
- I modelli Pro sono ormai disponibili solo a pagamento — non un'opzione per questo progetto (resta gratuito)

Due modelli diversi in `route.ts` (costanti `MODELLO_STANDARD`/`MODELLO_VERIFICA`): `gemini-3.6-flash`
ragiona meglio ma la sua quota stretta lo rende inadatto a girare su ogni domanda, quindi è usato
solo nella FASE E (il doppio controllo, che scatta già solo per le regole condizionali complesse).
La chiamata alla FASE E ha un `try/catch` dedicato: se fallisce (quota esaurita o altro errore), si
procede restituendo il verdetto della FASE D non verificato invece di un errore all'utente. L'effetto
reale sulla correttezza non è stato misurato con un banco di prova (a differenza del recupero regole,
verificare la correttezza di un verdetto in linguaggio naturale non si presta a un test automatico
come `prova-ricerca`) — è un miglioramento motivato dal punteggio di benchmark del modello.

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
- Log di debug (`[DEBUG]` in `route.ts` e `[DEBUG Scryfall]` in `lib/scryfall.ts`) disattivabili tramite la variabile d'ambiente `DEBUG_JUDGE` (attivi solo se `DEBUG_JUDGE=true` in `.env.local`, altrimenti silenziosi), tramite la funzione condivisa `logDebug` in `lib/debug.ts` (non più duplicata fra i due file)
- PWA installabile — `public/manifest.json`, icone reali (192/512, standard e maskable) generate con `scripts/genera-icone-pwa.mjs`, metadata `appleWebApp`/`icons` e `viewport.themeColor` in `app/layout.tsx`
- Limite di richieste per IP — 20 richieste ogni 10 minuti (`lib/limite.ts`), contatore in memoria del processo: protezione parziale (si azzera ai cold start su Vercel, non condivisa tra istanze), ma molto meglio di nessun limite
- Recupero delle regole (CR) corretto: ricerca globale di sicurezza sempre attiva anche quando dei capitoli erano già stati selezionati (prima scattava solo se nessun capitolo veniva trovato) e confronto per parola intera invece che per sottostringa (evita falsi positivi tipo "tap" dentro "untapped"); verificato con `npm run prova-ricerca` (8 casi, passava da 5/8 a 8/8)
- Tono dei messaggi di errore in `route.ts` — verificato in questa sessione, giudicato adeguato così com'è
- Refactor completati: testi dei prompt estratti in `lib/prompts.ts`, `app/page.tsx` spezzata in componenti (`app/components/AllegatoFoto.tsx`, `BollaMessaggio.tsx`, `IntestazioneChat.tsx`)
- Cache in memoria per le ricerche Scryfall (`lib/scryfall.ts`) — evita di rifare le stesse chiamate di rete per carte già cercate, condivisa da tutte le richieste sulla stessa istanza calda del processo
- Affidabilità sulle regole condizionali — decisione presa: FASE E (il doppio controllo sulle regole a più clausole) usa `gemini-3.6-flash` invece di `gemini-3.5-flash-lite`, con fallback al verdetto FASE D non verificato se la quota stretta di quel modello si esaurisce (vedi "Modelli Gemini" sopra). Ulteriori istruzioni nel prompt avevano già mostrato rendimenti decrescenti prima di questa decisione. Effetto reale non misurato con un banco di prova (a differenza del recupero regole)

## Cosa manca ancora (in ordine di priorità discusso con l'utente)
- Ottimizzazione velocità — ogni domanda fa 2 chiamate Gemini sequenziali (3 se scatta la FASE E), percepite come lente; soluzione ibrida proposta (dizionario locale IT-EN in `lib/dizionario.ts`, fallback a Gemini solo se il dizionario non basta) — **non ancora applicata**, il file non esiste; rimandata finché non si misura se serve davvero, dato che il recupero delle regole è arrivato a 8/8 nel banco di prova senza glossario
- Le note di lavoro personali (fra cui `REVISIONE.md`) sono in `note-di-lavoro/`, cartella esclusa da git

## Note di stile per chi genera codice su questo progetto
- Tutti i commenti, nomi di variabili/funzioni e messaggi rivolti all'utente sono in ITALIANO
- Il codice inglese va bene solo per keyword/parole chiave tecniche interne (termini di ricerca inviati a Scryfall/regole)
- Niente omissioni di codice ("// resto invariato") — sempre file completi quando si modifica qualcosa
- Testare sempre con npm run dev + Invoke-RestMethod (PowerShell) prima di considerare una modifica conclusa
