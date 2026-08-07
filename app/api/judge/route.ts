import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
  cercaRegolePertinenti,
  cercaRegoleTorneo,
  getDataEfficaciaRegole,
  getDataEfficaciaRegoleTorneo,
} from "@/lib/rules";
import { cercaErrataPertinenti } from "@/lib/errata";
import { cercaDatiCarta } from "@/lib/scryfall";
import { costruisciPromptEstrazione, costruisciPromptSistema, costruisciPromptVerifica } from "@/lib/prompts";

const DEBUG_ATTIVO = process.env.DEBUG_JUDGE === "true";
function logDebug(...args: unknown[]) {
  if (DEBUG_ATTIVO) {
    console.log(...args);
  }
}

type MessaggioCronologia = {
  ruolo: "utente" | "giudice";
  testo: string;
};

// La cronologia arriva dal client insieme alla domanda, quindi non è affidabile: chiunque può
// costruire a mano la richiesta all'API. Va perciò validata e limitata come già si fa con la
// domanda, per due motivi. Il primo è il consumo di quota: la cronologia finisce dentro i prompt
// inviati a Gemini, e una cronologia arbitrariamente lunga gonfia ogni richiesta. Il secondo è la
// correttezza: senza controllo sulla forma, un elemento privo del campo di testo verrebbe
// interpolato nel prompt come "undefined", inquinando le istruzioni al modello.
const MASSIMO_CARATTERI_CRONOLOGIA = 16000;

function eMessaggioCronologiaValido(valore: unknown): valore is MessaggioCronologia {
  if (valore === null || typeof valore !== "object") {
    return false;
  }
  const messaggio = valore as Partial<MessaggioCronologia>;
  return (
    (messaggio.ruolo === "utente" || messaggio.ruolo === "giudice") &&
    typeof messaggio.testo === "string"
  );
}

function normalizzaCronologia(valore: unknown): MessaggioCronologia[] {
  if (!Array.isArray(valore)) {
    return [];
  }

  const messaggiValidi = valore.filter(eMessaggioCronologiaValido);

  // Scorre dal messaggio più recente al più vecchio e si ferma quando il tetto complessivo è
  // superato: il contesto che serve davvero al giudice è quello vicino all'ultima domanda, quindi
  // di una conversazione molto lunga è giusto scartare la parte iniziale e non quella finale.
  const messaggiSelezionati: MessaggioCronologia[] = [];
  let caratteriUsati = 0;
  for (let indice = messaggiValidi.length - 1; indice >= 0; indice--) {
    const messaggio = messaggiValidi[indice];
    if (caratteriUsati + messaggio.testo.length > MASSIMO_CARATTERI_CRONOLOGIA) {
      break;
    }
    caratteriUsati += messaggio.testo.length;
    messaggiSelezionati.unshift(messaggio);
  }

  return messaggiSelezionati;
}

// Indica se il testo delle regole citate contiene il tipo di regola condizionale a più
// clausole (spesso un'azione basata sullo stato con un confronto numerico) su cui il modello
// ha già mostrato di sbagliare più facilmente il ragionamento passo-passo (es. la regola 714.4
// sul sacrificio delle Saghe). Quando è così, la risposta viene fatta ricontrollare da un
// secondo passaggio dedicato (FASE E) prima di essere inviata all'utente.
function contieneRegolaCondizionaleComplessa(testoRegole: string): boolean {
  const indicatori = [
    "state-based action",
    "greater than or equal",
    "less than or equal",
    "equal to or greater",
    "equal to or less",
    // Copre anche "and it isn't": qualsiasi testo che contenga quella forma contiene già questa.
    " and it is",
    "if the number of",
  ];
  const testoNormalizzato = testoRegole.toLowerCase();
  return indicatori.some((indicatore) => testoNormalizzato.includes(indicatore));
}

