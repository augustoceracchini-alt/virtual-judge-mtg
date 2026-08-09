import { logDebug } from "@/lib/debug";

interface DatiCarta {
  nome: string;
  tipoLinea: string;
  testoOracle: string;
  rulings: string[];
  legalita: string;
}

// Formati principali da mostrare al giudice, nell'ordine in cui appaiono nella risposta.
// Scryfall ne restituisce molti altri (es. historic, alchemy, oldschool) ma per le domande
// tipiche di legalità questi sono quelli richiesti più spesso.
const FORMATI_PRINCIPALI: { chiave: string; nome: string }[] = [
  { chiave: "standard", nome: "Standard" },
  { chiave: "pioneer", nome: "Pioneer" },
  { chiave: "modern", nome: "Modern" },
  { chiave: "legacy", nome: "Legacy" },
  { chiave: "vintage", nome: "Vintage" },
  { chiave: "commander", nome: "Commander" },
  { chiave: "pauper", nome: "Pauper" },
];

const TESTO_STATO_LEGALE: Record<string, string> = {
  legal: "legale",
  not_legal: "non legale",
  banned: "bannata",
  restricted: "restricted (un solo esemplare consentito)",
};

function formattaLegalita(legalities: Record<string, string> | undefined): string {
  if (!legalities) {
    return "";
  }

  return FORMATI_PRINCIPALI.map(({ chiave, nome }) => {
    const stato = legalities[chiave];
    const statoLeggibile = stato ? TESTO_STATO_LEGALE[stato] || stato : "non disponibile";
    return `${nome}: ${statoLeggibile}`;
  }).join(" | ");
}

const INTESTAZIONI = {
  "User-Agent": "VirtualJudgeMTG/1.0",
  Accept: "application/json",
};

function attendi(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Un 404 di Scryfall significa "questa carta non c'è": è una risposta valida, e restituire null la
// comunica al chiamante. Qualsiasi ALTRO stato non-ok (429, 5xx) è invece un guasto temporaneo, e
// va distinto lanciando un errore: se lo trattassimo come "non trovata", la cache memorizzerebbe
// l'assenza e la carta resterebbe irrecuperabile per tutta la vita del processo.
function verificaRispostaScryfall(risposta: Response, descrizione: string): void {
  if (!risposta.ok && risposta.status !== 404) {
    throw new Error(`Scryfall ha risposto ${risposta.status} durante ${descrizione}`);
  }
}

async function cercaCartaFuzzy(nomeCarta: string) {
  const urlRicerca = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(nomeCarta)}`;
  const rispostaCarta = await fetch(urlRicerca, { headers: INTESTAZIONI });
  logDebug(`[DEBUG Scryfall] Tentativo fuzzy per '${nomeCarta}': status =`, rispostaCarta.status);

  verificaRispostaScryfall(rispostaCarta, `la ricerca fuzzy di "${nomeCarta}"`);
  if (!rispostaCarta.ok) {
    return null;
  }

  return rispostaCarta.json();
}

async function cercaCartaAutocomplete(nomeCarta: string) {
  const urlAutocomplete = `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(nomeCarta)}`;
  const rispostaAutocomplete = await fetch(urlAutocomplete, { headers: INTESTAZIONI });
  logDebug(`[DEBUG Scryfall] Tentativo autocomplete per '${nomeCarta}': status =`, rispostaAutocomplete.status);

  verificaRispostaScryfall(rispostaAutocomplete, `l'autocomplete di "${nomeCarta}"`);
  if (!rispostaAutocomplete.ok) {
    return null;
  }

  const datiAutocomplete = await rispostaAutocomplete.json();
  const suggerimenti: string[] = Array.isArray(datiAutocomplete.data) ? datiAutocomplete.data : [];
  logDebug("[DEBUG Scryfall] Suggerimenti autocomplete ricevuti:", JSON.stringify(suggerimenti));

  if (suggerimenti.length === 0) {
    return null;
  }

  const primoSuggerimento = suggerimenti[0];
  const urlEsatta = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(primoSuggerimento)}`;
  const rispostaEsatta = await fetch(urlEsatta, { headers: INTESTAZIONI });
  logDebug(
    `[DEBUG Scryfall] Ricerca esatta sul primo suggerimento autocomplete '${primoSuggerimento}': status =`,
    rispostaEsatta.status
  );

  verificaRispostaScryfall(rispostaEsatta, `la ricerca esatta di "${primoSuggerimento}"`);
  if (!rispostaEsatta.ok) {
    return null;
  }

  return rispostaEsatta.json();
}

async function cercaCartaTestuale(nomeCarta: string) {
  const urlSearch = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(nomeCarta)}&order=relevance`;
  const rispostaSearch = await fetch(urlSearch, { headers: INTESTAZIONI });
  logDebug(`[DEBUG Scryfall] Tentativo search testuale per '${nomeCarta}': status =`, rispostaSearch.status);

  verificaRispostaScryfall(rispostaSearch, `la ricerca testuale di "${nomeCarta}"`);
  if (!rispostaSearch.ok) {
    return null;
  }

  const datiSearch = await rispostaSearch.json();
  if (!Array.isArray(datiSearch.data) || datiSearch.data.length === 0) {
    logDebug("[DEBUG Scryfall] Search testuale non ha restituito risultati per:", nomeCarta);
    return null;
  }

  const carta = datiSearch.data[0];

  // La ricerca full-text di Scryfall (usata solo come ultima risorsa, dopo fuzzy e
  // autocomplete) non cerca solo nel nome: può restituire una carta il cui unico nesso
  // con "nomeCarta" è una parola nel testo Oracle o nel tipo. Prima di accettarla,
  // verifichiamo quindi che il nome trovato assomigli davvero al nome cercato.
  const normalizzaNome = (testo: string) => testo.toLocaleLowerCase().trim().replace(/\s+/g, " ");
  const nomeCercatoNormalizzato = normalizzaNome(nomeCarta);
  const nomeTrovatoNormalizzato = normalizzaNome(carta.name || "");

  // Controllo "ragionevolmente rigoroso" ma non esatto: accettiamo se uno dei due nomi
  // normalizzati contiene l'altro (es. "Lotus" -> "Black Lotus" va bene, coprendo anche
  // varianti ufficiali o nomi parziali), ma scartiamo corrispondenze che non hanno nulla
  // in comune nel nome (es. "Forest" -> "Black Lotus").
  const nomiAssomigliano =
    nomeTrovatoNormalizzato.includes(nomeCercatoNormalizzato) ||
    nomeCercatoNormalizzato.includes(nomeTrovatoNormalizzato);

  if (!nomiAssomigliano) {
    logDebug(
      `[DEBUG Scryfall] Search testuale ha trovato '${carta.name}' ma il nome non assomiglia a '${nomeCarta}': scartata come falso positivo`
    );
    return null;
  }

  return carta;
}

