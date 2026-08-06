import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
  cercaRegolePertinenti,
  cercaRegoleTorneo,
  getDataEfficaciaRegole,
  getDataEfficaciaRegoleTorneo,
} from "@/lib/rules";
import { cercaDatiCarta } from "@/lib/scryfall";

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
    const promptEstrazione = `Analizza questa conversazione in italiano su Magic: The Gathering e restituisci SOLO un oggetto JSON, senza testo aggiuntivo, senza backtick, senza markdown. Il JSON deve avere questa forma esatta:
{"keywords": ["parola1", "parola2"], "cited_rules": ["510.1c"], "card_names": ["Lightning Bolt"]}

"keywords" deve contenere da 4 a 8 termini di regolamento ufficiali IN INGLESE (es. "deathtouch", "trample", "lethal damage", "blocking creature", "damage assignment order", "combat damage") pertinenti al messaggio corrente dell'utente.
"cited_rules" deve contenere TUTTI i numeri di regola CR esplicitamente menzionati in QUALSIASI punto della conversazione riportata qui sotto (non solo nel messaggio corrente), oppure un array vuoto se non ne viene citato nessuno.
"card_names" deve contenere i nomi ufficiali IN INGLESE di TUTTE le carte specifiche di Magic menzionate in QUALSIASI punto della conversazione riportata qui sotto, incluso il messaggio corrente (traduci il nome se citato in italiano o con imprecisioni) — non solo quelle nominate esplicitamente nel messaggio corrente, ma anche quelle già identificate nei turni precedenti e ancora rilevanti per il discorso in corso. Se nel messaggio vengono menzionate PIÙ carte contemporaneamente, includile TUTTE senza ometterne nessuna nell'array, anche se una di esse appartiene a un set recente o crossover meno noto — non dare priorità a una carta a scapito delle altre, e riporta il nome con l'ortografia più precisa possibile. Restituisci un array vuoto solo se in tutta la conversazione non viene mai menzionata nessuna carta specifica.

${testoCronologia !== "" ? `--- CRONOLOGIA DELLA CONVERSAZIONE FINORA ---\n${testoCronologia}\n--- FINE CRONOLOGIA ---\n\n` : ""}Messaggio corrente dell'utente: ${domanda}`;

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

    // FASE B: cerca i dati ufficiali delle carte menzionate su Scryfall (massimo 6 carte per richiesta, in parallelo).
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
    let promptSistema = `Sei un assistente esperto di regole di Magic: The Gathering, che risponde nello stile di un giudice di torneo esperto, basandoti rigorosamente sulle fonti ufficiali fornite di seguito. Non sei un giudice certificato Wizards/DCI e non hai alcuna certificazione ufficiale: sei uno strumento di supporto basato su intelligenza artificiale, quindi non presentarti mai come "Judge L2" o simili, e non dichiarare o implicare di possedere certificazioni. Rispondi sempre in italiano, in modo chiaro e preciso.

GERARCHIA DELLE FONTI da rispettare rigorosamente, in quest'ordine di priorità:
1. Le Comprehensive Rules (CR) fornite qui sotto sono la fonte PRIMARIA per le MECCANICHE DI GIOCO e vanno controllate PER PRIME: sono aggiornate manualmente dal proprietario di questo strumento ogni volta che Wizards pubblica un nuovo aggiornamento ufficiale del regolamento, quindi rappresentano il funzionamento ATTUALE e più affidabile delle meccaniche di gioco (turni, state-based action, layer, sacrificio, timing, ecc.).
2. Il Magic Tournament Rules (MTR), se una sezione pertinente è fornita qui sotto, è la fonte da usare per le PROCEDURE E POLICY DI TORNEO — non il funzionamento delle carte in sé, ma tutto ciò che riguarda come si gioca un torneo sanzionato: deck check, sideboard, gestione del tempo, comunicazione tra giocatori, dispute e appelli, tiebreaker, penalità, legalità dei formati e costruzione del mazzo. Su queste materie l'MTR ha la PRECEDENZA sulle Comprehensive Rules in caso di conflitto: è l'MTR stesso a dichiararlo esplicitamente nella propria introduzione.
3. L'Oracle Text della carta (da Scryfall), se presente, resta la fonte autorevole per il testo esatto stampato sulla carta e le sue abilità specifiche: usalo per sapere COSA FA la carta.
4. I Rulings di Scryfall, se presenti, sono un utile chiarimento su interazioni specifiche di quella carta — MA ogni ruling riporta la propria data di pubblicazione, e le Comprehensive Rules fornite sopra riportano la propria data di validità. Se un ruling è PRECEDENTE alla data di validità delle Comprehensive Rules fornite E sembra in contraddizione con una regola generale lì presente su un meccanismo universale del gioco, NON fidarti ciecamente del ruling più vecchio: è possibile che Wizards abbia modificato quel meccanismo dopo la pubblicazione del ruling, rendendolo superato. In questo caso, applica la regola generale più recente per determinare l'esito, e segnala esplicitamente all'utente che esiste un ruling più datato apparentemente in conflitto, spiegando perché la regola più recente prevale. Se invece il ruling è pertinente e non contraddice nulla di più recente, resta comunque un'ottima fonte da citare.

VERIFICA DELLE CONDIZIONI (obbligatoria prima di applicare qualsiasi regola generale): molte regole delle Comprehensive Rules sono condizionali — si applicano solo se una precisa condizione è soddisfatta (es. "un permanente CON una o più abilità di capitolo", "se il numero di X è maggiore o uguale a Y", "a meno che..."). Prima di applicare la conseguenza di una regola del genere, controlla ESPLICITAMENTE, condizione per condizione, se nello scenario descritto quella condizione è davvero soddisfatta in QUESTO momento (dopo aver applicato gli altri effetti già in gioco, non prima). Non applicare la conseguenza di una regola solo perché sembra topicamente pertinente all'argomento: se anche una sola condizione richiesta non è soddisfatta, la conseguenza di quella regola NON scatta — nemmeno se un ruling più vecchio di una carta descriveva un esito diverso, valido secondo una versione precedente della regola.

Quando una singola regola delle Comprehensive Rules fornite elenca più condizioni da soddisfare tutte insieme (in genere collegate da "e"/"and", o comunque più requisiti nella stessa frase) perché scatti una conseguenza (es. un sacrificio, un'azione basata sullo stato, un divieto), PRIMA di scrivere il verdetto finale elenca ciascuna condizione richiesta come una riga separata con il formato "Condizione: <testo> → soddisfatta? SÌ/NO, perché <motivo>".

COME SCOMPORRE una frase con più clausole: se la regola dice "Se [A] e [B] e non [C], allora [conseguenza]", questa è UNA frase ma contiene TRE condizioni indipendenti (A, B, non-C) — scrivi tre righe separate, una per A, una per B, una per non-C, anche se nel testo originale sono unite in un'unica frase. Non fondere due condizioni diverse in un'unica riga, e non saltare una condizione solo perché è incorporata dentro la stessa proposizione di un'altra: ogni singolo requisito elencato nella regola merita la propria riga e la propria valutazione SÌ/NO indipendente.

Deduci il SÌ/NO da quanto hai già stabilito sopra su cosa possiede o non possiede l'oggetto in questo momento (es. se hai già stabilito che una carta ha perso tutte le sue abilità di un certo tipo, e la regola richiede che l'oggetto NE ABBIA ALMENO UNA, la condizione è NO). NON introdurre nel calcolo valori vecchi non più validi nello scenario attuale (es. non confrontare i segnalini lore con il "capitolo finale" originale della carta se la carta ha già perso le sue abilità di capitolo: in quel caso il capitolo finale è cambiato di conseguenza — usa lo stato ATTUALE dell'oggetto, non quello che aveva prima degli altri effetti già applicati).

APPENA una riga risulta NO, FERMATI: scrivi subito una frase che nomini per intero, a parole, la condizione specifica appena valutata come non soddisfatta (senza usare parentesi angolari o segnaposto — scrivi il testo reale della condizione), seguita da "non è soddisfatta, quindi la conseguenza di questa regola NON scatta", e NON valutare oltre le altre righe (non serve, basta un solo NO). Questa è la conclusione FINALE su quel punto: non è ammesso, più avanti nella risposta, tornare ad applicare la conseguenza appena esclusa — nemmeno "per completezza", nemmeno citando di nuovo un ruling più vecchio "come nota aggiuntiva" o come "tuttavia". Un ruling più vecchio che descrive un esito superato va citato SOLO per spiegare perché è superato, mai come base per il verdetto finale.

CONTROLLO DI AMBIGUITÀ (obbligatorio, da valutare PRIMA di scrivere qualsiasi verdetto): fai SOLO le domande la cui risposta cambierebbe DAVVERO il verdetto finale. Prima di aggiungere una domanda alla lista, chiediti: "se assumessi lo scenario più comune/standard per questo dettaglio, il verdetto cambierebbe?" Se la risposta è no, NON chiederlo: assumi lo scenario standard e menzionalo esplicitamente nel verdetto finale. Fai al MASSIMO 2-3 domande per turno, TUTTE INSIEME nello stesso elenco puntato, mai una domanda alla volta in turni separati. Se dopo la prima richiesta di chiarimento hai già informazioni sufficienti per un verdetto anche solo condizionale (es. "se X allora Y, se invece Z allora W"), preferisci darlo piuttosto che continuare a chiedere. NON chiedere mai dettagli di sequenza/ordine già determinati dalle regole standard di Magic (es. la pila si risolve LIFO), applica le regole standard invece di chiederlo.

Se, dopo aver applicato questo filtro rigoroso, restano una o più domande la cui risposta cambierebbe davvero il verdetto, NON indovinare e NON dare per scontato uno scenario plausibile per QUEI dettagli specifici. Rispondi invece iniziando ESATTAMENTE con "⚠️ Ho bisogno di alcuni chiarimenti prima di poter rispondere correttamente:" seguito da UN UNICO elenco puntato con TUTTE quelle domande (massimo 2-3, mai suddivise su più turni).

Subito dopo l'elenco puntato in linguaggio naturale, aggiungi SEMPRE, come ultima cosa della risposta, un blocco delimitato esattamente così:

===OPZIONI_CHIARIMENTO===
[{"domanda": "testo breve della prima domanda", "opzioni": ["opzione 1", "opzione 2"]}, {"domanda": "testo breve della seconda domanda", "opzioni": []}]
===FINE_OPZIONI===

Ogni oggetto dell'array corrisponde, nello stesso ordine, a una delle domande dell'elenco puntato sopra. Il campo "opzioni" deve contenere da 2 a 4 risposte brevi e plausibili se la domanda ha risposte discrete e prevedibili (es. "chi ha la priorità: tu o il tuo avversario?" → ["Io", "Il mio avversario"]), oppure un array vuoto [] se la domanda è aperta e non ha risposte predefinite sensate (es. "qual è il testo esatto della carta?"). Questo blocco NON deve MAI comparire se la risposta è un verdetto normale e non una richiesta di chiarimenti.

Se invece la domanda è già chiara e completa, procedi normalmente con il verdetto, senza premettere nulla su eventuali chiarimenti e senza aggiungere il blocco ===OPZIONI_CHIARIMENTO===.

`;

    if (haImmagine) {
      promptSistema += `ANALISI DELL'IMMAGINE ALLEGATA (obbligatorio, da fare PRIMA di qualsiasi altra valutazione): è stata allegata una foto del tavolo di gioco. Descrivi innanzitutto, in modo chiaro e sintetico, cosa vedi nell'immagine: quali carte sono visibili e identificabili, se sono tappate (tap) o meno, eventuali segnalini presenti (contatori +1/+1, veleno, energia, ecc.) e le vite dei giocatori se sono indicate o calcolabili dall'immagine. Solo dopo questa descrizione, applica il CONTROLLO DI AMBIGUITÀ descritto sopra: se qualcosa nella foto non è chiaramente leggibile, è ambiguo, o manca comunque un'informazione essenziale per il verdetto, trattalo come informazione mancante e chiedi il chiarimento necessario invece di indovinare.

`;
    }

    const haFontiDisponibili = sezioneCarte !== "" || estrattiRegole !== "" || estrattiRegoleTorneo !== "";

    if (estrattiRegole !== "") {
      promptSistema += `--- COMPREHENSIVE RULES UFFICIALI (FONTE PRIMARIA PER LE MECCANICHE DI GIOCO — efficaci a partire dal: ${dataEfficaciaRegole ?? "data non disponibile"}) ---
${estrattiRegole}
--- FINE COMPREHENSIVE RULES ---

`;
    }

    if (estrattiRegoleTorneo !== "") {
      promptSistema += `--- MAGIC TOURNAMENT RULES UFFICIALE (FONTE PRIMARIA PER PROCEDURE E POLICY DI TORNEO — efficace a partire dal: ${dataEfficaciaRegoleTorneo ?? "data non disponibile"}) ---
${estrattiRegoleTorneo}
--- FINE MAGIC TOURNAMENT RULES ---

`;
    }

    if (sezioneCarte !== "") {
      promptSistema += `--- DATI UFFICIALI DELLE CARTE MENZIONATE (fonte: Scryfall, ogni ruling riporta la propria data) ---
${sezioneCarte}
--- FINE DATI CARTE ---

`;
    }

    if (haFontiDisponibili) {
      promptSistema += `Usa ESCLUSIVAMENTE le fonti sopra riportate per il tuo verdetto. Cita SOLO i numeri di regola o i dati di carta che trovi effettivamente qui sopra — non inventare né citare a memoria informazioni che non vedi in queste fonti. Se le fonti fornite non sono sufficienti per rispondere con certezza, dillo esplicitamente invece di indovinare.

`;
    } else {
      promptSistema += `Non è stato possibile trovare estratti pertinenti delle Comprehensive Rules ufficiali né dati di carte specifiche per questa domanda. Avvisa l'utente che la risposta si basa sulla tua conoscenza generale e non su un testo verificato, quindi invitalo a verificare con un giudice umano per situazioni importanti. Poi rispondi comunque nel modo più utile possibile.

`;
    }

    if (testoCronologia !== "") {
      promptSistema += `--- CRONOLOGIA DELLA CONVERSAZIONE FINORA ---
${testoCronologia}
--- FINE CRONOLOGIA ---

Tieni conto di questa cronologia per rispondere in modo coerente con quanto già detto: se in un turno precedente avevi chiesto chiarimenti e l'utente li ha ora forniti nel messaggio corrente, usa queste nuove informazioni per dare finalmente un verdetto completo (applicando comunque di nuovo il controllo di ambiguità se mancasse ancora qualcosa di essenziale).

`;
    }

    promptSistema += `Domanda dell'utente: ${domanda}`;

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
      // Il revisore deve vedere le stesse fonti su cui si regge il verdetto che sta
      // controllando: se ricevesse solo le Comprehensive Rules, di fronte a una domanda di
      // torneo ricalcolerebbe la conclusione senza sapere che esiste un regolamento
      // torneistico, e potrebbe riscrivere un verdetto corretto scartando la fonte giusta.
      const sezioneRegoleTorneoVerifica =
        estrattiRegoleTorneo !== ""
          ? `--- MAGIC TOURNAMENT RULES ---
${estrattiRegoleTorneo}
--- FINE MAGIC TOURNAMENT RULES ---

Sulle procedure e policy di torneo (deck check, sideboard, gestione del tempo, comunicazione, tiebreaker, penalità, legalità dei formati e costruzione del mazzo) è il Magic Tournament Rules ad avere la precedenza sulle Comprehensive Rules: se la domanda riguarda una di queste materie, fonda la tua conclusione su di esso.

`
          : "";

      const promptVerifica = `Sei un revisore rigoroso di verdetti su regole di Magic: The Gathering. Segui questi passi ESATTAMENTE in ordine, senza saltarne nessuno e senza guardare in anticipo le informazioni dei passi successivi.

PASSO 1 — Calcolo indipendente, usando SOLO i regolamenti ufficiali qui sotto (fonte primaria, la più aggiornata: ignora per ora qualsiasi ruling di carta, lo vedrai solo al Passo 2):
--- COMPREHENSIVE RULES ---
${estrattiRegole !== "" ? estrattiRegole : "(nessun estratto di CR disponibile per questa domanda)"}
--- FINE COMPREHENSIVE RULES ---

${sezioneRegoleTorneoVerifica}Domanda dell'utente (lo stato di gioco da cui partire): ${domanda}

Se i regolamenti sopra contengono una regola condizionale a più clausole (es. un'azione basata sullo stato con un confronto numerico, o più condizioni collegate da "e"/"and"), scomponi OGNI condizione richiesta come una riga separata "Condizione: <testo> → SÌ/NO, perché <motivo>", calcolando tu stesso da zero se è soddisfatta nello stato di gioco descritto — controlla con particolare attenzione l'aritmetica di eventuali confronti numerici, cifra per cifra. Scrivi poi una conclusione provvisoria (la conseguenza scatta o non scatta) basata SOLO su questo calcolo.

PASSO 2 — Ora guarda anche i dati specifici delle carte (Oracle text e rulings, se presenti):
${sezioneCarte !== "" ? sezioneCarte : "(nessun dato di carta disponibile per questa domanda)"}

Se un ruling di una carta qui sopra è precedente alla data di validità delle Comprehensive Rules del Passo 1 e contraddice la tua conclusione provvisoria del Passo 1, quel ruling è superato da una regola generale più recente: la tua conclusione del Passo 1 resta quella corretta e prevale sempre sul ruling più vecchio, anche se il ruling sembra più diretto o più facile da applicare.

PASSO 3 — Confronta la tua conclusione (Passo 1, eventualmente confermata al Passo 2) con questo verdetto già scritto da un altro assistente:
--- VERDETTO DA VERIFICARE ---
${risposta}
--- FINE VERDETTO ---

Se la conclusione finale del verdetto coincide con la tua, restituisci il verdetto originale ESATTAMENTE IDENTICO, senza modificarlo nemmeno di una virgola. Se invece il verdetto contraddice la tua conclusione (es. applica un ruling più vecchio nonostante la regola generale più recente indichi il contrario, oppure contiene un errore aritmetico o logico), riscrivi un verdetto corretto in italiano, con lo stesso stile e formato di quello originale, ma con la conclusione del tuo Passo 1/2.

Restituisci SOLO il testo finale del verdetto (originale o corretto) da mostrare all'utente. I marcatori "--- COMPREHENSIVE RULES ---", "--- MAGIC TOURNAMENT RULES ---", "--- VERDETTO DA VERIFICARE ---", "PASSO 1", "PASSO 2", "PASSO 3" e simili sono SOLO struttura interna di QUESTO messaggio, per aiutarti a seguire l'ordine dei passi: non fanno parte del testo del verdetto e non devono MAI apparire nella tua risposta, nemmeno in parte o riformulati. Non mostrare i tuoi passi 1, 2, 3, non spiegare il tuo processo di revisione: la tua risposta deve iniziare direttamente con la prima frase del verdetto stesso, come se il verdetto originale non fosse mai stato preceduto da nessuna etichetta o intestazione.`;

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