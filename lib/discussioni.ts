// Ricerca nelle discussioni della community (Board Games Stack Exchange, tag magic-the-gathering).
//
// Perché esiste: il giudice riceve estratti di regolamento e deve DEDURRE l'interazione da zero,
// mentre una ricerca su Google porta spesso una discussione in cui un umano ha GIÀ ragionato su
// quella esatta interazione — ed è più facile leggere una spiegazione già scritta che ricostruirla.
// Le risposte più votate citano di solito i numeri di regola delle CR, quindi sono verificabili
// contro gli estratti che il giudice ha già.
//
// ATTENZIONE: questa NON è una fonte ufficiale. È materiale scritto dalla community, che può essere
// sbagliato o superato. Serve come aiuto al ragionamento, non come autorità da citare: nella
// gerarchia delle fonti va sotto CR, MTR e testo Oracle. Ogni risposta porta con sé i voti e la data
// dell'ultima modifica proprio perché chi la usa possa pesarla, come già si fa con i rulings di
// Scryfall (che riportano la propria data).
//
// I contenuti di Stack Exchange sono sotto licenza CC BY-SA: se finiscono davanti all'utente, va
// mostrato il link della discussione per attribuzione. Per questo `link` è sempre valorizzato.
//
// Questo modulo NON fa logging al proprio interno di proposito: usa solo import relativi e nessun
// alias "@/", così `scripts/prova-copertura.mjs` può importarlo direttamente con Node (che stripa i
// tipi da solo) senza compilazione né dipendenze nuove. Chi lo chiama stampa o logga i risultati.

// Filtro creato una volta tramite /2.3/filters/create e poi fissato qui: include già il corpo delle
// risposte dentro la risposta della ricerca, quindi UNA sola chiamata basta per avere domanda e
// risposta (senza filtro servirebbe una seconda chiamata a /answers/{id} per ogni discussione).
const FILTRO_CON_RISPOSTE = "!6WPIomnDXnWHe";

const SITO = "boardgames";
const TAG = "magic-the-gathering";

// Le API pubbliche vanno interrogate con calma: Stack Exchange impone un tetto di 30 richieste al
// secondo, e può chiedere esplicitamente una pausa col campo `backoff`. Stessa attenzione già usata
// con l'API di Scryfall in lib/scryfall.ts.
const PAUSA_MINIMA_MS = 150;

// Oltre le prime carte la query si restringe troppo e non trova più nulla: le carte che contano per
// l'interazione sono quasi sempre le prime nominate.
const MASSIMO_CARTE_NELLA_QUERY = 3;

// Poche parole chiave, non tante: il parametro `q` di Stack Exchange è un AND fra i termini, quindi
// più parole restringono invece di allargare. Misurato con chiamate reali: "saga lore counter" (due
// parole) trova sei discussioni pertinenti, "saga lore counter chapter ability sacrifice" (quattro)
// non ne trova nessuna.
const MASSIMO_PAROLE_CHIAVE_NELLA_QUERY = 2;

export interface RispostaCommunity {
  voti: number;
  accettata: boolean;
  // Data dell'ultima modifica in formato ISO (solo la parte della data), oppure null se la risposta
  // non è mai stata modificata dopo la pubblicazione.
  ultimaModifica: string | null;
  testo: string;
  // Numeri di regola CR citati nel testo (es. "714.4", "305.7"): sono il gancio che permette di
  // incrociare la spiegazione della community con gli estratti ufficiali già in mano al giudice.
  regoleCitate: string[];
}

export interface DiscussioneCommunity {
  titolo: string;
  link: string;
  votiDomanda: number;
  miglioreRisposta: RispostaCommunity | null;
}

export interface EsitoRicercaDiscussioni {
  query: string;
  discussioni: DiscussioneCommunity[];
  // Richieste ancora disponibili nella quota giornaliera dichiarata dall'API (300 al giorno senza
  // chiave), oppure null se la risposta non l'ha riportata.
  quotaRimanente: number | null;
}

const cacheDiscussioni = new Map<string, EsitoRicercaDiscussioni>();

