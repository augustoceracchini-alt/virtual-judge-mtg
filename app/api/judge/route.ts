import { GoogleGenerativeAI, GenerativeModel, GenerationConfig } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
  cercaRegolePertinenti,
  cercaRegoleTorneo,
  getDataEfficaciaRegole,
  getDataEfficaciaRegoleTorneo,
} from "@/lib/rules";
import { cercaErrataPertinenti } from "@/lib/errata";
import { cercaDatiCarta, type DatiCarta } from "@/lib/scryfall";
import {
  costruisciPromptEstrazione,
  costruisciPromptSistema,
  costruisciPromptVerifica,
  type InputPromptVerifica,
} from "@/lib/prompts";
import { DEBUG_ATTIVO, logDebug } from "@/lib/debug";
import { contieneRegolaCondizionaleComplessa } from "@/lib/verifica";
import {
  MODELLO_STANDARD,
  MODELLO_VERIFICA,
  BUDGET_RAGIONAMENTO_VERIFICA,
  CONFIGURAZIONE_DETERMINISTICA,
  TIMEOUT_GEMINI_ESTRAZIONE_MS,
  TIMEOUT_GEMINI_VERDETTO_MS,
  TIMEOUT_GEMINI_VERIFICA_MS,
} from "@/lib/generazione";
import { classificaErroreGemini, eseguiConRiprova, rispostaPerGuasto } from "@/lib/rete";
import { richiestaConsentita } from "@/lib/limite";
import { normalizzaEstrazioneFaseA, type RisultatoEstrazioneFaseA } from "@/lib/estrazione";

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

// Estrae i numeri di regola citati in un testo, nella forma usata dalle Comprehensive Rules
// ("714.4", "113.7a"). I duplicati vengono tolti: interessa quali regole sono citate, non quante
// volte.
function numeriDiRegolaCitati(testo: string): string[] {
  return [...new Set(testo.match(/\b\d{3}\.\d+[a-z]?\b/g) ?? [])];
}

// Numeri di regola che il verdetto CITA ma che non compaiono fra gli estratti che gli sono stati
// FORNITI: il modello li ha presi dalla propria memoria invece che dalle fonti, cioè esattamente
// ciò che questo progetto esiste per impedire. Finora una citazione inventata non lasciava alcuna
// traccia, né nei log né nel comportamento.
//
// Il confronto è volutamente conservativo: una risposta che cita "510.1" è considerata coperta
// anche se gli estratti contengono solo "510.1c", perché quel numero compare comunque nel testo
// fornito. Meglio non segnalare un caso dubbio che riempire i log di falsi allarmi.
function regoleCitateSenzaFonte(risposta: string, estratti: string): string[] {
  return numeriDiRegolaCitati(risposta).filter((numero) => !estratti.includes(numero));
}

