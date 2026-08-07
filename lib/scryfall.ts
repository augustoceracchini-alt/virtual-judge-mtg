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

async function cercaCartaFuzzy(nomeCarta: string) {
  const urlRicerca = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(nomeCarta)}`;
  const rispostaCarta = await fetch(urlRicerca, { headers: INTESTAZIONI });
  logDebug(`[DEBUG Scryfall] Tentativo fuzzy per '${nomeCarta}': status =`, rispostaCarta.status);

  if (!rispostaCarta.ok) {
    return null;
  }

  return rispostaCarta.json();
}

async function cercaCartaAutocomplete(nomeCarta: string) {
  const urlAutocomplete = `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(nomeCarta)}`;
  const rispostaAutocomplete = await fetch(urlAutocomplete, { headers: INTESTAZIONI });
  logDebug(`[DEBUG Scryfall] Tentativo autocomplete per '${nomeCarta}': status =`, rispostaAutocomplete.status);

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

  if (!rispostaEsatta.ok) {
    return null;
  }

  return rispostaEsatta.json();
}

async function cercaCartaTestuale(nomeCarta: string) {
  const urlSearch = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(nomeCarta)}&order=relevance`;
  const rispostaSearch = await fetch(urlSearch, { headers: INTESTAZIONI });
  logDebug(`[DEBUG Scryfall] Tentativo search testuale per '${nomeCarta}': status =`, rispostaSearch.status);

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

export async function cercaDatiCarta(nomeCarta: string): Promise<DatiCarta | null> {
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
      return null;
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
      nome: carta.name,
      tipoLinea: carta.type_line || "",
      testoOracle,
      rulings,
      legalita: formattaLegalita(carta.legalities),
    };
  } catch (errore) {
    console.error(`Errore imprevisto durante la ricerca Scryfall di "${nomeCarta}":`, errore);
    return null;
  }
}
