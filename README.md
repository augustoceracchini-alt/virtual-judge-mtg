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

## Configurazione

Serve un file `.env.local` nella cartella del progetto:

```
GEMINI_API_KEY=la-tua-chiave
```

Facoltativo, per vedere nel terminale i prompt inviati all'IA e gli estratti recuperati:

```
DEBUG_JUDGE=true
```

Su Vercel la chiave va inserita fra le variabili d'ambiente del progetto: il file `.env.local` non
viene pubblicato.

## Struttura

```
app/
  page.tsx              interfaccia a chat, foto del tavolo, pulsanti di chiarimento
  layout.tsx            font e metadati
  globals.css           palette, tipografia, sfondo
  api/judge/route.ts    orchestrazione delle cinque fasi
lib/
  rules.ts              ricerca nei due regolamenti
  scryfall.ts           interrogazione dell'API Scryfall
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
nella quota gratuita, non un difetto correggibile con altre istruzioni nel prompt.

Non esiste una suite di test automatici. La verifica si fa avviando `npm run dev` e interrogando
l'endpoint, come descritto in `CLAUDE.md`.

Non c'è limite di richieste per utente: la quota Gemini è condivisa da chiunque abbia il link.