// I numeri di capitolo presenti negli estratti, letti dalle etichette "[Capitolo NNN - Titolo]"
// che lib/rules.ts antepone a ogni blocco. Servono alla diagnostica restituita al client: quando un
// utente segnala una risposta sbagliata, sapere QUALI capitoli erano arrivati al modello distingue
// un difetto di recupero (il capitolo decisivo non c'era) da un difetto di ragionamento (c'era e il
// modello l'ha applicato male) — due problemi che si affrontano in due file diversi.
function capitoliNegliEstratti(estratti: string): string[] {
  return [...new Set([...estratti.matchAll(/\[Capitolo (\S+)/g)].map((riscontro) => riscontro[1]))];
}

function eRichiestaDiChiarimenti(risposta: string): boolean {
  return risposta.includes("===OPZIONI_CHIARIMENTO===") || risposta.includes("Ho bisogno di alcuni chiarimenti");
}

// Vercel popola questo header con l'IP del client in testa alla lista. In sviluppo locale
// l'header non è presente: tutte le richieste condividono lo stesso contatore, accettabile perché
// non è l'ambiente da proteggere.
function ipClient(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "ip-sconosciuto";
}

// Restituisce il messaggio di errore da mostrare all'utente se l'immagine allegata non è valida,
// oppure null se non c'è niente da segnalare (immagine assente o valida). Nessuna immagine non è
// un errore: l'allegato è opzionale.
function erroreValidazioneImmagine(immagineBase64: unknown, mimeTypeImmagine: unknown): string | null {
  if (!immagineBase64) {
    return null;
  }

  const mimeTipiConsentiti = ["image/png", "image/jpeg", "image/webp"];
  if (!mimeTipiConsentiti.includes(mimeTypeImmagine as string)) {
    return "Formato immagine non supportato. Usa PNG, JPEG o WEBP.";
  }

  // Una stringa base64 di lunghezza L rappresenta circa L*0.75 byte di dati originali,
  // quindi ~10.6 milioni di caratteri base64 corrispondono a circa 8MB di immagine.
  const LUNGHEZZA_MASSIMA_BASE64 = 10600000;
  const lunghezzaBase64 = typeof immagineBase64 === "string" ? immagineBase64.length : 0;
  if (lunghezzaBase64 > LUNGHEZZA_MASSIMA_BASE64) {
    return "Immagine troppo grande (massimo 8MB).";
  }

  return null;
}

// Il blocco "DATI UFFICIALI DELLE CARTE MENZIONATE" del prompt, una scheda per ogni carta trovata
// su Scryfall. Nessun controllo sulla lista vuota: `[].map(...).join(...)` restituisce già la
// stringa vuota, che è esattamente il valore atteso quando non è stata trovata nessuna carta.
function formattaSezioneCarte(datiCarte: DatiCarta[]): string {
  return datiCarte
    .map((carta) => {
      const rulingsTesto =
        carta.rulings.length > 0
          ? carta.rulings.slice(0, 8).join("\n")
          : "Nessun ruling ufficiale disponibile per questa carta.";
      const legalitaTesto = carta.legalita !== "" ? carta.legalita : "Dati di legalità non disponibili.";
      // La riga del tipo va MOSTRATA al modello, non solo usata per arricchire le parole chiave
      // della ricerca (vedi paroleTipoLinea in POST): senza di essa il modello non ha nessuna
      // fonte per i tipi, i supertipi e i sottotipi della carta, e finisce per dedurli dal testo
      // Oracle. In una prova reale ha attribuito a Urza's Saga il supertipo "Legendary", che non
      // ha, citando come fonte "i ruling di Blood Moon": un'invenzione con tanto di attribuzione
      // falsa. La parola "legendary" era nel prompt solo perché compare come esempio generico
      // dentro il testo della regola 305.7.
      const tipoTesto = carta.tipoLinea !== "" ? carta.tipoLinea : "Riga del tipo non disponibile.";
      return `Carta: ${carta.nome}\nTipo di carta (riga del tipo ufficiale): ${tipoTesto}\nTesto Oracle aggiornato: ${carta.testoOracle}\nLegalità nei formati principali: ${legalitaTesto}\nRulings ufficiali:\n${rulingsTesto}`;
    })
    .join("\n\n---\n\n");
}

// FASE E: il doppio controllo. Restituisce il verdetto verificato, oppure quello ORIGINALE se la
// verifica fallisce o non produce testo.
//
// MODELLO_VERIFICA ha una quota gratuita molto più stretta di MODELLO_STANDARD: se la chiamata
// fallisce (quota esaurita o qualunque altro errore), il verdetto della FASE D è comunque valido e
// non va perso. Per questo la chiamata ha un try/catch dedicato, invece di lasciare che l'errore
// risalga al catch esterno del POST (che restituirebbe un errore generico all'utente, buttando via
// un verdetto già pronto per un problema di quota che non lo riguarda).
async function eseguiVerificaFaseE(genAI: GoogleGenerativeAI, input: InputPromptVerifica): Promise<string> {
  const promptVerifica = costruisciPromptVerifica(input);

  logDebug("[DEBUG] Prompt di verifica (FASE E) inviato a Gemini:", promptVerifica);

  try {
    // Il cast serve perché @google/generative-ai è deprecata e i suoi tipi non conoscono
    // `thinkingConfig`, che l'API invece accetta: verificato dal vivo con scripts/sonda-fase-e.mjs,
    // dove i token di ragionamento riportati da Gemini scendono da 5.303 a 913-2.164 quando il
    // campo è presente. Se un giorno si passa alla libreria nuova (@google/genai), il campo è
    // previsto dai suoi tipi e questo cast va tolto.
    const configurazioneVerifica = {
      // Anche il revisore genera in modo deterministico, non solo le FASI A e D. Senza, la fase che
      // ha l'ultima parola sul verdetto resterebbe l'unica a sorteggiare: proprio sulle domande
      // difficili (la FASE E scatta su 10 casi di prova su 14) la risposta finale continuerebbe a
      // cambiare a ogni invio, vanificando il resto.
      ...CONFIGURAZIONE_DETERMINISTICA,
      thinkingConfig: { thinkingBudget: BUDGET_RAGIONAMENTO_VERIFICA },
    } as unknown as GenerationConfig;

    // Il tempo massimo della FASE E è molto più largo di quello delle altre fasi perché la FASE E
    // è molto più lenta (vedi TIMEOUT_GEMINI_VERIFICA_MS in lib/generazione.ts).
    const modelVerifica = genAI.getGenerativeModel(
      {
        model: MODELLO_VERIFICA,
        generationConfig: configurazioneVerifica,
      },
      { timeout: TIMEOUT_GEMINI_VERIFICA_MS }
    );

    // Qui, a differenza delle FASI A e D, NON si riprova, ed è una scelta e non una dimenticanza.
    // Due motivi. Il primo: questa fase ha già un suo modo di fallire bene — il catch qui sotto
    // restituisce il verdetto della FASE D, che è comunque una risposta utile — mentre A e D
    // fallendo fanno perdere la risposta del tutto. Il secondo: qui la risorsa scarsa è il TEMPO.
    // La FASE E vale già 15-21 secondi, e un secondo tentativo rischierebbe di sfondare il tetto di
    // durata della funzione, facendo perdere all'utente anche il verdetto già scritto — cioè
    // esattamente il danno che si voleva evitare. Da notare che su quota esaurita riprovare non
    // servirebbe comunque: MODELLO_VERIFICA ha ~20 richieste al giorno, non al minuto.
    const risultatoVerifica = await modelVerifica.generateContent(promptVerifica);
    const rispostaVerificata = risultatoVerifica.response.text().trim();

    // I token di ragionamento sono il segnale su cui giudicare la FASE E, molto più della sua
    // durata: i secondi variano parecchio anche a parità di domanda, mentre questi numeri dicono
    // direttamente quanto il modello ha pensato — che è dove va il tempo. Servono per accorgersi
    // che BUDGET_RAGIONAMENTO_VERIFICA ha smesso di fare effetto, cosa che può succedere in
    // silenzio se Google cambia il nome del campo o la libreria deprecata smette di inoltrarlo.
    const consumo = risultatoVerifica.response.usageMetadata;
    logDebug(
      "[DEBUG] FASE E, token: letti",
      consumo?.promptTokenCount,
      "| ragionamento",
      (consumo as { thoughtsTokenCount?: number } | undefined)?.thoughtsTokenCount,
      "| scritti",
      consumo?.candidatesTokenCount
    );

    logDebug("[DEBUG] Risposta della verifica (FASE E):", rispostaVerificata);

    if (rispostaVerificata !== "") {
      return rispostaVerificata;
    }
  } catch (erroreVerifica) {
    // Il tipo di guasto va nel log, non solo l'errore grezzo: "quota" e "timeout" portano allo
    // stesso esito visibile (verdetto non verificato) ma vogliono due rimedi opposti — il primo
    // dice che MODELLO_VERIFICA ha finito le sue ~20 richieste giornaliere, il secondo che una
    // chiamata è rimasta appesa. Senza l'etichetta le due cose sono indistinguibili nei log, ed è
    // la distinzione che serve per sapere se la FASE E sta lavorando o è di fatto spenta.
    console.error(
      `Errore nella verifica FASE E, guasto di tipo "${classificaErroreGemini(erroreVerifica)}" (si procede con il verdetto non verificato):`,
      erroreVerifica
    );
  }

  return input.risposta;
}

// FASE A: estrae parole chiave, numeri di regola e nomi di carte citati in tutta la conversazione
// finora. Se la risposta di Gemini non è utilizzabile — JSON non valido, oppure valido ma non nella
// forma attesa — restituisce liste vuote invece di propagare l'errore: la richiesta prosegue senza
// fonti (il prompt della FASE D avvisa l'utente in quel caso) invece di fallire del tutto.
// Quello che torna ha sempre e comunque tre `string[]`: il perché è in lib/estrazione.ts.
async function eseguiEstrazioneFaseA(
  model: GenerativeModel,
  domanda: string,
  testoCronologia: string
): Promise<RisultatoEstrazioneFaseA> {
  const promptEstrazione = costruisciPromptEstrazione(domanda, testoCronologia);

  const risultatoEstrazione = await eseguiConRiprova(
    () => model.generateContent(promptEstrazione),
    "FASE A (estrazione)"
  );
  let testoEstrazione = risultatoEstrazione.response.text().trim();
  testoEstrazione = testoEstrazione.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    // La normalizzazione sta immediatamente dopo il parse, e non più a valle, perché da qui in
    // poi tutto il resto del route handler deve poter dare per scontato di avere `string[]`. Il
    // perché `Array.isArray` da solo non bastasse è documentato in lib/estrazione.ts.
    //
    // Il `null` distingue "JSON valido ma non è l'oggetto atteso" (per esempio `"null"` o `"42"`,
    // che `JSON.parse` accetta senza protestare) da un'estrazione riuscita e povera. Senza quella
    // distinzione il primo caso finirebbe nei log come "risposta non interpretabile come JSON",
    // che è una diagnosi sbagliata, oppure non ci finirebbe affatto.
    const estrazioneNormalizzata = normalizzaEstrazioneFaseA(JSON.parse(testoEstrazione));
    if (estrazioneNormalizzata === null) {
      throw new Error("JSON valido, ma non è un oggetto con i campi attesi");
    }

    return estrazioneNormalizzata;
  } catch (erroreEstrazione) {
    // Senza questo log il fallimento è invisibile a chi gestisce il servizio, ed è tutt'altro che
    // innocuo: con parole chiave e carte vuote la ricerca locale non restituisce nulla, e il
    // prompt della FASE D passa al ramo "nessuna fonte disponibile", che fa rispondere il modello
    // basandosi sulla propria memoria — esattamente ciò che questo progetto esiste per impedire.
    // L'utente almeno viene avvisato da quel ramo del prompt; nei log invece non compariva niente.
    console.error(
      "FASE A: risposta di Gemini inutilizzabile (JSON non valido, oppure valido ma non nella forma attesa). Si procede senza parole chiave né nomi di carta, quindi senza fonti.",
      erroreEstrazione,
      "Testo ricevuto (primi 500 caratteri):",
      testoEstrazione.slice(0, 500)
    );
    return { keywords: [], citedRules: [], cardNames: [] };
  }
}

