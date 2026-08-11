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

- `app/page.tsx` — interfaccia utente: chat multi-turno (cronologia dei messaggi utente/giudice), upload/scatto foto del tavolo con anteprima, pulsanti di risposta rapida ai chiarimenti del giudice
- `app/api/judge/route.ts` — endpoint principale (`POST`), orchestratore di tutta la logica: estrazione parole chiave/carte, ricerca regole, ricerca Scryfall, costruzione del prompt finale e chiamata a Gemini (anche multimodale, se è allegata un'immagine)
- `lib/rules.ts` — ricerca in entrambi i regolamenti, con due strategie diverse perché i due documenti hanno strutture opposte (vedi "Decisioni architetturali"): `cercaRegolePertinenti()` per le CR (a due fasi: macro capitolo poi micro blocco) e `cercaRegoleTorneo()` per l'MTR (per titolo di sottosezione). Per le CR i capitoli entrano da quattro canali indipendenti — titolo, corpo, numero di regola citato, e rimandi del Glossario ufficiale (`capitoliDaGlossario`, con voto pesato per rarità del termine) — e i blocchi selezionati si portano dietro la propria regola padre (`conBlocchiPadre`, perché "709.5." enuncia il principio che "709.5j" raffina)
- `lib/errata.ts` — `cercaErrataPertinenti()`, corrispondenza per nome esatto (case-insensitive) contro `data/errata-locali.json`; vedi "Correzioni manuali" più sotto
- `lib/scryfall.ts` — interrogazione API Scryfall per riga del tipo, Oracle Text, Rulings e legalità nei formati principali, con cascata di ricerca fuzzy → autocomplete → ricerca testuale (quest'ultima con verifica di somiglianza del nome, per evitare di accettare una carta sbagliata) e cache in memoria del processo
- `lib/prompts.ts` — testo dei tre prompt inviati a Gemini (FASI A, D, E). Assembla soltanto, non decide nulla: le fasi e il loro ordine stanno in `route.ts`. Il testo è il risultato di molte iterazioni, va modificato con prudenza
- `lib/debug.ts` — `DEBUG_ATTIVO` e `logDebug` condivisi da `route.ts` e `lib/scryfall.ts`
- `lib/limite.ts` — `richiestaConsentita(ip)`, limite di richieste per IP in memoria del processo
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
- Il prompt della FASE D distingue ora "estratti presenti" da "estratti pertinenti": deve dichiarare apertamente quando nessuna fonte affronta direttamente il caso, invece di trattare la presenza di estratti come garanzia che siano quelli giusti

## Prestazioni misurate in produzione

Tre richieste identiche di fila all'endpoint deployato, stessa domanda:

| Richiesta | Tempo |
|---|---|
| 1ª (istanza fredda) | 54,3 s |
| 2ª | 10,0 s |
| 3ª | 9,7 s |

Conclusioni: **il cold start domina**, con circa 44 secondi di scarto, e lo **stato caldo è ~10 s**,
imputabile alle 2-3 chiamate Gemini sequenziali. La causa dei 44 secondi NON è stata identificata: i
file dati sono stati esclusi (1,2 MB si analizzano in millisecondi), servirebbero i log di Vercel o
una strumentazione nel codice.

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

**Stato: risolto.** `npm run prova-ricerca` passa 12/12 (fra cui 3 varianti del caso Stanze, con parole
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
- Ottimizzazione velocità — ora misurata (vedi "Prestazioni"): ~10 s a caldo, ~54 s a freddo. I due fronti sono distinti e vanno affrontati separatamente. **A caldo** pesano le 2-3 chiamate Gemini sequenziali: la soluzione proposta è un dizionario locale IT-EN in `lib/dizionario.ts` per saltare la FASE A quando basta — **non applicata**, il file non esiste, e toglierebbe al massimo una delle tre chiamate. **A freddo** la causa dei 44 s di scarto non è nota e i file dati sono già stati esclusi: primo passo sarebbe strumentare i tempi per fase, oppure leggere i log di Vercel
- Decisione di prodotto da prendere: se il parse JSON della FASE A fallisce, oggi il giudice risponde senza fonti avvisando l'utente. L'alternativa è restituire un errore. Il log c'è già, la decisione no
- **Estendere la pesatura per rarità al punteggio dei blocchi.** Oggi `pesoDiRarita` è usata SOLO per il voto del Glossario, dove è nuova e isolata. Il punteggio dei blocchi resta binario (+1 per parola chiave), quindi `Land` ed `Enchantment` — iniettate in automatico dalla riga del tipo Scryfall in `route.ts` — pesano quanto `deathtouch`. È la leva più profonda rimasta, ma tocca il cuore di una funzione tarata su molti casi misurati: va fatta misurando `npm run prova-ricerca` a ogni passo, mai a intuito
- Osservato e non risolto: in una prova a 3 turni il giudice ha dato la conclusione giusta sull'abilità del terzo capitolo di Urza's Saga appoggiandosi a «la pila si risolve in modo indipendente dai permanenti» invece di citare la 113.7a — che **era** fra gli estratti (verificato nei log). Non è una lacuna di recupero ma variabilità del modello nel citare la fonte che ha davanti; se ricapita, il posto in cui intervenire è il prompt della FASE D, non `lib/rules.ts`
- Semplificazioni individuate e non applicate: eliminare `normalizza()` in `lib/rules.ts` (è solo `toLowerCase()`, e `iniziaUnaParolaDi` normalizza già al proprio interno), estrarre il parsing della FASE A e la validazione dell'immagine da `route.ts` in funzioni dedicate, togliere le tre riassegnazioni morte nel `catch` della FASE A (le variabili sono già inizializzate e da `JSON.parse` non esiste un percorso di assegnazione parziale)
- Le note di lavoro personali (fra cui `REVISIONE.md`) sono in `note-di-lavoro/`, cartella esclusa da git

## Note di stile per chi genera codice su questo progetto
- Tutti i commenti, nomi di variabili/funzioni e messaggi rivolti all'utente sono in ITALIANO
- Il codice inglese va bene solo per keyword/parole chiave tecniche interne (termini di ricerca inviati a Scryfall/regole)
- Niente omissioni di codice ("// resto invariato") — sempre file completi quando si modifica qualcosa
- Testare sempre con npm run dev + Invoke-RestMethod (PowerShell) prima di considerare una modifica conclusa
