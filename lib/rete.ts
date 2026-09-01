// Come l'app reagisce quando una chiamata verso un servizio esterno non riesce: che tipo di guasto
// è, se ha senso riprovare, e cosa dire all'utente.
//
// Il caso che ha motivato questo file non è ipotetico. Il piano gratuito di Gemini consente 15
// richieste al MINUTO per modello — misurato dal vivo, l'errore 429 riporta
// `GenerateRequestsPerMinutePerProjectPerModel-FreeTier, limit: 15` — e ogni domanda dell'utente ne
// consuma 2 o 3 fra FASE A, FASE D ed eventuale FASE E. Bastano quindi cinque o sei domande
// ravvicinate, o due persone che usano l'app nello stesso minuto, perché Gemini risponda 429.
// Fino a qui quell'errore risaliva fino al catch generale di /api/judge, che rispondeva 500 con
// «Si è verificato un errore durante l'elaborazione della domanda»: all'utente non veniva detto né
// che bastava aspettare un minuto, né che la colpa non era della sua domanda. La stessa lezione era
// già stata imparata e applicata in `scripts/sonda-coerenza.mjs`, che mette una pausa fra una
// richiesta e l'altra e riprova una volta — ma solo lì, cioè in uno strumento di misura, e non
// dove la vedono le persone.
//
// Il file non ha import di proposito, così `scripts/prova-rete.mjs` può importarlo davvero invece
// di riscriverne una copia: stessa ragione già valida per `lib/estrazione.ts` e `lib/verifica.ts`,
// e stesso divieto di usare l'alias `@/`, che Node non risolve.

// Sei esiti, non due. La distinzione non è accademica: decide sia se riprovare sia cosa dire, e
// confonderli significa dare all'utente un consiglio sbagliato.
//   quota        — 429: il tetto di richieste è stato superato. Aspettare funziona.
//   sovraccarico — 5xx: il guasto è dalla parte di Google. Riprovare subito spesso funziona.
//   timeout      — la risposta non è arrivata entro il tempo che le avevamo dato.
//   rete         — la richiesta non è nemmeno partita (DNS, connessione caduta).
//   definitivo   — 4xx diverso da 429: chiave sbagliata, richiesta malformata. Riprovare è inutile.
//   sconosciuto  — nessuno dei precedenti. Non si riprova: meglio non insistere alla cieca.
export type TipoGuasto =
  | "quota"
  | "sovraccarico"
  | "timeout"
  | "rete"
  | "definitivo"
  | "sconosciuto";

// Quanto siamo disposti ad aspettare prima di riprovare. Non è prudenza generica: una domanda
// costa già 20-30 secondi (la FASE E da sola ne vale 15-21), e la funzione su Vercel ha un tetto
// di durata oltre il quale viene interrotta. Aspettare mezzo minuto dentro la richiesta significa
// quindi rischiare di perdere ANCHE il lavoro già fatto, per poi non avere nemmeno la certezza che
// la seconda chiamata vada meglio. Sopra questa soglia si smette e si dice all'utente quanto
// aspettare: è un'informazione che lui può usare, un'attesa muta no.
export const MASSIMA_ATTESA_RIPROVA_MS = 6000;

// La pausa da usare quando il guasto è transitorio ma Google non ha suggerito nessun tempo (5xx,
// rete caduta). Abbastanza per lasciar passare un singolo intoppo, abbastanza poco da non pesare
// sulla durata complessiva.
export const ATTESA_PREDEFINITA_MS = 1500;

// Si riprova UNA volta sola, non tre. La chiamata che fallisce è la parte cara della richiesta:
// ogni tentativo in più consuma quota gratuita e tempo della funzione, e i guasti che si risolvono
// da soli si risolvono al primo colpo. Se non basta un secondo tentativo, il problema non è un
// intoppo passeggero e va detto all'utente invece che nascosto sotto un'attesa più lunga.
export const RIPROVE_MASSIME = 1;