// Cronometro delle fasi: dice quanto è durato ogni pezzo della richiesta. Serve a decidere DOVE
// intervenire per accelerare l'app invece di indovinarlo — l'unico numero noto è il totale (~10 s a
// caldo), che da solo non dice se pesino di più le chiamate a Gemini o quelle a Scryfall.
// I tempi passano da `logDebug`, quindi in produzione non compaiono a meno di DEBUG_JUDGE=true.
function avviaCronometro() {
  const inizio = Date.now();
  let precedente = inizio;
  const misure: { fase: string; ms: number }[] = [];

  return {
    tappa(nome: string) {
      const ora = Date.now();
      const durata = ora - precedente;
      misure.push({ fase: nome, ms: durata });
      logDebug(`[DEBUG] TEMPI — ${nome}: ${durata} ms`);
      precedente = ora;
    },
    totale(nome: string) {
      const durata = Date.now() - inizio;
      misure.push({ fase: nome, ms: durata });
      logDebug(`[DEBUG] TEMPI — ${nome}: ${durata} ms`);
    },
    // I tempi finiscono anche nella risposta, ma solo con DEBUG_JUDGE=true: leggere la console del
    // server non è sempre possibile (in produzione servono i log di Vercel, e in locale il server
    // può appartenere a un'altra sessione), mentre la risposta la vede chiunque faccia la richiesta.
    elenco() {
      return misure;
    },
  };
}