// Momento prima del quale non si deve chiamare di nuovo l'API, aggiornato quando la risposta chiede
// esplicitamente una pausa con `backoff`.
let attesaFinoA = 0;

function attendi(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Costruisce i tentativi di ricerca in ordine, dal più mirato al più generico, da provare finché uno
// non restituisce qualcosa. È la stessa strategia a cascata già usata per Scryfall in
// lib/scryfall.ts (nome esatto → autocomplete → ricerca testuale).
//
// L'ordine non è arbitrario, è stato misurato con chiamate reali all'API:
//   - DUE O PIÙ nomi di carta sono il segnale più forte, perché in quel caso l'interazione È la
//     coppia di carte: "Urza's Saga Blood Moon" centra al primo colpo la discussione giusta.
//   - Con UNA SOLA carta l'interazione sta invece nel meccanismo, non nella carta, quindi conviene
//     cercare per parole chiave: la domanda "Lightning Bolt su una creatura con deathtouch" si
//     risolve con "deathtouch lethal damage", mentre la sola "Lightning Bolt" riportava la
//     discussione più votata che nomina quella carta (una sulla priorità) — 8000 caratteri
//     completamente fuori tema.
//   - Mischiare carta e parole chiave NON funziona: essendo `q` un AND, "Lightning Bolt deathtouch"
//     non trova niente. Per questo i due criteri restano tentativi separati e non un'unica query.
export function costruisciTentativiQuery(nomiCarte: string[], paroleChiave: string[]): string[] {
  const carte = nomiCarte.filter((nome) => nome.trim() !== "").slice(0, MASSIMO_CARTE_NELLA_QUERY);
  const parole = paroleChiave
    .filter((parola) => parola.trim() !== "")
    .slice(0, MASSIMO_PAROLE_CHIAVE_NELLA_QUERY);

  const tentativi: string[] = [];

  if (carte.length >= 2) {
    tentativi.push(carte.join(" "));
  }
  if (parole.length > 0) {
    tentativi.push(parole.join(" "));
  }
  // Una sola carta, senza parole chiave utili: ultima risorsa, con il rischio di risultati
  // fuori tema descritto sopra. Chi usa il risultato deve pesarlo (una risposta di regolamento
  // vera cita quasi sempre dei numeri di regola: `regoleCitate` vuoto è un campanello d'allarme).
  if (carte.length === 1) {
    tentativi.push(carte[0]);
  }

  return [...new Set(tentativi)];
}

// Le risposte dell'API arrivano in HTML con entità già codificate (&#39;, &amp;, ...). Qui non
// serve un parser: il testo va solo reso leggibile per essere infilato in un prompt o stampato.
function ripulisciHtml(html: string): string {
  const senzaTag = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  return senzaTag
    .replace(/&#(\d+);/g, (_, codice) => String.fromCharCode(Number(codice)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // &amp; per ultimo, altrimenti una sequenza come &amp;lt; verrebbe decodificata due volte.
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function estraiRegoleCitate(testo: string): string[] {
  const trovate = testo.match(/\b\d{3}\.\d+[a-z]?\b/g) ?? [];
  return [...new Set(trovate)];
}

function dataDaTimestamp(timestamp: unknown): string | null {
  if (typeof timestamp !== "number") {
    return null;
  }
  // Stack Exchange usa timestamp Unix in SECONDI, non in millisecondi come JavaScript.
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

interface RispostaApi {
  body?: string;
  score?: number;
  is_accepted?: boolean;
  last_edit_date?: number;
}

interface DomandaApi {
  title?: string;
  link?: string;
  score?: number;
  answers?: RispostaApi[];
}

// Fra le risposte di una discussione conta quella accettata; a pari merito (o se nessuna è
// accettata) quella con più voti. È lo stesso criterio con cui un umano legge un thread.
function scegliMiglioreRisposta(risposte: RispostaApi[]): RispostaCommunity | null {
  if (risposte.length === 0) {
    return null;
  }

  const ordinate = [...risposte].sort((prima, seconda) => {
    if (prima.is_accepted !== seconda.is_accepted) {
      return prima.is_accepted ? -1 : 1;
    }
    return (seconda.score ?? 0) - (prima.score ?? 0);
  });

  const migliore = ordinate[0];
  const testo = ripulisciHtml(migliore.body ?? "");

  return {
    voti: migliore.score ?? 0,
    accettata: migliore.is_accepted === true,
    ultimaModifica: dataDaTimestamp(migliore.last_edit_date),
    testo,
    regoleCitate: estraiRegoleCitate(testo),
  };
}

async function interrogaApi(query: string): Promise<EsitoRicercaDiscussioni> {
  const esitoVuoto: EsitoRicercaDiscussioni = { query, discussioni: [], quotaRimanente: null };

  const inCache = cacheDiscussioni.get(query);
  if (inCache) {
    return inCache;
  }

  const parametri = new URLSearchParams({
    order: "desc",
    // Ordinare per pertinenza e non per voti: con una query generica, `votes` restituisce la
    // discussione più votata che contiene quei termini, non quella che risponde alla domanda.
    sort: "relevance",
    q: query,
    tagged: TAG,
    site: SITO,
    filter: FILTRO_CON_RISPOSTE,
  });
  const url = `https://api.stackexchange.com/2.3/search/advanced?${parametri.toString()}`;

  try {
    const attesaResidua = attesaFinoA - Date.now();
    await attendi(attesaResidua > 0 ? attesaResidua : PAUSA_MINIMA_MS);

    const risposta = await fetch(url, { headers: { Accept: "application/json" } });
    if (!risposta.ok) {
      console.error(
        `Ricerca discussioni: l'API ha risposto ${risposta.status} per la query "${query}"`
      );
      return esitoVuoto;
    }

    const dati = await risposta.json();

    // L'API segnala i propri errori dentro un 200 con error_id/error_message.
    if (dati.error_id) {
      console.error(`Ricerca discussioni: errore API ${dati.error_id} — ${dati.error_message}`);
      return esitoVuoto;
    }

    if (typeof dati.backoff === "number") {
      attesaFinoA = Date.now() + dati.backoff * 1000;
    }

    const domande: DomandaApi[] = Array.isArray(dati.items) ? dati.items : [];
    const esito: EsitoRicercaDiscussioni = {
      query,
      quotaRimanente: typeof dati.quota_remaining === "number" ? dati.quota_remaining : null,
      discussioni: domande.map((domanda) => ({
        titolo: ripulisciHtml(domanda.title ?? ""),
        link: domanda.link ?? "",
        votiDomanda: domanda.score ?? 0,
        miglioreRisposta: scegliMiglioreRisposta(Array.isArray(domanda.answers) ? domanda.answers : []),
      })),
    };

    cacheDiscussioni.set(query, esito);
    return esito;
  } catch (errore) {
    // Una fonte non ufficiale che non risponde non deve mai far fallire una richiesta: si procede
    // senza di essa, esattamente come cercaDatiCarta() restituisce null quando Scryfall non aiuta.
    console.error(`Ricerca discussioni: errore imprevisto per la query "${query}":`, errore);
    return esitoVuoto;
  }
}

export async function cercaDiscussioniPertinenti(
  nomiCarte: string[],
  paroleChiave: string[]
): Promise<EsitoRicercaDiscussioni> {
  const tentativi = costruisciTentativiQuery(nomiCarte, paroleChiave);

  if (tentativi.length === 0) {
    return { query: "", discussioni: [], quotaRimanente: null };
  }

  let ultimoEsito: EsitoRicercaDiscussioni = {
    query: tentativi[tentativi.length - 1],
    discussioni: [],
    quotaRimanente: null,
  };

  for (const tentativo of tentativi) {
    const esito = await interrogaApi(tentativo);
    if (esito.discussioni.length > 0) {
      return esito;
    }
    // Si tiene l'ultimo esito anche quando è vuoto, così chi chiama vede comunque la quota
    // rimanente e quale query è stata provata per ultima.
    ultimoEsito = esito;
  }

  return ultimoEsito;
}