function eRichiestaDiChiarimenti(risposta: string): boolean {
  return risposta.includes("===OPZIONI_CHIARIMENTO===") || risposta.includes("Ho bisogno di alcuni chiarimenti");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const domanda = body.domanda;
    const immagineBase64 = body.immagineBase64;
    const mimeTypeImmagine = body.mimeTypeImmagine;
    const cronologia: MessaggioCronologia[] = normalizzaCronologia(body.cronologia);

    if (typeof domanda === "string" && domanda.length > 2000) {
      return NextResponse.json(
        { errore: "La domanda è troppo lunga (massimo 2000 caratteri)." },
        { status: 400 }
      );
    }

    if (immagineBase64) {
      const mimeTipiConsentiti = ["image/png", "image/jpeg", "image/webp"];
      if (!mimeTipiConsentiti.includes(mimeTypeImmagine)) {
        return NextResponse.json(
          { errore: "Formato immagine non supportato. Usa PNG, JPEG o WEBP." },
          { status: 400 }
        );
      }

      // Una stringa base64 di lunghezza L rappresenta circa L*0.75 byte di dati originali,
      // quindi ~10.6 milioni di caratteri base64 corrispondono a circa 8MB di immagine.
      const LUNGHEZZA_MASSIMA_BASE64 = 10600000;
      const lunghezzaBase64 = typeof immagineBase64 === "string" ? immagineBase64.length : 0;
      if (lunghezzaBase64 > LUNGHEZZA_MASSIMA_BASE64) {
        return NextResponse.json(
          { errore: "Immagine troppo grande (massimo 8MB)." },
          { status: 400 }
        );
      }
    }

    if (!domanda || typeof domanda !== "string" || domanda.trim() === "") {
      return NextResponse.json(
        { errore: "La domanda non può essere vuota." },
        { status: 400 }
      );
    }

    const haImmagine =
      typeof immagineBase64 === "string" &&
      immagineBase64.trim() !== "" &&
      typeof mimeTypeImmagine === "string" &&
      mimeTypeImmagine.trim() !== "";

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { errore: "Chiave API di Gemini non configurata sul server." },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

    const testoCronologia = cronologia
      .map((messaggio) => `${messaggio.ruolo === "utente" ? "Utente" : "Giudice"}: ${messaggio.testo}`)
      .join("\n\n");

    // FASE A: estrai parole chiave, numeri di regola e nomi di carte citati in tutta la conversazione finora
    const promptEstrazione = costruisciPromptEstrazione(domanda, testoCronologia);

    const risultatoEstrazione = await model.generateContent(promptEstrazione);
    let testoEstrazione = risultatoEstrazione.response.text().trim();
    testoEstrazione = testoEstrazione.replace(/```json/g, "").replace(/```/g, "").trim();

    let keywords: string[] = [];
    let citedRules: string[] = [];
    let cardNames: string[] = [];
    try {
      const datiEstratti = JSON.parse(testoEstrazione);
      keywords = Array.isArray(datiEstratti.keywords) ? datiEstratti.keywords : [];
      citedRules = Array.isArray(datiEstratti.cited_rules) ? datiEstratti.cited_rules : [];
      cardNames = Array.isArray(datiEstratti.card_names) ? datiEstratti.card_names : [];
    } catch {
      keywords = [];
      citedRules = [];
      cardNames = [];
    }

    logDebug("[DEBUG] Nomi carte estratti dalla domanda:", JSON.stringify(cardNames));

    // Correzioni manuali a rulings superati: a differenza delle CR e dell'MTR non è un documento
    // ufficiale, ma una lista curata a mano per i casi noti in cui il ruling di una carta specifica
    // è superato da una modifica successiva delle Comprehensive Rules — il caso concreto che ha
    // motivato questa fonte è Urza's Saga, il cui unico ruling disponibile su Scryfall resta quello
    // del 2021, precedente alla modifica della regola 714.4 del 2025 che ne inverte la conclusione.
    // Basta il nome della carta, non serve aspettare i dati Scryfall della FASE B.
    const errataPertinenti = cercaErrataPertinenti(cardNames);

    logDebug("[DEBUG] Correzioni manuali pertinenti:", errataPertinenti || "(nessuna)");

    // FASE B: cerca i dati ufficiali delle carte menzionate su Scryfall (massimo 6 carte per richiesta, in sequenza).
    // Il limite non è più 3: con la cronologia multi-turno, card_names accumula tutte le carte
    // citate nell'intera conversazione (non solo nell'ultimo messaggio), quindi 3 tagliava
    // silenziosamente scenari con 4+ carte già in gioco dopo un paio di turni. 6 lascia margine
    // per la maggior parte delle situazioni di gioco reali senza appesantire troppo le richieste
    // parallele a Scryfall.
    // Viene eseguita PRIMA della ricerca nelle CR (FASE C) perché il type_line reale restituito
    // da Scryfall (es. "Enchantment Land — Urza's Saga") arricchisce le parole chiave di ricerca:
    // le keyword indovinate da Gemini in FASE A non sono sempre affidabili al 100% (in un test
    // reale hanno omesso "saga"/"chapter" per una domanda proprio su una carta Saga, facendo
    // sparire dal risultato il capitolo 714 delle CR, quello decisivo per la domanda).
    // Le carte vengono cercate una dopo l'altra e non tutte insieme. Ogni ricerca è una catena di
    // più chiamate a Scryfall (nome esatto, autocomplete, ricerca testuale, rulings) che al proprio
    // interno già rispetta una pausa fra una chiamata e la successiva: lanciando sei catene in
    // parallelo, però, quelle pause andavano perdute e si arrivava a sei richieste in contemporanea,
    // molto oltre il ritmo che Scryfall chiede di tenere sulla propria API pubblica e gratuita.
    // In sequenza la richiesta è più lenta solo negli scenari con molte carte, dove comunque il
    // tempo è dominato dalle chiamate a Gemini.
    const cardNamesLimitate = cardNames.slice(0, 6);
    const datiCarte = [];
    for (const nomeCarta of cardNamesLimitate) {
      const datiCarta = await cercaDatiCarta(nomeCarta);
      if (datiCarta !== null) {
        datiCarte.push(datiCarta);
      }
    }

    logDebug("[DEBUG] Risultati ricerca carte:", JSON.stringify(datiCarte.map((c) => (c ? c.nome : null))));

    // FASE C: cerca i frammenti di regole pertinenti nel testo ufficiale (nessun costo in token).
    // Le Comprehensive Rules locali sono la fonte primaria da controllare per prima: vengono
    // aggiornate manualmente ogni volta che Wizards pubblica un nuovo aggiornamento del regolamento,
    // quindi (a differenza di un ruling di una carta specifica, che resta fermo alla data in cui è
    // stato scritto) riflettono sempre il funzionamento più recente delle meccaniche di gioco.
    // Le parole chiave di Gemini (FASE A) vengono unite alle parole del type_line reale delle carte
    // trovate su Scryfall, così un tipo di carta come "Saga" viene sempre incluso nella ricerca,
    // anche se Gemini non l'ha esplicitamente restituito come keyword.
    const paroleTipoLinea = datiCarte.flatMap((carta) =>
      carta.tipoLinea.split(/[^A-Za-zÀ-ÿ]+/).filter((parola) => parola.length > 2)
    );
    const keywordCombinate = [...keywords, ...paroleTipoLinea];

    logDebug("[DEBUG] Parole chiave combinate per la ricerca CR:", JSON.stringify(keywordCombinate));

    const estrattiRegole = cercaRegolePertinenti(keywordCombinate, citedRules);
    const dataEfficaciaRegole = getDataEfficaciaRegole();

    // Oltre alle Comprehensive Rules (meccaniche di gioco), cerchiamo anche nel Magic
    // Tournament Rules (MTR): procedure e policy di torneo (deck check, sideboard, tempo,
    // comunicazione, tiebreaker, penalità, legalità dei formati) non sono coperte dalle CR.
    const estrattiRegoleTorneo = cercaRegoleTorneo(keywordCombinate, citedRules);
    const dataEfficaciaRegoleTorneo = getDataEfficaciaRegoleTorneo();

    let sezioneCarte = "";
    if (datiCarte.length > 0) {
      sezioneCarte = datiCarte
        .map((carta) => {
          const rulingsTesto =
            carta.rulings.length > 0
              ? carta.rulings.slice(0, 8).join("\n")
              : "Nessun ruling ufficiale disponibile per questa carta.";
          const legalitaTesto = carta.legalita !== "" ? carta.legalita : "Dati di legalità non disponibili.";
          return `Carta: ${carta.nome}\nTesto Oracle aggiornato: ${carta.testoOracle}\nLegalità nei formati principali: ${legalitaTesto}\nRulings ufficiali:\n${rulingsTesto}`;
        })
        .join("\n\n---\n\n");
    }

    // FASE D: costruisci il prompt finale con le fonti autorevoli reali
    const promptSistema = costruisciPromptSistema({
      haImmagine,
      errataPertinenti,
      estrattiRegole,
      dataEfficaciaRegole,
      estrattiRegoleTorneo,
      dataEfficaciaRegoleTorneo,
      sezioneCarte,
      testoCronologia,
      domanda,
    });

    logDebug("[DEBUG] Prompt completo inviato a Gemini:", promptSistema);

    const result = haImmagine
      ? await model.generateContent([
          promptSistema,
          {
            inlineData: {
              mimeType: mimeTypeImmagine,
              data: immagineBase64,
            },
          },
        ])
      : await model.generateContent(promptSistema);
    let risposta = result.response.text();

    logDebug("[DEBUG] Risposta grezza di Gemini (prima della verifica):", risposta);

    // FASE E: doppio controllo automatico. Se il verdetto si basa su una regola condizionale a
    // più clausole (tipo la 714.4 sul sacrificio delle Saghe), un secondo passaggio dedicato
    // ricontrolla SOLO la logica/aritmetica della conclusione, isolata dal resto della
    // narrazione — non si attiva se la risposta è già una richiesta di chiarimenti all'utente
    // (in quel caso non c'è ancora un verdetto da verificare).
    // Il controllo guarda entrambi i regolamenti: una condizione a più clausole può trovarsi
    // anche nel regolamento torneistico, e comunque la verifica deve poter partire pure quando
    // è quest'ultimo a reggere il verdetto.
    const necessitaVerifica =
      !eRichiestaDiChiarimenti(risposta) &&
      contieneRegolaCondizionaleComplessa(`${estrattiRegole}\n${estrattiRegoleTorneo}`);

    if (necessitaVerifica) {
      const promptVerifica = costruisciPromptVerifica({
        errataPertinenti,
        estrattiRegole,
        estrattiRegoleTorneo,
        sezioneCarte,
        domanda,
        risposta,
      });

      logDebug("[DEBUG] Prompt di verifica (FASE E) inviato a Gemini:", promptVerifica);

      const risultatoVerifica = await model.generateContent(promptVerifica);
      const rispostaVerificata = risultatoVerifica.response.text().trim();

      logDebug("[DEBUG] Risposta della verifica (FASE E):", rispostaVerificata);

      if (rispostaVerificata !== "") {
        risposta = rispostaVerificata;
      }
    }

    logDebug("[DEBUG] Risposta finale (dopo la verifica, prima dell'invio al frontend):", risposta);

    return NextResponse.json({ risposta: risposta });
  } catch (errore) {
    console.error("Errore nella chiamata a Gemini:", errore);
    return NextResponse.json(
      { errore: "Si è verificato un errore durante l'elaborazione della domanda." },
      { status: 500 }
    );
  }
}