export async function POST(request: NextRequest) {
  const cronometro = avviaCronometro();

  if (!richiestaConsentita(ipClient(request))) {
    return NextResponse.json(
      { errore: "Troppe richieste da questo indirizzo IP. Riprova tra qualche minuto." },
      { status: 429 }
    );
  }

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

    const erroreImmagine = erroreValidazioneImmagine(immagineBase64, mimeTypeImmagine);
    if (erroreImmagine !== null) {
      return NextResponse.json({ errore: erroreImmagine }, { status: 400 });
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
    // Le FASI A e D girano con la generazione deterministica (vedi CONFIGURAZIONE_DETERMINISTICA in
    // lib/generazione.ts): senza, Gemini sorteggia la risposta a ogni invio e la stessa domanda
    // riceve verdetti diversi. Vale per entrambe le fasi, ed e' la FASE A a contare di piu' di
    // quanto sembri: parole chiave diverse portano a capitoli diversi, quindi a un verdetto che
    // parte gia' da fonti diverse.
    // Due oggetti per lo STESSO modello Gemini, che differiscono solo per il tempo massimo
    // concesso. Non è una duplicazione da accorpare: la FASE A è una mini-estrazione da meno di un
    // secondo, la FASE D scrive il verdetto e il suo fallimento fa perdere l'intera risposta,
    // quindi meritano tetti diversi (il perché di ciascun valore è in lib/generazione.ts).
    // Costruirli entrambi non costa nulla: `getGenerativeModel` assembla solo un oggetto, non
    // apre nessuna connessione.
    const impostazioniModelloStandard = {
      model: MODELLO_STANDARD,
      generationConfig: CONFIGURAZIONE_DETERMINISTICA,
    };
    const modelEstrazione = genAI.getGenerativeModel(impostazioniModelloStandard, {
      timeout: TIMEOUT_GEMINI_ESTRAZIONE_MS,
    });
    const modelVerdetto = genAI.getGenerativeModel(impostazioniModelloStandard, {
      timeout: TIMEOUT_GEMINI_VERDETTO_MS,
    });

    const testoCronologia = cronologia
      .map((messaggio) => `${messaggio.ruolo === "utente" ? "Utente" : "Giudice"}: ${messaggio.testo}`)
      .join("\n\n");

    // FASE A: estrai parole chiave, numeri di regola e nomi di carte citati in tutta la conversazione finora
    const { keywords, citedRules, cardNames } = await eseguiEstrazioneFaseA(
      modelEstrazione,
      domanda,
      testoCronologia
    );

    cronometro.tappa("FASE A (Gemini: estrazione)");

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

    cronometro.tappa(`FASE B (Scryfall: ${cardNamesLimitate.length} carte cercate)`);

    logDebug("[DEBUG] Risultati ricerca carte:", JSON.stringify(datiCarte.map((c) => c.nome)));

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

    cronometro.tappa("FASE C (ricerca locale nei due regolamenti)");

    const sezioneCarte = formattaSezioneCarte(datiCarte);

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

    // Come la FASE A, anche il verdetto si riprova una volta se Gemini ha un intoppo passeggero:
    // è la chiamata che produce la risposta, quindi perderla significa perdere tutto il lavoro
    // delle fasi precedenti (ricerca nei regolamenti compresa) per un 429 durato un secondo.
    const result = await eseguiConRiprova(
      () =>
        haImmagine
          ? modelVerdetto.generateContent([
              promptSistema,
              {
                inlineData: {
                  mimeType: mimeTypeImmagine,
                  data: immagineBase64,
                },
              },
            ])
          : modelVerdetto.generateContent(promptSistema),
      haImmagine ? "FASE D (verdetto, con immagine)" : "FASE D (verdetto)"
    );
    let risposta = result.response.text();

    cronometro.tappa(haImmagine ? "FASE D (Gemini: verdetto, con immagine)" : "FASE D (Gemini: verdetto)");

    logDebug("[DEBUG] Risposta grezza di Gemini (prima della verifica):", risposta);

    // FASE E: doppio controllo automatico. Se il verdetto si basa su una regola condizionale a
    // più clausole (tipo la 714.4 sul sacrificio delle Saghe), un secondo passaggio dedicato
    // ricontrolla SOLO la logica/aritmetica della conclusione, isolata dal resto della
    // narrazione — non si attiva se la risposta è già una richiesta di chiarimenti all'utente
    // (in quel caso non c'è ancora un verdetto da verificare).
    // Il controllo guarda entrambi i regolamenti: una condizione a più clausole può trovarsi
    // anche nel regolamento torneistico, e comunque la verifica deve poter partire pure quando
    // è quest'ultimo a reggere il verdetto.
    const tutteLeFonti = `${estrattiRegole}\n${estrattiRegoleTorneo}`;

    // Una richiesta di chiarimenti non è un verdetto: non ha senso cercarvi citazioni da verificare,
    // né sottoporla al doppio controllo.
    const chiedeChiarimenti = eRichiestaDiChiarimenti(risposta);

    // Questo primo calcolo guarda la risposta della FASE D e serve a UNA cosa sola: decidere se
    // eseguire la verifica. Non è il valore che finisce nei log — quello viene ricalcolato sulla
    // risposta definitiva, dopo l'eventuale FASE E.
    const citazioniSenzaFonteFaseD = chiedeChiarimenti
      ? []
      : regoleCitateSenzaFonte(risposta, tutteLeFonti);

    // La verifica scatta anche quando il verdetto cita regole che non gli sono state fornite, non
    // solo sugli indicatori testuali. Gli indicatori guardano infatti il testo delle regole
    // RECUPERATE: se il recupero ha già mancato la regola decisiva, nessun indicatore compare e il
    // doppio controllo resta inerte proprio nel caso peggiore, quello in cui il modello sta
    // rispondendo a memoria. Una citazione senza fonte è il segnale che quel caso si è verificato.
    const necessitaVerifica =
      !chiedeChiarimenti &&
      (contieneRegolaCondizionaleComplessa(tutteLeFonti) || citazioniSenzaFonteFaseD.length > 0);

    // Serve più sotto per sapere se la FASE E ha davvero riscritto il verdetto: `eseguiVerificaFaseE`
    // restituisce il testo immutato sia quando conferma la conclusione sia quando fallisce per quota
    // esaurita, quindi "la verifica è stata eseguita" non significa "il verdetto è cambiato".
    const rispostaFaseD = risposta;

    if (necessitaVerifica) {
      risposta = await eseguiVerificaFaseE(genAI, {
        errataPertinenti,
        estrattiRegole,
        estrattiRegoleTorneo,
        sezioneCarte,
        testoCronologia,
        domanda,
        risposta,
      });

      cronometro.tappa("FASE E (Gemini: verifica)");
    }

    // Il controllo sulle citazioni va rifatto sulla risposta DEFINITIVA. La FASE E riscrive il
    // verdetto, e riscrivendolo può introdurre un numero di regola che negli estratti non c'è:
    // calcolandolo una volta sola prima della verifica, proprio la citazione inventata dal revisore
    // restava invisibile. Ed è il caso peggiore, perché la FASE E esiste per CORREGGERE il verdetto:
    // se invece lo peggiora, deve almeno lasciarne traccia.
    //
    // `eRichiestaDiChiarimenti` viene rivalutato sul testo finale invece di riusare
    // `chiedeChiarimenti`: costa una `includes` e tiene vera la regola "una richiesta di
    // chiarimenti non ha citazioni da verificare" anche nel caso in cui la FASE E trasformasse il
    // verdetto in una domanda all'utente.
    const rispostaCambiataDallaVerifica = risposta !== rispostaFaseD;
    const citazioniSenzaFonte = eRichiestaDiChiarimenti(risposta)
      ? []
      : regoleCitateSenzaFonte(risposta, tutteLeFonti);

    // Un log solo, e sulla risposta definitiva. Loggare anche prima della FASE E avrebbe segnalato
    // due volte la stessa anomalia tutte le volte che la verifica non cambia il verdetto — cioè
    // spesso, visto che il testo torna immutato sia quando la FASE E conferma sia quando fallisce.
    // L'etichetta dice quale fase ha prodotto il testo che cita.
    if (citazioniSenzaFonte.length > 0) {
      console.error(
        `${rispostaCambiataDallaVerifica ? "FASE E" : "FASE D"}: il verdetto cita numeri di regola che NON compaiono negli estratti forniti, quindi presi dalla memoria del modello e non dalle fonti:`,
        citazioniSenzaFonte.join(", ")
      );
    }

    logDebug("[DEBUG] Risposta finale (dopo la verifica, prima dell'invio al frontend):", risposta);

    cronometro.totale(necessitaVerifica ? "TOTALE (con FASE E)" : "TOTALE (senza FASE E)");

    // La diagnostica viaggia SEMPRE, non solo con DEBUG_JUDGE=true: il client se la tiene da parte
    // e la rimanda a /api/segnalazione se l'utente segnala che la risposta è sbagliata. Senza,
    // una segnalazione direbbe soltanto "ha sbagliato", mentre il difetto quasi sempre sta nel
    // RECUPERO — e le parole chiave di QUESTA esecuzione non sono ricostruibili a posteriori,
    // perché la FASE A ne produce di diverse ogni volta. Sono poche centinaia di byte, e non
    // contengono nulla che l'utente non abbia già scritto o ricevuto.
    return NextResponse.json({
      risposta: risposta,
      diagnostica: {
        paroleChiave: keywordCombinate,
        regoleCitate: citedRules,
        carte: datiCarte.map((carta) => carta.nome),
        capitoliCR: capitoliNegliEstratti(estrattiRegole),
        capitoliMTR: capitoliNegliEstratti(estrattiRegoleTorneo),
        faseE: necessitaVerifica,
        citazioniSenzaFonte: citazioniSenzaFonte,
        conFoto: haImmagine,
      },
      ...(DEBUG_ATTIVO ? { tempi: cronometro.elenco() } : {}),
    });
  } catch (errore) {
    // Prima di questa riga qualunque guasto diventava un 500 con «Si è verificato un errore
    // durante l'elaborazione della domanda»: lo stesso messaggio per una chiave API mancante e per
    // il tetto di 15 richieste al minuto del piano gratuito, che sono il problema di chi gestisce
    // il servizio l'uno e un'attesa di sessanta secondi l'altro. All'utente non veniva detto né
    // che la sua domanda andava benissimo, né che riprovare sarebbe bastato.
    const tipoGuasto = classificaErroreGemini(errore);
    const { messaggio, codiceHttp } = rispostaPerGuasto(tipoGuasto);

    console.error(`Errore nell'elaborazione della domanda, guasto di tipo "${tipoGuasto}":`, errore);

    return NextResponse.json({ errore: messaggio }, { status: codiceHttp });
  }
}