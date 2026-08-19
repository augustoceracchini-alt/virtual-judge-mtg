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

- `npm run prova-verifica` — misura su quanti casi scatta la FASE E, il doppio controllo del verdetto, e quale indicatore l'ha fatta scattare. Gratuito e istantaneo come `prova-ricerca` (non chiama Gemini): serve perché la FASE E è la fase più costosa dell'app, quindi ogni modifica a `lib/verifica.ts` va misurata qui prima e dopo. Copre solo l'innesco testuale, non quello delle citazioni senza fonte, quindi il numero che riporta è il minimo

- `npm run prova-copertura` — sonda di misura (non un test): interroga l'API di Board Games Stack Exchange e riporta, per una lista di casi, se esiste una discussione pertinente, quanti voti ha, quando è stata modificata e quali numeri di regola CR cita. Non chiama Gemini e non tocca l'app; consuma la quota gratuita dell'API (300 richieste/giorno senza chiave, una per caso)

Non esiste una suite di test automatici end-to-end. Il metodo di verifica standard del progetto è: avviare `npm run dev`, poi testare l'endpoint con `Invoke-RestMethod` da PowerShell (vedi "Note di stile" sotto) e/o dal browser; per la sola ricerca nei regolamenti c'è `npm run prova-ricerca`, e per il comportamento end-to-end lo scenario descritto in "Banco di prova manuale" più sotto.

## Stack tecnologico
- Next.js 16.2.12 (App Router), TypeScript, Tailwind CSS
- Nessuna cartella src/ — app/ è direttamente nella root del progetto
- Hosting: Vercel (piano gratuito), pubblicato su https://virtual-judge-mtg.vercel.app; repository git su GitHub (`origin/master`), il deploy parte automaticamente a ogni push
- IA: Google Gemini via libreria @google/generative-ai (deprecata ma funzionante)
- Dati carte: API pubblica Scryfall (nessuna chiave richiesta)
- Regole ufficiali: due documenti di Wizards, scaricati e pre-processati localmente — le Comprehensive Rules (meccaniche di gioco) e il Magic Tournament Rules (procedure e policy di torneo)

## Struttura del progetto