// Cache condivisa da tutte le richieste che arrivano alla stessa istanza calda del processo (non
// solo entro una singola conversazione): i dati di una carta su Scryfall sono identici per
// chiunque la chieda, quindi evita di rifare la stessa catena di chiamate di rete già fatta in un
// turno precedente o da un'altra conversazione. Si azzera ai cold start, come già accettato per
// lib/limite.ts. Cachiamo anche gli esiti `null` (carta non trovata), per non ritentare a ogni
// turno una ricerca già fallita per un nome scritto male o inesistente. Nessun TTL né limite di
// dimensione: il set di carte Magic è finito (~30.000) e i dati Scryfall cambiano di rado.
const cacheCarte = new Map<string, DatiCarta | null>();

function chiaveCache(nomeCarta: string): string {
  return nomeCarta.trim().toLocaleLowerCase();
}

// Tre esiti, non due: "non trovata" e "ricerca fallita" portano entrambi a nessun dato, ma solo il
// primo è definitivo. Confonderli significherebbe memorizzare in cache l'esito di un guasto
// temporaneo di rete, rendendo quella carta introvabile fino al riavvio del processo.
type EsitoRicercaCarta =
  | { stato: "trovata"; dati: DatiCarta }
  | { stato: "non-trovata" }
  | { stato: "errore" };

export async function cercaDatiCarta(nomeCarta: string): Promise<DatiCarta | null> {
  const chiave = chiaveCache(nomeCarta);
  if (cacheCarte.has(chiave)) {
    logDebug("[DEBUG Scryfall] Carta già in cache, nessuna chiamata di rete:", nomeCarta);
    return cacheCarte.get(chiave)!;
  }

  const esito = await cercaDatiCartaSuScryfall(nomeCarta);

  if (esito.stato === "errore") {
    // Niente in cache: al prossimo turno si riprova, invece di trascinarsi dietro un guasto.
    return null;
  }

  const dati = esito.stato === "trovata" ? esito.dati : null;
  cacheCarte.set(chiave, dati);
  return dati;
}

async function cercaDatiCartaSuScryfall(nomeCarta: string): Promise<EsitoRicercaCarta> {
  logDebug("[DEBUG Scryfall] Cerco la carta:", nomeCarta);

  try {
    let carta = await cercaCartaFuzzy(nomeCarta);

    if (!carta) {
      await attendi(100);
      carta = await cercaCartaAutocomplete(nomeCarta);
    }

    if (!carta) {
      await attendi(100);
      carta = await cercaCartaTestuale(nomeCarta);
    }

    if (!carta) {
      logDebug("[DEBUG Scryfall] Nessuna strategia ha trovato la carta:", nomeCarta);
      return { stato: "non-trovata" };
    }

    let testoOracle: string = carta.oracle_text || "";
    if (!testoOracle && Array.isArray(carta.card_faces)) {
      testoOracle = carta.card_faces
        .map((faccia: { name: string; oracle_text?: string }) => `${faccia.name}: ${faccia.oracle_text || ""}`)
        .join("\n");
    }

    const rulings: string[] = [];
    if (carta.rulings_uri) {
      await attendi(100);
      const rispostaRulings = await fetch(carta.rulings_uri, {
        headers: INTESTAZIONI,
      });
      // Anche qui la distinzione conta: senza, un guasto momentaneo sui rulings farebbe memorizzare
      // per sempre una carta con l'elenco dei rulings vuoto, che è peggio di riprovare più tardi.
      verificaRispostaScryfall(rispostaRulings, `il recupero dei rulings di "${carta.name}"`);
      if (rispostaRulings.ok) {
        const datiRulings = await rispostaRulings.json();
        if (Array.isArray(datiRulings.data)) {
          for (const ruling of datiRulings.data) {
            rulings.push(`[${ruling.published_at}] ${ruling.comment}`);
          }
        }
      }
    }

    return {
      stato: "trovata",
      dati: {
        nome: carta.name,
        tipoLinea: carta.type_line || "",
        testoOracle,
        rulings,
        legalita: formattaLegalita(carta.legalities),
      },
    };
  } catch (errore) {
    console.error(`Errore imprevisto durante la ricerca Scryfall di "${nomeCarta}":`, errore);
    return { stato: "errore" };
  }
}
