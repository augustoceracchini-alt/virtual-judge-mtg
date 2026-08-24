# Virtual Judge MTG

Arbitro virtuale per **Magic: The Gathering**. Si fa una domanda in italiano (o si allega una foto
del tavolo) e si riceve un verdetto costruito sulle fonti ufficiali reali, non sulla memoria del
modello di intelligenza artificiale.

Non è un giudice certificato Wizards/DCI: è uno strumento di supporto, e lo dichiara.

**In produzione:** https://virtual-judge-mtg.vercel.app

## Come funziona

Ogni domanda passa attraverso cinque fasi. Il motivo di questa struttura è che inviare l'intero
regolamento all'IA a ogni domanda esaurirebbe la quota gratuita in poche richieste.

| Fase | Cosa fa | Costo |
|------|---------|-------|
| A | L'IA estrae parole chiave, carte citate e numeri di regola dalla conversazione | 1 chiamata |
| B | Scryfall fornisce testo Oracle, rulings e legalità delle carte citate | gratis |
| C | Ricerca locale nei due regolamenti ufficiali | gratis, zero token |
| D | L'IA scrive il verdetto usando **solo** gli estratti trovati | 1 chiamata |
| E | Se la regola è condizionale, un secondo passaggio ricontrolla la conclusione | 1 chiamata, solo se serve |

### Gerarchia delle fonti

1. **Comprehensive Rules** — le meccaniche di gioco. Aggiornate a mano, quindi più affidabili di un
   ruling vecchio quando Wizards cambia una regola.
2. **Magic Tournament Rules** — le procedure di torneo (sideboard, deck check, tempi, penalità).
   Su queste materie prevale sulle Comprehensive Rules, come dichiara il documento stesso.
3. **Testo Oracle** della carta — cosa fa esattamente la carta.
4. **Rulings** di Scryfall — chiarimenti su interazioni specifiche. Ogni ruling porta la propria
   data: se è anteriore alla validità delle regole generali e le contraddice, prevalgono le regole.

## Comandi

```bash
npm run dev
```

Avvia il server di sviluppo su `http://localhost:3000`.

```bash
npm run build
```

Build di produzione. Da eseguire prima di pubblicare, per intercettare gli errori che altrimenti
comparirebbero solo online.

```bash
npm run lint
```

Controllo dello stile del codice.

## Aggiornare i regolamenti

Quando Wizards pubblica una nuova versione di un regolamento, va sostituito il file di partenza e
rigenerata la versione compatta che l'app legge a runtime.