- `app/page.tsx` — interfaccia utente: chat multi-turno (cronologia dei messaggi utente/giudice), upload/scatto foto del tavolo con anteprima, pulsanti di risposta rapida ai chiarimenti del giudice. Contiene anche `preparaFotoPerInvio` (rimpicciolimento della foto prima dell'invio) e `messaggioPerErroreDiPiattaforma` (traduzione dei codici HTTP che non arrivano dalla nostra API): vedi "Limite di dimensione della richiesta su Vercel"
- `app/api/judge/route.ts` — endpoint principale (`POST`), orchestratore di tutta la logica: estrazione parole chiave/carte, ricerca regole, ricerca Scryfall, costruzione del prompt finale e chiamata a Gemini (anche multimodale, se è allegata un'immagine). `POST` contiene la sequenza delle fasi; i blocchi che non decidono nulla sul flusso stanno in funzioni a parte: `eseguiEstrazioneFaseA` (FASE A), `formattaSezioneCarte` (la scheda per carta del prompt), `eseguiVerificaFaseE` (FASE E, try/catch dedicato compreso), `erroreValidazioneImmagine` e `normalizzaCronologia` (validazione dell'input)
- `lib/rules.ts` — ricerca in entrambi i regolamenti, con due strategie diverse perché i due documenti hanno strutture opposte (vedi "Decisioni architetturali"): `cercaRegolePertinenti()` per le CR (a due fasi: macro capitolo poi micro blocco) e `cercaRegoleTorneo()` per l'MTR (per titolo di sottosezione). Per le CR i capitoli entrano da quattro canali indipendenti — titolo, corpo, numero di regola citato, e rimandi del Glossario ufficiale (`capitoliDaGlossario`, con voto pesato per rarità del termine) — e i blocchi selezionati si portano dietro la propria regola padre (`conBlocchiPadre`, perché "709.5." enuncia il principio che "709.5j" raffina). La ricerca nelle CR è scritta come tre passi con un nome: `punteggiaBlocchi` (un punteggio per ogni blocco), `selezionaCapitoli` (quali capitoli guardare, sui quattro canali), `raccogliBlocchi` (i migliori di ciascun capitolo più la rete di sicurezza globale); `cercaBlocchiPertinenti` li mette in fila e basta. **Tutte le manopole numeriche del recupero sono costanti in cima al file**, ciascuna col perché di quel valore: è lì che si interviene, non dentro le funzioni
- `lib/errata.ts` — `cercaErrataPertinenti()`, corrispondenza per nome esatto (case-insensitive) contro `data/errata-locali.json`; vedi "Correzioni manuali" più sotto
- `lib/scryfall.ts` — interrogazione API Scryfall per riga del tipo, Oracle Text, Rulings e legalità nei formati principali, con cascata di ricerca fuzzy → autocomplete → ricerca testuale (quest'ultima con verifica di somiglianza del nome, per evitare di accettare una carta sbagliata) e cache in memoria del processo
- `lib/prompts.ts` — testo dei tre prompt inviati a Gemini (FASI A, D, E). Assembla soltanto, non decide nulla: le fasi e il loro ordine stanno in `route.ts`. Il testo è il risultato di molte iterazioni, va modificato con prudenza
- `lib/debug.ts` — `DEBUG_ATTIVO` e `logDebug` condivisi da `route.ts` e `lib/scryfall.ts`
- `lib/limite.ts` — `richiestaConsentita(ip)`, limite di richieste per IP in memoria del processo
- `lib/verifica.ts` — `contieneRegolaCondizionaleComplessa()` e la lista `INDICATORI_REGOLA_CONDIZIONALE`: decidono se far scattare la FASE E. Stanno qui e non in `route.ts` per essere importabili da `scripts/prova-verifica.mjs` (quindi **niente alias `@/`** in questo file); vedi "Quando scatta la FASE E" per il criterio con cui si aggiunge o toglie una voce
- `lib/discussioni.ts` — ricerca nelle discussioni di Board Games Stack Exchange. **NON è collegato a `route.ts`**: esiste solo per la sonda `prova-copertura` (vedi "Discussioni della community" più sotto per la decisione presa e il perché)
- `app/components/` — `AllegatoFoto.tsx`, `BollaMessaggio.tsx`, `IntestazioneChat.tsx`: componenti presentazionali estratti da `page.tsx`
- `app/tipi.ts` — tipi condivisi fra pagina e componenti
- `data/comprehensive-rules.txt` — testo grezzo ufficiale scaricato da media.wizards.com
- `data/tournament-rules.pdf` — PDF ufficiale del Magic Tournament Rules scaricato da media.wizards.com
- `data/regole-compatte.json` e `data/mtr-compatte.json` — versioni pre-elaborate (`{dataEfficacia, capitoli, blocchi}`) generate dai due script; **entrambe vanno committate** perché sono i file letti a runtime, e **dichiarate in `next.config.ts` sotto `outputFileTracingIncludes`**, altrimenti Vercel non le include nel pacchetto e in produzione la ricerca falla pur funzionando in locale
- `data/errata-locali.json` — lista di correzioni manuali scritte a mano (non generata da uno script); anche questa va committata e dichiarata in `next.config.ts`, stessa regola degli altri due file dati
- `scripts/prepara-regole.mjs` — script Node (ESM) che rigenera `regole-compatte.json` da `comprehensive-rules.txt`
- `scripts/prepara-regole-torneo.mjs` — script Node (ESM) che rigenera `mtr-compatte.json` da `tournament-rules.pdf` (usa `pdf-parse`, dipendenza di sviluppo: non finisce nel bundle di produzione)
- `scripts/prova-ricerca.mjs` e `scripts/prova-copertura.mjs` — banco di prova della ricerca e sonda delle discussioni (vedi "Comandi principali"). Importano i moduli reali di `lib/` sfruttando lo type stripping nativo di Node, quindi misurano il codice che va in produzione e non una copia della sua logica. Per questo i moduli che devono restare importabili da qui **non usano l'alias `@/`**, che Node non risolve
- `scripts/genera-icone-pwa.mjs` — genera le icone e gli screenshot PWA in `public/` (usa `sharp`, va lanciato solo se le icone cambiano)

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

**Regola generale che vale oltre le errata: un dato recuperato da una fonte ufficiale va MOSTRATO al
modello, non solo usato internamente.** La riga del tipo delle carte veniva recuperata da Scryfall e
usata soltanto per arricchire le parole chiave della ricerca, poi scartata: nel prompt non compariva.
Il modello, privo di una fonte per tipi e supertipi, li deduceva dall'Oracle Text — e in una prova ha
attribuito a Urza's Saga il supertipo "Legendary", che non ha, citando come fonte "i ruling di Blood
Moon". La parola "legendary" era nel prompt solo perché compare come esempio generico dentro il testo
della regola 305.7. Se un dato serve al ragionamento, va nel prompt con la sua etichetta.

Dopo aver aggiunto una voce, va anche eseguito
di nuovo `npm run build` e verificato che `data/errata-locali.json` compaia nel file
`.next/server/app/api/judge/route.js.nft.json`, altrimenti la correzione funziona in locale ma non
in produzione.

`lib/dizionario.ts` (dizionario italiano-inglese locale per l'estrazione di keyword senza Gemini) **non esiste ancora** — è un'ottimizzazione proposta ma non applicata, vedi "Cosa manca ancora".

## Decisioni architetturali importanti

Perché non mandiamo l'intero regolamento a Gemini ogni volta: consumerebbe troppa quota gratuita. Invece:
1. Una prima mini-chiamata a Gemini (FASE A) estrae parole chiave inglesi + numeri di regola citati + nomi di carte, analizzando il messaggio corrente **insieme a tutta la cronologia della conversazione fin qui** (non solo l'ultimo messaggio, altrimenti una carta già identificata in un turno precedente "sparisce" se il turno successivo non la rinomina esplicitamente).
2. `cercaRegolePertinenti()` in `lib/rules.ts` cerca localmente (gratis, zero token) i blocchi di regole più pertinenti, prima per capitolo (macro) poi per singolo blocco (micro).
3. Se ci sono nomi di carte, `cercaDatiCarta()` in `lib/scryfall.ts` interroga Scryfall per riga del tipo + Oracle Text + Rulings + legalità (massimo 6 carte per richiesta, **una dopo l'altra e non in parallelo**: ogni carta è una catena di più chiamate che al proprio interno già rispetta una pausa, e lanciarne sei insieme superava di molto il ritmo richiesto dall'API pubblica di Scryfall).
4. Una seconda chiamata a Gemini (FASE D) genera il verdetto finale, con SOLO gli estratti reali trovati come contesto, istruito a citare esclusivamente quei numeri di regola — mai a memoria. Se è allegata una foto, questa chiamata è multimodale (l'immagine viene passata insieme al prompt testuale).
5. Se gli estratti contengono una regola condizionale a più clausole, una terza chiamata (FASE E) ricontrolla la conclusione in modo isolato, con un procedimento a tre passi: prima ricalcola dai soli regolamenti, poi guarda i rulings delle carte, infine confronta col verdetto già scritto e lo corregge solo se contraddice il proprio calcolo.

Gerarchia delle fonti nel prompt (attenzione: è stata **invertita** rispetto alla versione iniziale del progetto): le Comprehensive Rules sono la fonte primaria per le meccaniche di gioco, perché vengono aggiornate a mano a ogni pubblicazione di Wizards e quindi riflettono il funzionamento attuale, mentre un ruling di carta resta fermo alla data in cui è stato scritto. Sulle procedure di torneo prevale l'MTR, come dichiara il documento stesso nella propria introduzione. Il testo Oracle resta la fonte per sapere cosa fa la carta, e i rulings servono per le interazioni specifiche — ma se un ruling è anteriore alla data di validità delle CR fornite e le contraddice, prevalgono le CR. Il caso che ha motivato questa inversione: un ruling del 2021 su Urza's Saga è stato superato dalla modifica della regola 714.4 del 2025, e il giudice continuava ad applicare il ruling vecchio.

Ricerca nei due regolamenti — perché due strategie diverse: le CR hanno 3869 blocchi brevi su 146 capitoli dai titoli specifici ("Sagas", "Lands"), quindi selezionare prima i capitoli pertinenti e poi i blocchi dentro ciascuno evita che un capitolo prolisso soffochi quello decisivo. L'MTR ha invece 94 blocchi lunghi su appena 16 capitoli dai titoli quasi identici (la parola "Tournament" compare in cinque titoli su sedici): lì la selezione per capitolo produce pareggi e scarta il capitolo giusto, quindi si usa il titolo della sottosezione con cui ogni blocco inizia ("5.2 Bribery: ...", "2.8 Deck Checks: ..."). Quel titolo fa anche da filtro di pertinenza: se nessuna sottosezione tocca la domanda, l'MTR non viene incluso affatto, così non inquina le domande di pura meccanica di gioco. **Non riusare la ricerca delle CR per l'MTR**: è già stato provato e produceva risposte sbagliate.

Attenzione però a non fidarsi troppo dei titoli dei capitoli CR: sono specifici, ma spesso non contengono il vocabolario della domanda (il capitolo 714 si intitola "Saga Cards" e non contiene "lore counter"; il 702 è "Keyword Abilities" e non contiene "deathtouch"). Per questo la selezione per capitolo è accompagnata da una ricerca globale **sempre attiva** come rete di sicurezza, e dal confronto sulla parola-testa della locuzione. Prima di toccare `lib/rules.ts`, lanciare `npm run prova-ricerca`: quei meccanismi esistono tutti per casi misurati, non per prudenza astratta.

Controllo di ambiguità: il prompt istruisce il modello a fare SOLO le domande la cui risposta cambierebbe davvero il verdetto (non a chiedere qualunque dettaglio mancante), assumendo lo scenario standard/più comune per il resto e dichiarandolo nel verdetto. Se restano domande davvero dirimenti, al massimo 2-3 per turno, tutte insieme, mai una alla volta — la risposta deve iniziare ESATTAMENTE con "⚠️ Ho bisogno di alcuni chiarimenti prima di poter rispondere correttamente:".

Pulsanti di risposta rapida ai chiarimenti: quando il giudice chiede chiarimenti, il prompt gli impone di aggiungere in coda alla risposta un blocco delimitato da `===OPZIONI_CHIARIMENTO===` / `===FINE_OPZIONI===` contenente un JSON con, per ogni domanda posta, un elenco di 2-4 possibili risposte brevi (o un array vuoto se la domanda è aperta). `app/page.tsx` estrae questo blocco, lo rimuove dal testo mostrato all'utente, e mostra un pulsante per ogni opzione: cliccarlo inserisce (non invia) il testo `Riguardo a "<domanda>": <opzione>` nel campo di testo, così l'utente può cliccare più risposte e poi inviarle insieme.

Conversazione multi-turno: `app/page.tsx` mantiene uno stato `cronologia` (`{ruolo: "utente"|"giudice", testo}[]`) e lo invia ad ogni richiesta insieme al nuovo messaggio; `route.ts` la usa in tutte e tre le fasi che parlano con Gemini: in FASE A (per non perdere carte/regole già citate), in FASE D (per dare un verdetto coerente con quanto già detto, specialmente se l'utente ha appena risposto a una richiesta di chiarimento) e in FASE E (perché il revisore ricalcola il verdetto da zero, e l'ultimo messaggio da solo può non contenere lo stato di gioco).

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

## Limite di dimensione della richiesta su Vercel (caso risolto: foto del tavolo)

**Vercel rifiuta ogni richiesta il cui corpo supera 4,5 MB**, e la blocca prima che la funzione
venga eseguita: risponde `413` con un corpo di **testo semplice** (`Request Entity Too Large` /
`FUNCTION_PAYLOAD_TOO_LARGE`), non in JSON. Misurato dal vivo contro l'app deployata.

Ne derivavano due difetti, entrambi corretti:

1. **Le foto scattate col telefono superavano il limite.** Una foto da 3-5 MB, convertita in base64
   per viaggiare dentro il JSON, cresce di un altro 33% e sfonda i 4,5 MB. Il difetto era
   intermittente per natura (una foto da 2,5 MB passa, una da 3,5 MB no) e **invisibile in locale**,
   dove quel limite non esiste. Risolto rimpicciolendo la foto nel browser prima dell'invio
   (`preparaFotoPerInvio` in `app/page.tsx`): lato massimo 1600 px e ricompressione JPEG a qualità
   0,85. Misurato: 4032×3024 → 1600×1200, da ~2,2 MB a 0,54 MB di base64; una carta in PNG da
   1,5 MB scende a 253 KB. Il ridimensionamento usa `createImageBitmap` con
   `imageOrientation: "from-image"` perché **raddrizza le foto verticali** leggendo l'orientamento
   EXIF: senza, il giudice riceve la foto coricata su un fianco.
2. **L'app dava la colpa alla connessione.** `page.tsx` faceva `await response.json()` su una
   risposta che JSON non era: l'eccezione finiva nel `catch` di rete e mostrava «Impossibile
   contattare il server», mentre il server aveva risposto benissimo. Ora il corpo si legge come
   testo e si interpreta a parte, e `messaggioPerErroreDiPiattaforma` traduce il codice HTTP
   (413 = foto troppo pesante, 408/502/504 = troppo lento, 429 = troppe richieste).

**Conseguenza da tenere presente: il controllo degli ~8MB in `erroreValidazioneImmagine`
(`route.ts`) è irraggiungibile in produzione**, perché il taglio di Vercel a 4,5 MB scatta prima.
Vale solo in locale. Non è stato rimosso perché resta una rete di sicurezza per l'esecuzione locale
e per un eventuale cambio di piattaforma, ma non contarci come difesa reale.

## Problema noto (risolto): OneDrive
Il progetto era originariamente in C:\Users\augus\OneDrive\Desktop\virtual-judge-mtg — causava file salvati a 0 byte (placeholder cloud non sincronizzati, attributo ReparsePoint) e conflitti di lockfile. Il progetto è stato spostato in C:\ProgettiDev\virtual-judge-mtg, FUORI da OneDrive. Non ricreare mai il progetto dentro cartelle sincronizzate da OneDrive/Dropbox/Google Drive.

## Cosa è già stato implementato
- Form domanda testuale + verdetto con citazioni reali da CR
- Integrazione Scryfall per carte specifiche (Oracle Text + Rulings), con cascata fuzzy → autocomplete → ricerca testuale e verifica di somiglianza del nome per evitare falsi positivi
- Controllo di ambiguità nel prompt, con limite di domande per turno e verdetti condizionali quando possibile
- Rimozione di qualsiasi rivendicazione di certificazione da parte del "giudice"
- Upload/scatto foto del tavolo (con anteprima e rimozione), analizzata da Gemini in modo multimodale, **rimpicciolita nel browser prima dell'invio** (1600 px di lato, JPEG) per stare sotto il limite di 4,5 MB di Vercel — vedi la sezione dedicata. Durante il ridimensionamento il pulsante di invio è disabilitato e scrive "Preparo la foto...", altrimenti la richiesta partirebbe senza l'allegato appena scelto
- **Scelta fra fotocamera e galleria su telefono** (corretto il 19 agosto 2026): l'`<input type="file">` di `app/components/AllegatoFoto.tsx` portava `capture="environment"`, che su mobile apre di filato la fotocamera e **impedisce di caricare una foto già presente in galleria** — l'etichetta prometteva "Allega o scatta" ma si poteva solo scattare. Tolto l'attributo, il browser mobile mostra da sé il menu con entrambe le strade (iOS: "Libreria foto / Scatta foto / Scegli file"; Chrome Android: "Fotocamera / File"); su desktop non cambia nulla perché lì `capture` era comunque ignorato. Nel componente c'è un commento che dice di non rimetterlo
- Conversazione multi-turno con cronologia mantenuta lato client e inviata ad ogni richiesta
- Pulsanti di risposta rapida alle domande di chiarimento del giudice
- Script `prepara-regole.mjs` per compattare il regolamento in JSON (146 capitoli, 3869 blocchi trovati nell'ultimo run)
- Validazione input in `route.ts`: lunghezza massima della domanda (2000 caratteri), tipo di immagine consentito (PNG/JPEG/WEBP), dimensione massima dell'immagine (~8MB, calcolata sulla lunghezza della stringa base64 — **controllo irraggiungibile in produzione**, vedi "Limite di dimensione della richiesta su Vercel") e cronologia validata nella forma (solo elementi con `ruolo` ammesso e `testo` di tipo stringa) e limitata a 16000 caratteri complessivi, tenendo i messaggi più recenti
- Log di debug (`[DEBUG]` in `route.ts` e `[DEBUG Scryfall]` in `lib/scryfall.ts`) disattivabili tramite la variabile d'ambiente `DEBUG_JUDGE` (attivi solo se `DEBUG_JUDGE=true` in `.env.local`, altrimenti silenziosi), tramite la funzione condivisa `logDebug` in `lib/debug.ts` (non più duplicata fra i due file)
- PWA installabile — `public/manifest.json`, icone reali (192/512, standard e maskable) generate con `scripts/genera-icone-pwa.mjs`, metadata `appleWebApp`/`icons` e `viewport.themeColor` in `app/layout.tsx`
- Limite di richieste per IP — 20 richieste ogni 10 minuti (`lib/limite.ts`), contatore in memoria del processo: protezione parziale (si azzera ai cold start su Vercel, non condivisa tra istanze), ma molto meglio di nessun limite
- Recupero delle regole (CR) corretto: ricerca globale di sicurezza sempre attiva anche quando dei capitoli erano già stati selezionati (prima scattava solo se nessun capitolo veniva trovato) e confronto per parola intera invece che per sottostringa (evita falsi positivi tipo "tap" dentro "untapped"); verificato con `npm run prova-ricerca` (8 casi, passava da 5/8 a 8/8)
- Tono dei messaggi di errore in `route.ts` — verificato in questa sessione, giudicato adeguato così com'è
- Messaggi di errore lato client onesti: una risposta che non arriva in JSON non viene più scambiata per assenza di rete, ma tradotta per codice HTTP (`messaggioPerErroreDiPiattaforma` in `app/page.tsx`). Verificato simulando nel browser i quattro casi: 413, 504, errore JSON della nostra API, rete davvero assente
- Refactor completati: testi dei prompt estratti in `lib/prompts.ts`, `app/page.tsx` spezzata in componenti (`app/components/AllegatoFoto.tsx`, `BollaMessaggio.tsx`, `IntestazioneChat.tsx`)
- Cache in memoria per le ricerche Scryfall (`lib/scryfall.ts`) — evita di rifare le stesse chiamate di rete per carte già cercate, condivisa da tutte le richieste sulla stessa istanza calda del processo
- Affidabilità sulle regole condizionali — decisione presa: FASE E (il doppio controllo sulle regole a più clausole) usa `gemini-3.6-flash` invece di `gemini-3.5-flash-lite`, con fallback al verdetto FASE D non verificato se la quota stretta di quel modello si esaurisce (vedi "Modelli Gemini" sopra). Ulteriori istruzioni nel prompt avevano già mostrato rendimenti decrescenti prima di questa decisione. Effetto reale non misurato con un banco di prova (a differenza del recupero regole)
- La FASE E riceve anche la **cronologia**, non solo l'ultimo messaggio: in una chat multi-turno quel messaggio può non contenere quasi nulla dello stato di gioco (un turno reale era «Riguardo a <domanda>: Per effetto di Blood Moon»), e il revisore ricalcolava su uno stato incompleto potendo sovrascrivere un verdetto corretto
- La **riga del tipo** delle carte viene mostrata al modello, non solo usata per la ricerca (vedi la regola generale in "Correzioni manuali" sopra)
- Il fallimento del parse JSON della FASE A finisce in `console.error`: prima era un `catch` nudo, e una risposta a memoria senza fonti non lasciava traccia nei log. **Il comportamento non è cambiato**: la richiesta prosegue senza fonti, resta da decidere se debba invece fallire
- La cache Scryfall distingue «carta inesistente» (404, memorizzato) da «ricerca fallita» (429/5xx o eccezione, non memorizzato): prima un guasto momentaneo rendeva quella carta introvabile per tutta la vita del processo
- Il confronto sui numeri di regola citati è normalizzato (`trim` + minuscole) e ignora le stringhe vuote: `"qualsiasi cosa".startsWith("")` è true, e un elemento vuoto avrebbe fatto includere l'intero MTR in ogni domanda
- La selezione dei capitoli CR confronta anche la **parola-testa** della locuzione ("triggered *ability*" trova il capitolo "Abilities"), tollerando il plurale in `-ies` che il confronto per prefisso non copre. Costo misurato: il testo CR nel prompt cresce di circa il 22%
- FASE A estrae ora anche i descrittori di **STATO** di un permanente (unlocked/locked/door, tapped/untapped, flipped, transformed, segnalini), non solo il nome della meccanica: prima la domanda "una stanza con un solo lato aperto" non produceva mai "unlocked"/"door" nelle parole chiave, rendendo impossibile qualsiasi recupero utile a prescindere da come funzioni la ricerca. Verificato dal vivo (log di produzione)
- Recupero delle CR: un capitolo entra in lista anche a punteggio di titolo zero se il suo corpo ha almeno 3 blocchi indipendentemente pertinenti ("candidatura per corpo", oltre a quella per titolo), con uno spareggio dedicato per i pareggi fra capitoli scorrelati. Aggiunto il caso "Stanza con un solo lato sbloccato" a `scripts/prova-ricerca.mjs`; 10/10 casi passano, nessuna regressione. **Non risolve il problema in modo affidabile al 100%**: vedi "Limite noto" più sotto
- FASE E: aggiunto un indicatore per il pattern "as long as this permanent doesn't have..." (regola 709.5, Stanze/Room e altre carte con riga del tipo condivisa) — un test in produzione ha mostrato il giudice citare correttamente la 709.5 ma invertirne la conclusione, senza che la FASE E scattasse a ricontrollare perché nessun indicatore esistente compariva in quel testo. Gli apostrofi sono ora normalizzati all'ASCII su entrambi i lati del confronto: il testo CR usa quello tipografico (U+2019) e l'indicatore era scritto in ASCII, una dipendenza che si sarebbe spenta in silenzio a ogni rigenerazione dei dati
- **Budget di testo del regolamento raddoppiato** (`LIMITE_CARATTERI` 9000 → 18000 per fonte): il tetto precedente era tarato quando si credeva che la quota gratuita fosse vincolata sui token, mentre lo è sulle richieste al giorno. Era diventato il vincolo che decideva sempre quali regole arrivavano al modello — misurato, gli estratti CR occupavano fra l'82% e il 99% del limite in OGNI caso di prova. In più `assemblaEstratti` ora salta il blocco che non ci sta (`continue`) invece di chiudere l'assemblaggio (`break`), che buttava via anche tutti i blocchi corti successivi
- **Il Glossario ufficiale è collegato al recupero** (`capitoliDaGlossario`): 726 voci, di cui 631 con un rimando "See rule NNN" scritto da Wizards, usate come mappa vocabolario → capitolo con voto pesato per rarità del termine. Vedi "Caso risolto: regola 709.5" per il perché del voto e del peso
- **I blocchi si portano dietro la regola padre** (`conBlocchiPadre`): le CR sono un albero e recuperare "709.5j" senza "709.5." consegna al modello il rimando senza la regola. È stata la causa decisiva del bug delle Stanze, sfuggita a tutta l'analisi precedente
- **Rilevatore di citazioni senza fonte** in `route.ts` (`numeriDiRegolaCitati` / `regoleCitateSenzaFonte`): se il verdetto cita un numero di regola che NON compare negli estratti forniti, il modello l'ha preso dalla propria memoria. Finisce in `console.error` e fa scattare la FASE E. Prima la FASE E guardava solo il testo delle regole RECUPERATE, quindi restava inerte proprio quando il recupero aveva fallito, cioè nel caso peggiore
- Snellimento del codice a parità di comportamento, 7 commit su `simplify/judge-cleanup` (vedi la sezione dedicata più sotto per il metodo e per le semplificazioni valutate e scartate): codice morto e ripetizioni rimosse, costanti del recupero raccolte in cima a `rules.ts`, e le due funzioni lunghe (`cercaBlocchiPertinenti`, `POST`) spezzate nei loro passi. Verificato con confronto **byte per byte** dell'output del recupero su 23 casi: impronta SHA256 identica dal primo all'ultimo commit
- Il prompt della FASE D distingue ora "estratti presenti" da "estratti pertinenti": deve dichiarare apertamente quando nessuna fonte affronta direttamente il caso, invece di trattare la presenza di estratti come garanzia che siano quelli giusti

## Prestazioni misurate in produzione

### Il costo per richiesta è Gemini, non l'infrastruttura (misurato il 19 agosto 2026)

**Lo stato caldo è ~10 s**, imputabile alle 2-3 chiamate Gemini sequenziali: è questo il numero su
cui lavorare se si vuole accelerare l'app. Tutto il resto è stato misurato e risulta trascurabile:

| Cosa | Tempo | Come è stato misurato |
|---|---|---|
| funzione già sveglia, senza Gemini | 168-185 ms | sonde ripetute su `/api/judge` |
| latenza di rete pura (file statico) | ~150-200 ms | `manifest.json` dalla stessa macchina |
| lettura + parse dei 3 file dati (1,2 MB) | **15 ms** | benchmark locale con Node |

Cioè: **la funzione sveglia aggiunge meno di 50 ms** al viaggio di rete, e i file dati non pesano
niente (per giunta il loro caricamento è pigro, `caricaDati` in `lib/rules.ts`: avviene alla prima
ricerca, non all'avvio della funzione, quindi non toccherebbe il cold start nemmeno se fosse lento).

**Sonda gratuita e ripetibile, da riusare per ogni misura futura**: un `POST` a `/api/judge` con
`{"domanda":""}` riceve un `400` prima di qualunque chiamata a Gemini, quindi misura l'avvio della
funzione **senza consumare quota**. Conta però sul limite per IP (20 richieste ogni 10 minuti).

### Dove vanno i secondi: la FASE E è il collo di bottiglia (misurato il 19-20 agosto 2026)

Tempi per fase su richieste reali, letti dal cronometro di `route.ts` (`avviaCronometro`, che allega
i tempi alla risposta quando `DEBUG_JUDGE=true`):

| Fase | Domanda con 2 carte | Domanda semplice |
|---|---|---|
| FASE A — Gemini, estrazione | 693-875 ms | 620 ms |
| FASE B — Scryfall | 478-1062 ms | 2 ms |
| FASE C — ricerca locale nei regolamenti | 258-363 ms | 186 ms |
| FASE D — Gemini, verdetto | ~2100 ms | 1516 ms |
| **FASE E — Gemini, verifica** | **7526 ms, e 22818 ms in una seconda prova** | non eseguita |
| **TOTALE** | **11,5 s / 26,9 s** | **2,3 s** |

**Una sola chiamata fa il grosso del tempo**, e non è la sequenza di 2-3 chiamate a cui il documento
attribuiva i ~10 s: senza FASE E la stessa app risponde in **2,3 secondi**. La durata della FASE E è
per giunta molto variabile (7,5 s e 22,8 s sulla STESSA domanda), quindi una misura sola non basta
mai a giudicarla.

Ne segue che **il dizionario locale IT-EN proposto per saltare la FASE A vale meno di un secondo su
undici**: è il bersaglio sbagliato, ed è stato declassato in «Cosa manca ancora».

`npm run prova-verifica` misura su quanti casi la FASE E scatta, gratis e senza chiamare Gemini.
Misurato: **9 casi su 13 (69%) prima**, **8 su 13 (62%) dopo** aver reso più selettivi gli
indicatori (vedi "Quando scatta la FASE E" più sotto). Attenzione a leggere quella percentuale: i
casi di prova sono scelti per essere difficili, quindi sovrastimano la frequenza reale.

### Quando scatta la FASE E: indicatori resi più selettivi

`INDICATORI_REGOLA_CONDIZIONALE` in `lib/verifica.ts` deve elencare **condizioni da ricalcolare, non
meccanismi di gioco**. Sono state tolte due voci che violavano questo criterio:

- `"state-based action"` — da sola causava **6 scatti su 9**, perché nomina un meccanismo citato in
  mezzo regolamento. Faceva ricontrollare perfino una domanda sulla corruzione in torneo.
- `" and it is"` — stesso difetto, frammento troppo comune.

È stata aggiunta `"two or more"`, la formula esatta della regola dei permanenti leggendari (704.5j,
verificata nel testo CR): è una condizione a più clausole che non usa nessuno degli altri confronti,
e senza quella voce sarebbe rimasta senza innesco.

**Provato e scartato**: aggiungere le quantità scritte a parole (`"at least"`, `"more than"`,
`"fewer than"`) riportava gli scatti a 9 su 13 accendendone di nuovi altrettanto inutili (una
domanda sul sideboard). Troppo comuni. **Provata e risultata inutile** anche la divisione degli
estratti in blocchi per pretendere la co-occorrenza di due segnali nello stesso blocco: siccome ogni
variante scatta al primo riscontro, dà lo stesso risultato della ricerca piatta e in più complica il
codice. La differenza viene tutta dalla lista delle frasi.

Verificato dal vivo dopo la modifica: sul benchmark Urza's Saga + Blood Moon la FASE E scatta ancora
e il verdetto resta corretto.

### Il cold start è ~0,6 s, non 44 s (misurato, cifra vecchia smentita)

Una serie di tre richieste (54,3 s / 10,0 s / 9,7 s) aveva fatto scrivere qui che «il cold start
domina, con circa 44 secondi di scarto». **Misurato: è falso.** Due prove indipendenti dopo ~9
minuti di silenzio ciascuna:

| Prova | 1ª richiesta (istanza addormentata) | richieste successive |
|---|---|---|
| senza connessione già aperta | 1017 ms | 197 ms |
| con connessione TLS già aperta su file statici | **814 ms** | 181 / 172 ms |

**Il risveglio costa circa 640 ms** (814 meno i ~175 ms di una richiesta calda), cioè circa settanta
volte meno di quanto scritto prima. La seconda prova è quella valida: la prima richiesta di ogni
serie paga anche l'apertura della connessione TLS del client, che da sola vale ~1 s **anche su un
file statico**, dove nessuna funzione viene invocata — chi misura senza tenerne conto attribuisce al
server un secondo che è del proprio client.

Resta non misurata **la primissima invocazione di un deploy nuovo**: è l'unica ipotesi rimasta per i
54,3 s originali, dato che quelle tre misure furono prese subito dopo un rilascio. Se regge, il
ritardo colpisce solo chi apre l'app per primo dopo un rilascio, e non vale la pena inseguirlo.
Prova da fare al prossimo rilascio vero, senza forzarne uno apposta.

Un tentativo del 19 agosto 2026 **è fallito, e il motivo vale come regola**: il commit pubblicato
toccava solo CLAUDE.md, che non entra nella build. Il pacchetto servito ai browser era quindi
identico byte per byte a quello precedente, e **dall'esterno non esisteva alcun segnale che
distinguesse il deploy nuovo dal vecchio**. Misurare la prima invocazione di un rilascio richiede un
rilascio che cambi davvero il codice dell'app.

**Metodo per non sprecare la misura** (già sprecata due volte):
- La prova va fatta con il deploy ormai vecchio, e serve che nessun altro tocchi il sito nella
  finestra di silenzio precedente — condizione non verificabile dall'esterno.
- **Aprire prima la connessione su un file statico**, poi cronometrare la funzione: `/` e
  `manifest.json` sono serviti dalla CDN (`○ Static` nell'output di `npm run build`) e **non
  risvegliano la funzione**, quindi non falsano la misura. La nota precedente sconsigliava di
  caricare la homepage temendo il contrario: era un timore infondato, e l'anomalia che l'aveva
  motivata (9,3 s "a freddo" contro 12,3 s "a caldo") era con ogni probabilità la normale
  variabilità di Gemini.
- **Per sapere se un deploy nuovo è davvero online, cercare una stringa nuova dentro il pacchetto
  JavaScript servito** — scaricare la homepage, estrarne i percorsi `/_next/static/chunks/*.js` e
  cercarvi dentro un testo introdotto da quel rilascio (es. `"Preparo la foto"` per il rilascio del
  19 agosto 2026). **Gli header di cache non servono**: `Age` a zero e `X-Vercel-Cache` diverso da
  `HIT` compaiono anche alla normale rivalidazione della homepage (servita con `must-revalidate`), e
  in una prova hanno segnalato un deploy «pubblicato» 12 secondi dopo il push, quando una build ne
  richiede almeno sessanta.

Il **timeout della funzione su Vercel non è un problema**: la richiesta da 54,3 s è andata a buon
fine, quindi il limite è ben oltre il minuto. Non serve controllare la dashboard per questo.

## Discussioni della community (decisione presa: non integrare)

`lib/discussioni.ts` interroga Board Games Stack Exchange e **non è collegato all'app** di proposito.
La sonda `prova-copertura` ha misurato che su sei casi tutti trovano una discussione che cita numeri
di regola CR, ma solo circa metà risponde alla domanda *esatta*: le altre sono pertinenti
all'argomento e non alla domanda, e infilare nel prompt testo vicino-ma-diverso è proprio il difetto
che il progetto combatte. Inoltre nessuna delle risposte trovate era stata aggiornata dopo l'ultimo
aggiornamento delle CR locali.

Soprattutto: sull'unico caso reale in cui una ricerca su Google aveva battuto il giudice, la causa
era **una nostra nota errata scritta male**, non la mancanza di fonti — e la regola decisiva era già
nel prompt. Aggiungere una fonte non ufficiale per un problema che non abbiamo osservato sarebbe
rischio senza beneficio dimostrato. La sonda resta utile come **strumento diagnostico**: è
confrontando la spiegazione della community con la nostra che l'errore è emerso.

## Caso risolto: recupero della regola 709.5 (carte Stanza/Room)

Domanda reale che ha innescato questo lavoro: «Ho in campo una stanza con un solo lato aperto
(Roaring Furnace). Quanto è il costo di mana della stanza?» Il giudice rispondeva che il costo si
combina SEMPRE da entrambi i lati, indipendentemente da quale sia sbloccato — sbagliato: la regola
709.5 dice che il lato bloccato non ha il proprio nome, costo di mana né testo finché resta bloccato,
quindi con un solo lato sbloccato il costo è solo quello di quel lato.

**Stato: risolto.** `npm run prova-ricerca` passa 12 casi su 13 (fra cui 3 varianti del caso Stanze, con parole
chiave mirate, povere e generiche), e la stessa domanda provata dal vivo 3 volte di fila dà 3 risposte
corrette (prima dei fix: 1 su 3). Restano documentate qui sotto le cause e i tentativi falliti, perché
la diagnosi è più istruttiva della soluzione.

Diagnosticate **tre cause distinte**, tutte corrette:

1. **FASE A non estraeva mai "unlocked"/"locked"/"door"** dalla domanda, nonostante l'utente avesse
   scritto esplicitamente "un solo lato aperto" — risolto nel prompt di estrazione in `lib/prompts.ts`.
2. **Il capitolo 709 "Split Cards" non arrivava negli estratti**, perché il suo titolo non condivide
   vocabolario con "Room"/"door"/"unlocked" (stesso problema già noto per "Saga Cards"/"lore counter").
   Risolto dal canale **Glossario** in `lib/rules.ts` (vedi più sotto).
3. **Anche quando il capitolo 709 ARRIVAVA, la regola decisiva restava fuori.** È la causa sfuggita a
   tutta l'analisi precedente, e da sola spiegava i fallimenti residui: nell'intero capitolo 709 la
   parola "Room" compare in **un solo blocco su 22**, la 709.5j (92 caratteri, dice soltanto che le
   Stanze sono carte divise con designazioni "porta"). La regola che risponde alla domanda è la
   **709.5.**, che non contiene né "room" né "door": prendeva punteggio zero ed era scartata dal filtro
   `punteggio > 0`, così il modello riceveva il rimando senza la regola. Risolto dall'**inclusione del
   blocco padre** (`conBlocchiPadre` in `lib/rules.ts`): le CR sono un albero, "709.5." enuncia il
   principio e "709.5a".."709.5j" lo raffinano, quindi un figlio selezionato si porta dietro il padre.

**Tentativi fatti e scartati** (per NON riprovarli senza un'idea nuova, non misurata):
- Spareggio fra capitoli a pari punteggio di titolo tramite conteggio dei blocchi nel corpo: regredisce
  il caso "Abilità sulla pila indipendente dalla fonte" (un capitolo verboso come 702 "Keyword
  Abilities" batte uno conciso ma decisivo come 113 "Abilities" solo perché ne accumula di più).
- Spareggio tramite il punteggio del singolo blocco più pertinente del capitolo (invece del conteggio):
  risolve il caso precedente ma produce un NUOVO pareggio casuale con un capitolo scorrelato (es. 205
  "Type Line", che tratta i sottotipi in generale).
- Agganciare il Glossario **una parola alla volta**: funziona per "Door" ma "Room" è polisemico nel
  glossario stesso (rimanda sia a 709 "Split Cards" sia a 309 "Dungeons", che usa "room" con un
  significato completamente diverso ed è testualmente simile), quindi aggancia anche 309 e ne consuma
  il budget di caratteri. Superato contando i **voti di tutte le parole chiave insieme** (vedi sotto).
- Cambiare l'ordine di elaborazione fra "capitoli trovati per titolo" e "capitoli trovati per corpo"
  (prima gli uni, poi gli altri, o viceversa), oppure ordinare i blocchi finali per punteggio invece
  che per capitolo di provenienza: ciascuna variante risolve uno dei due casi di prova e rompe l'altro.

**Perché il voto pesato del Glossario funziona dove l'aggancio per singola parola falliva.** Il
Glossario ufficiale ha 726 voci, di cui **631 contengono un rimando esplicito "See rule NNN"** scritto
da Wizards: è una mappa vocabolario → capitolo, cioè proprio il ponte che manca alla selezione per
titolo. Con "room" + "door" + "unlocked" il capitolo 709 prende 3 voti contro 1 di 309, e l'ambiguità
si scioglie da sola senza dover indovinare. Ma con le parole generiche di un turno reale ("mana cost",
"Enchantment", "permanent", "Room") tutto pareggiava a un voto e 709 finiva **settimo**, perché ogni
parola generica porta un voto a un capitolo genericamente pertinente (107, 303, 110, 205, 729). Da qui
il peso per rarità (`pesoDiRarita`): "door" compare in 1 blocco su 3129 e pesa 0,631, "permanent" ne
tocca 532 e pesa 0,110. **La pesatura per rarità è applicata SOLO al voto del Glossario, non al
punteggio dei blocchi**, che è tarato su molti casi misurati: estenderla resta un'ipotesi da misurare
a parte.

## Banco di prova manuale (scenario benchmark a 3 turni)

Da rifare a mano dopo modifiche che toccano prompt, fasi o recupero: trova bug che né `tsc` né
`prova-ricerca` possono vedere (nella sua ultima esecuzione ne ha trovati due).

1. «Ho Urza's Saga in gioco al secondo capitolo e il mio avversario lancia Blood Moon. Cosa succede?»
   → non viene sacrificata (714.4 richiede che ABBIA abilità di capitolo); le abilità già concesse
   dai capitoli I e II sopravvivono (305.7 non rimuove le abilità concesse da altri effetti); non
   riceve più segnalini lore (714.2d e 714.3b).
2. Con Karn, Scion of Urza e Wurmcoil Engine **in mano**: si può ancora creare il token Construct?
   → sì, ed è **1/1**, perché conta solo se stesso (le carte in mano non sono permanenti, Karn non è
   un artefatto, e Urza's Saga è Incantesimo Terra).
3. Se l'avversario avesse aspettato il terzo capitolo? → sì, il tutor si risolve comunque:
   un'abilità sulla pila esiste indipendentemente dalla propria fonte (113.7a).

## Cosa manca ancora (in ordine di priorità discusso con l'utente)
- Ottimizzazione velocità — **il fronte è uno solo: la FASE E** (7,5-22,8 s misurati, contro 2,3 s dell'intera richiesta quando non scatta; vedi "Dove vanno i secondi"). Primo passo già fatto: indicatori più selettivi, da 9 scatti su 13 a 8. I due passi successivi, non ancora tentati, sono **ridurre il testo che la FASE E riceve** (oggi fino a 36.000 caratteri di regolamenti: misurare prima se la sua durata dipenda davvero dalla lunghezza del prompt, vista la variabilità osservata) e **mostrare subito il verdetto della FASE D correggendolo dopo**, che azzererebbe l'attesa percepita senza toccare la correttezza finale. Infrastruttura, file dati e cold start sono stati misurati ed esclusi. Il dizionario locale IT-EN in `lib/dizionario.ts` **è declassato**: varrebbe meno di un secondo su undici
- Decisione di prodotto da prendere: se il parse JSON della FASE A fallisce, oggi il giudice risponde senza fonti avvisando l'utente. L'alternativa è restituire un errore. Il log c'è già, la decisione no
- **Estendere la pesatura per rarità al punteggio dei blocchi.** Oggi `pesoDiRarita` è usata SOLO per il voto del Glossario, dove è nuova e isolata. Il punteggio dei blocchi resta binario (+1 per parola chiave), quindi `Land` ed `Enchantment` — iniettate in automatico dalla riga del tipo Scryfall in `route.ts` — pesano quanto `deathtouch`. È la leva più profonda rimasta, ma tocca il cuore di una funzione tarata su molti casi misurati: va fatta misurando `npm run prova-ricerca` a ogni passo, mai a intuito.

  **Ora c'è un caso di prova che lo dimostra, e che oggi FALLISCE di proposito**: "Saga: parole chiave reali, coi tipi generici di Scryfall", fra i casi di `npm run prova-ricerca` (perciò il banco di prova sta a 12 su 13, non a 13 su 13 — non è una regressione, ed è il motivo per cui l'uscita resta a codice 0). Misurato il 19 agosto 2026 rieseguendo il banco di prova manuale a 3 turni: **nello scenario benchmark il capitolo 714 "Saga Cards" non viene recuperato affatto**, e il verdetto cita 714.4, 714.2d e 714.3b prendendole dalla memoria del modello (il rilevatore di citazioni senza fonte le registra in `console.error`, due esecuzioni su due). La risposta resta corretta **solo perché la nota di `errata-locali.json` su Urza's Saga enuncia già quelle regole per esteso**: su una Saga priva di errata non arriverebbe nulla. Le parole chiave reali del turno, copiate dal log, sono `["enchantment","land","lore counter","ability","type-changing effect","Enchantment","Land","Urza","Saga","Enchantment"]`: si noti che `Saga` c'è, e nonostante questo il capitolo non entra, perché quattro tipi generici pareggiano il voto di `lore counter`. Il caso gemello con parole scelte a mano (`chapter ability`, `sacrifice`, `state-based action`) passa: **la differenza fra i due è esattamente la misura del problema**, ed è la ragione per cui un banco di prova con vocabolario ideale non bastava a vederlo
- Osservato e non risolto: in una prova a 3 turni il giudice ha dato la conclusione giusta sull'abilità del terzo capitolo di Urza's Saga appoggiandosi a «la pila si risolve in modo indipendente dai permanenti» invece di citare la 113.7a — che **era** fra gli estratti (verificato nei log). Non è una lacuna di recupero ma variabilità del modello nel citare la fonte che ha davanti; se ricapita, il posto in cui intervenire è il prompt della FASE D, non `lib/rules.ts`. **Non si è ripetuto il 19 agosto 2026**: rieseguito il banco di prova a 3 turni, al terzo turno il giudice cita esplicitamente la 113.7a e la regola risulta fra gli estratti (nessuna segnalazione del rilevatore di citazioni senza fonte per quel numero). Una sola osservazione non chiude il caso, trattandosi di variabilità del modello, ma la voce resta qui senza altre prove a carico
- Semplificazioni valutate e **deliberatamente NON applicate** (vedi "Snellimento del codice" più sotto per il metodo, e non riproporle senza un'idea nuova): accorpare in `lib/scryfall.ts` le cinque ripetizioni dello schema "chiama → registra lo status → distingui 404 da guasto"; dare un nome al filtro `paroleChiave.filter((p) => p.length > 2)`; riscrivere come ciclo la cascata fuzzy → autocomplete → ricerca testuale; mettere in una costante condivisa la stringa `===OPZIONI_CHIARIMENTO===`, oggi ripetuta in `lib/prompts.ts`, `route.ts` e `app/page.tsx`
- Le note di lavoro personali (fra cui `REVISIONE.md`) sono in `note-di-lavoro/`, cartella esclusa da git

## Snellimento del codice (agosto 2026) — esito e metodo

Sette interventi a **parità di comportamento**, sul branch `simplify/judge-cleanup`: import morto
rimosso; in `route.ts` un `if` ridondante, un controllo su un caso impossibile, una funzione chiamata
due volte e una lista ricostruita ad ogni richiesta; in `rules.ts` le nove costanti del recupero
raccolte in cima al file e il conteggio delle parole chiave da tre cicli identici a una riga; in
`page.tsx` un nome al controllo di conversazione ancora attuale; infine lo spezzettamento delle due
funzioni lunghe (`cercaBlocchiPertinenti` 89 → 55 righe di codice, `POST` 152 → 127).

**Due lezioni pagate con altrettanti errori, da tenere presenti prima di proporre altre pulizie:**

1. **Non stimare a occhio quante righe si risparmiano: misurarle.** L'accorpamento delle cinque
   chiamate ripetute in `lib/scryfall.ts` era stato proposto come "~30 righe in meno" e, una volta
   scritto, ne aggiungeva 8 — perché per non confondere «Scryfall ha risposto 404» con «il corpo
   della risposta è vuoto» l'helper non può leggere il JSON al posto del chiamante. È stato
   annullato. Il comando per misurare:
   `grep -v "^\s*//" file | grep -v "^\s*$" | wc -l`
2. **Spezzare una funzione lunga fa crescere il file, non calare.** `rules.ts` è passato da 295 a 326
   righe di codice e `route.ts` da 272 a 284: il guadagno sta nella funzione più lunga e nel punto di
   ingresso, non nel totale. Va detto esplicitamente quando si propone, altrimenti si promette un
   risparmio che non arriverà.

**Come si verifica che un refactor di `lib/rules.ts` non abbia cambiato niente.** `npm run
prova-ricerca` al suo punteggio pieno NON basta: verifica solo che certi numeri di regola compaiano, quindi passa
anche se i blocchi recuperati, il loro ordine o le troncature sono cambiati — e siccome
`assemblaEstratti` tronca a `LIMITE_CARATTERI`, un cambio d'ordine cambia in silenzio QUALI regole
arrivano a Gemini. La verifica vera è salvare l'output **completo** di `cercaRegolePertinenti` e
`cercaRegoleTorneo` su tutti i casi prima della modifica, ricalcolarlo dopo e confrontare le due
impronte SHA256. Conviene aggiungere ai casi ufficiali qualche caso limite che quelli non toccano:
nessuna parola chiave, parole senza alcun riscontro, regola citata inesistente nella fonte,
numerazione MTR passata alle CR e viceversa, stringa vuota fra le regole citate. Durante questo
lavoro l'impronta è rimasta identica su 23 casi dal primo all'ultimo commit.

## Note di stile per chi genera codice su questo progetto
- Tutti i commenti, nomi di variabili/funzioni e messaggi rivolti all'utente sono in ITALIANO
- Il codice inglese va bene solo per keyword/parole chiave tecniche interne (termini di ricerca inviati a Scryfall/regole)
- Niente omissioni di codice ("// resto invariato") — sempre file completi quando si modifica qualcosa
- Testare sempre con npm run dev + Invoke-RestMethod (PowerShell) prima di considerare una modifica conclusa