function attesaReale(ms: number): Promise<void> {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

// Lo stato HTTP, se l'errore ne porta uno. `GoogleGenerativeAIFetchError` espone `status` come
// numero; gli altri errori della libreria non ce l'hanno affatto, ed è proprio quella assenza a
// distinguere «il server ha risposto male» da «non siamo riusciti a parlargli».
function statoHttpDellErrore(errore: unknown): number | null {
  if (errore === null || typeof errore !== "object") {
    return null;
  }
  const stato = (errore as { status?: unknown }).status;
  return typeof stato === "number" ? stato : null;
}

function testoDellErrore(errore: unknown): string {
  if (errore === null || errore === undefined) {
    return "";
  }
  if (errore instanceof Error) {
    return `${errore.name}: ${errore.message}`;
  }
  return String(errore);
}

export function classificaErroreGemini(errore: unknown): TipoGuasto {
  const stato = statoHttpDellErrore(errore);
  if (stato === 429) {
    return "quota";
  }
  if (stato !== null && stato >= 500) {
    return "sovraccarico";
  }
  if (stato !== null) {
    // 400, 403, 404: la richiesta o la chiave sono sbagliate. Riprovare rifarebbe lo stesso errore.
    return "definitivo";
  }

  const testo = testoDellErrore(errore);

  // Attenzione: NON si può riconoscere l'annullamento dal `name` dell'errore. Le classi di errore
  // della libreria (`GoogleGenerativeAIAbortError` e sorelle) non impostano `this.name`, quindi
  // valgono tutte "Error" — verificato leggendo node_modules/@google/generative-ai/dist/index.mjs.
  // L'unico segnale affidabile è la frase che la libreria scrive nel messaggio. `TimeoutError` e
  // `AbortError` coprono invece il nostro `AbortSignal.timeout()` su Scryfall, che è un
  // DOMException e il `name` ce l'ha davvero.
  if (
    testo.includes("Request aborted when fetching") ||
    testo.includes("TimeoutError") ||
    testo.includes("AbortError") ||
    testo.includes("The operation was aborted")
  ) {
    return "timeout";
  }

  if (
    testo.includes("Error fetching from") ||
    testo.includes("fetch failed") ||
    testo.includes("ENOTFOUND") ||
    testo.includes("ECONNRESET") ||
    testo.includes("ECONNREFUSED")
  ) {
    return "rete";
  }

  return "sconosciuto";
}

// Quanti millisecondi Google chiede di aspettare, se lo dice. Nelle risposte 429 il corpo contiene
// un blocco `RetryInfo` con un campo `retryDelay` scritto come "27s": la libreria lo espone in
// `errorDetails` e lo ricopia anche in coda al messaggio, quindi si guardano entrambi i posti.
// Restituisce null quando il suggerimento non c'è: sta al chiamante decidere quanto aspettare.
export function attesaSuggeritaDaGemini(errore: unknown): number | null {
  const daiDettagli = attesaDaiDettagli(errore);
  if (daiDettagli !== null) {
    return daiDettagli;
  }
  return attesaDalTesto(testoDellErrore(errore));
}

function attesaDaiDettagli(errore: unknown): number | null {
  if (errore === null || typeof errore !== "object") {
    return null;
  }
  const dettagli = (errore as { errorDetails?: unknown }).errorDetails;
  if (!Array.isArray(dettagli)) {
    return null;
  }
  for (const dettaglio of dettagli) {
    if (dettaglio === null || typeof dettaglio !== "object") {
      continue;
    }
    const ritardo = (dettaglio as { retryDelay?: unknown }).retryDelay;
    if (typeof ritardo === "string") {
      const millisecondi = secondiInMillisecondi(ritardo);
      if (millisecondi !== null) {
        return millisecondi;
      }
    }
  }
  return null;
}

function attesaDalTesto(testo: string): number | null {
  const riscontro = testo.match(/"?retryDelay"?\s*:?\s*"?(\d+(?:\.\d+)?)s/i) ?? testo.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return riscontro ? secondiInMillisecondi(riscontro[1]) : null;
}

function secondiInMillisecondi(valore: string): number | null {
  const numero = Number.parseFloat(valore.replace(/s$/i, ""));
  return Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 1000) : null;
}

// Quanto aspettare prima di riprovare, oppure null se riprovare non ha senso. Null significa
// «smetti e riferisci», e vale in tre casi diversi che è importante non confondere: il guasto è
// definitivo, oppure abbiamo già speso il nostro tempo di attesa (timeout), oppure Google chiede
// più tempo di quanto siamo disposti a passare fermi.
export function attesaPrimaDiRiprovare(errore: unknown): number | null {
  const tipo = classificaErroreGemini(errore);

  if (tipo === "definitivo" || tipo === "sconosciuto") {
    return null;
  }

  // Un timeout non si riprova: il tempo l'abbiamo già dato, e rifare la stessa chiamata
  // raddoppierebbe l'attesa dell'utente per poi con ogni probabilità scadere di nuovo.
  if (tipo === "timeout") {
    return null;
  }

  if (tipo === "quota") {
    const suggerita = attesaSuggeritaDaGemini(errore);
    // Nessun suggerimento su un 429 vuol dire quasi sempre che è finita la quota GIORNALIERA, non
    // quella al minuto: lì aspettare qualche secondo non serve a niente.
    if (suggerita === null || suggerita > MASSIMA_ATTESA_RIPROVA_MS) {
      return null;
    }
    return suggerita;
  }

  // sovraccarico e rete: Google raramente suggerisce un tempo, quindi si usa la pausa predefinita
  // (o la sua, se per una volta c'è ed è breve).
  const suggerita = attesaSuggeritaDaGemini(errore);
  if (suggerita !== null && suggerita <= MASSIMA_ATTESA_RIPROVA_MS) {
    return suggerita;
  }
  return ATTESA_PREDEFINITA_MS;
}

type OpzioniRiprova = {
  // Iniettabili perché scripts/prova-rete.mjs possa provare la logica delle riprove senza aspettare
  // davvero e senza sporcare l'uscita: una prova che dorme sei secondi non la lancia più nessuno.
  attendi?: (ms: number) => Promise<void>;
  registraAvviso?: (messaggio: string) => void;
};

// Esegue `operazione` e, se fallisce per un guasto passeggero, la rifà UNA volta dopo una pausa.
// Se anche il secondo tentativo fallisce, l'errore risale al chiamante così com'è: chi sta sopra
// deve poterlo classificare a sua volta per scegliere cosa rispondere all'utente.
export async function eseguiConRiprova<T>(
  operazione: () => Promise<T>,
  etichetta: string,
  opzioni: OpzioniRiprova = {}
): Promise<T> {
  const attendi = opzioni.attendi ?? attesaReale;
  const registraAvviso = opzioni.registraAvviso ?? ((messaggio: string) => console.warn(messaggio));

  let riprovateFatte = 0;

  for (;;) {
    try {
      return await operazione();
    } catch (errore) {
      const tipo = classificaErroreGemini(errore);
      const attesa = riprovateFatte < RIPROVE_MASSIME ? attesaPrimaDiRiprovare(errore) : null;

      if (attesa === null) {
        // L'avviso serve anche quando NON si riprova: senza, un guasto di quota resterebbe
        // indistinguibile nei log da un errore di programmazione, ed è la diagnosi che conta di più
        // per capire se l'app sta fallendo per colpa propria o per i limiti del piano gratuito.
        registraAvviso(
          `[RETE] ${etichetta}: guasto di tipo "${tipo}" dopo ${riprovateFatte} riprove, non si insiste. ${testoDellErrore(errore)}`
        );
        throw errore;
      }

      riprovateFatte++;
      registraAvviso(
        `[RETE] ${etichetta}: guasto di tipo "${tipo}", riprovo fra ${attesa} ms (tentativo ${riprovateFatte} di ${RIPROVE_MASSIME}).`
      );
      await attendi(attesa);
    }
  }
}

// Il messaggio mostrato all'utente e il codice HTTP con cui rispondergli. Stanno insieme perché
// sono due facce della stessa decisione, e separarli è il modo tipico di ritrovarsi con un 500 che
// dice «riprova fra un minuto» o con un 429 che dà la colpa alla domanda.
//
// Il tono segue quello già usato nel resto dell'app: dire cosa è successo e cosa può fare l'utente,
// senza gergo tecnico e senza dare la colpa a lui.
export function rispostaPerGuasto(tipo: TipoGuasto): { messaggio: string; codiceHttp: number } {
  if (tipo === "quota") {
    return {
      messaggio:
        "Il servizio di intelligenza artificiale ha ricevuto troppe richieste in poco tempo. Non c'è niente di sbagliato nella tua domanda: aspetta un minuto e rimandala.",
      codiceHttp: 429,
    };
  }
  if (tipo === "sovraccarico") {
    return {
      messaggio:
        "Il servizio di intelligenza artificiale è momentaneamente sovraccarico. Riprova fra qualche istante.",
      codiceHttp: 503,
    };
  }
  if (tipo === "timeout") {
    return {
      messaggio: "Il giudice ci ha messo troppo tempo a rispondere. Riprova fra qualche istante.",
      codiceHttp: 504,
    };
  }
  if (tipo === "rete") {
    return {
      messaggio:
        "Non sono riuscito a contattare il servizio di intelligenza artificiale. Riprova fra qualche istante.",
      codiceHttp: 502,
    };
  }
  // "definitivo" e "sconosciuto": è un problema nostro, non qualcosa che l'utente possa risolvere
  // aspettando. Meglio il messaggio generico di un consiglio falso.
  return {
    messaggio: "Si è verificato un errore durante l'elaborazione della domanda.",
    codiceHttp: 500,
  };
}