**Comprehensive Rules** — scaricare il testo aggiornato da
[media.wizards.com](https://media.wizards.com/), salvarlo come `data/comprehensive-rules.txt`, poi:

```bash
node scripts/prepara-regole.mjs
```

**Magic Tournament Rules** — scaricare il PDF aggiornato da
[wpn.wizards.com/en/rules-documents](https://wpn.wizards.com/en/rules-documents), salvarlo come
`data/tournament-rules.pdf`, poi:

```bash
node scripts/prepara-regole-torneo.mjs
```

Entrambi gli script stampano quanti capitoli e blocchi hanno trovato e la data di validità rilevata,
e si interrompono con un errore se la struttura del documento non corrisponde a quella attesa —
utile perché Wizards a volte cambia impaginazione. In quel caso lo script va adattato prima di
usarne il risultato.

Dopo la rigenerazione, i file `data/*-compatte.json` vanno committati: sono quelli che l'app legge
in produzione.

## Correzioni manuali a rulings superati

Quando Wizards modifica una regola generale, i rulings già pubblicati per le carte specifiche
interessate non vengono aggiornati su Scryfall: restano scritti come se la regola vecchia fosse
ancora in vigore. Il modello, davanti a un ruling molto specifico che contraddice una regola
generale astratta, tende a fidarsi del primo anche quando le istruzioni gli chiedono il contrario.

Per i casi noti (il primo è Urza's Saga + Blood Moon, dopo la modifica della regola 714.4 del
2025), si aggiunge una voce a `data/errata-locali.json`:

```json
{ "carte": ["Nome Esatto Della Carta"], "nota": "Perché il ruling vecchio è superato e qual è la conclusione corretta oggi." }
```

La nota ha priorità assoluta nel prompt, sopra anche le Comprehensive Rules: deve affermare
direttamente la conclusione corretta, non solo segnalare il dubbio. Dopo averla aggiunta va anche
rifatto `npm run build`, per lo stesso motivo dei due file dati sopra.

## Segnalare una risposta sbagliata

Sotto ogni risposta del giudice c'è un pulsante di segnalazione: si sceglie il tipo di problema
(risposta sbagliata, incompleta, mancata, altro) e si può aggiungere un commento — la parte più
utile è scrivere quale sarebbe stata la risposta giusta e perché.

Serve a raccogliere **casi riproducibili**, non lamentele. Insieme alla segnalazione parte anche la
diagnostica di quella esecuzione: parole chiave estratte nella fase A, carte trovate su Scryfall,
capitoli di regolamento effettivamente arrivati al modello, se la fase E è scattata, eventuali
numeri di regola citati senza che comparissero fra le fonti. Senza quei dati una segnalazione
direbbe soltanto "ha sbagliato", mentre il difetto sta quasi sempre nel **recupero** delle regole —
e le parole chiave di quella esecuzione non sono ricostruibili a posteriori, perché la fase A ne
produce di diverse ogni volta. Con quei dati si distingue invece il capitolo decisivo che non è mai
arrivato (si interviene su `lib/rules.ts`) dal capitolo che c'era e che il modello ha applicato male
(si interviene sul prompt).

**Dove finiscono.** Sempre nei log del server, su una riga sola con il prefisso cercabile
`[SEGNALAZIONE]`. Se la variabile `GITHUB_TOKEN_SEGNALAZIONI` è configurata (vedi
"Configurazione"), viene aperta anche una issue sul repository, già contenente la riga pronta da
incollare fra i casi di prova della ricerca. Senza token l'endpoint funziona comunque e risponde
`{"salvata": true, "issue": null}`: GitHub è un di più, non una dipendenza, e una segnalazione già
registrata non diventa mai un errore per chi la invia solo perché GitHub è lento o irraggiungibile.

**Cosa viene inviato.** La domanda, la risposta del giudice, la conversazione di quello scambio e la
diagnostica. **Non** la foto eventualmente allegata: pesa, e per riprodurre il caso basta sapere che
c'era. Il repository è pubblico, quindi le issue sono visibili a chiunque — il modulo lo dichiara
apertamente prima dell'invio.

L'endpoint condivide il limite per IP di `/api/judge`, quindi una segnalazione consuma una richiesta
di quel limite: è la difesa contro chi volesse riempire le issue di spam.

## Configurazione

Serve un file `.env.local` nella cartella del progetto:

```
GEMINI_API_KEY=la-tua-chiave
```

Facoltativo, per vedere nel terminale i prompt inviati all'IA e gli estratti recuperati:

```
DEBUG_JUDGE=true
```

Facoltative, per far diventare le segnalazioni degli utenti delle issue sul repository invece di
sole righe nei log:

```
GITHUB_TOKEN_SEGNALAZIONI=token-github-con-permesso-sulle-issue
GITHUB_REPO_SEGNALAZIONI=utente/repository
```

Il token si crea da GitHub → *Settings* → *Developer settings* → *Personal access tokens* →
*Fine-grained tokens*, dando accesso al solo repository di questo progetto e il permesso
*Issues: Read and write*. La seconda variabile serve solo per puntare a un repository diverso da
quello predefinito (`augustoceracchini-alt/virtual-judge-mtg`).

Su Vercel queste variabili vanno inserite fra le variabili d'ambiente del progetto: il file
`.env.local` non viene pubblicato.

## Struttura

```
app/
  page.tsx              interfaccia a chat, foto del tavolo, pulsanti di chiarimento
  layout.tsx            font e metadati
  globals.css           palette, tipografia, sfondo
  components/           bolle dei messaggi, allegato foto, intestazione, segnalazione
  api/judge/route.ts    orchestrazione delle cinque fasi
  api/segnalazione/route.ts   raccolta delle segnalazioni degli utenti
lib/
  rules.ts              ricerca nei due regolamenti
  scryfall.ts           interrogazione dell'API Scryfall
  generazione.ts        modelli usati e impostazioni di generazione
data/
  comprehensive-rules.txt     testo ufficiale di partenza
  tournament-rules.pdf        PDF ufficiale di partenza
  regole-compatte.json        versione compatta generata (usata a runtime)
  mtr-compatte.json           versione compatta generata (usata a runtime)
scripts/
  prepara-regole.mjs          rigenera regole-compatte.json
  prepara-regole-torneo.mjs   rigenera mtr-compatte.json
```

I due file compatti vanno dichiarati in `next.config.ts` sotto `outputFileTracingIncludes`,
altrimenti Vercel non li include nel pacchetto e in produzione le ricerche restituiscono errore
pur funzionando in locale.

## Stack

Next.js 16 (App Router, nessuna cartella `src/`) · TypeScript · Tailwind CSS 4 ·
Google Gemini (`gemini-3.5-flash-lite`) · API pubblica Scryfall · hosting Vercel

## Limiti noti

Il ragionamento su regole condizionali a più clausole (per esempio le azioni basate sullo stato con
un confronto numerico) resta corretto in circa il 70-80% dei casi con il modello attualmente in uso,
anche con il doppio controllo della fase E. È il limite del livello di modello scelto per rientrare
nella quota gratuita: aggiungere altre istruzioni al prompt ha già mostrato rendimenti decrescenti.

Per i casi specifici in cui questo porta a un errore noto e documentato (un ruling di una carta
mai aggiornato dopo che Wizards ha cambiato la regola generale corrispondente), il file
`data/errata-locali.json` permette di correggere il singolo caso senza intervenire sul modello —
vedi "Correzioni manuali a rulings superati" sopra. Non generalizza a interazioni mai viste: copre
solo i casi annotati a mano.

Non esiste una suite di test automatici. La verifica si fa avviando `npm run dev` e interrogando
l'endpoint, come descritto in `CLAUDE.md`.

Limite di 20 richieste ogni 10 minuti per IP (`lib/limite.ts`), per evitare che una singola persona
esaurisca la quota Gemini condivisa da chiunque abbia il link. Il contatore vive in memoria del
processo: su Vercel free si azzera ai cold start e non è condiviso tra istanze parallele, quindi è
una protezione parziale, non assoluta.
