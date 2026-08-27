// Banco di prova della reazione ai guasti di rete (lib/rete.ts).
//
// Perché serve. Il piano gratuito di Gemini consente 15 richieste al MINUTO per modello e ogni
// domanda dell'utente ne consuma 2 o 3: il 429 non è un caso di scuola, è il modo più probabile in
// cui l'app fallisce davvero in mano a qualcuno. Fino a qui quel guasto diventava un 500 con un
// messaggio generico, e l'utente non poteva sapere che bastava aspettare un minuto.
//
// Il punto è che questo comportamento è, per sua natura, quasi impossibile da provare a mano: per
// vederlo bisognerebbe esaurire la quota apposta, e per vedere il ramo "riprova e la seconda volta
// va bene" bisognerebbe esaurirla nel mezzo di una richiesta. Un banco di prova con errori
// costruiti a tavolino è l'unico modo di verificarlo, ed è gratuito e istantaneo.
//
// Come `prova-estrazione.mjs`: importa le funzioni reali di lib/ (Node stripa i tipi da solo),
// quindi prova il codice che va in produzione e non una copia della sua logica — è il motivo per
// cui `lib/rete.ts` non usa l'alias `@/`, che Node non risolve. Non chiama Gemini, non tocca la
// rete e non aspetta davvero: la funzione di attesa viene sostituita con una finta, altrimenti una
// passata completa dormirebbe una decina di secondi e non la lancerebbe più nessuno.
//
// Ogni caso è un'affermazione su cosa la funzione DEVE fare, quindi un caso rosso è un difetto e
// l'uscita è diversa da zero.
//
// Uso: npm run prova-rete

import {
  classificaErroreGemini,
  attesaSuggeritaDaGemini,
  attesaPrimaDiRiprovare,
  eseguiConRiprova,
  rispostaPerGuasto,
  ATTESA_PREDEFINITA_MS,
  MASSIMA_ATTESA_RIPROVA_MS,
} from "../lib/rete.ts";

// Un errore come lo costruisce davvero @google/generative-ai quando il server risponde male:
// classe che estende Error, campo `status` numerico, e il messaggio con lo stato fra parentesi
// quadre. Ricalcato su handleResponseNotOk in node_modules/@google/generative-ai/dist/index.mjs.
function erroreHttpGemini(stato, testoStato, coda = "", dettagli = undefined) {
  const errore = new Error(
    `[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent: [${stato} ${testoStato}] ${coda}`
  );
  errore.status = stato;
  errore.statusText = testoStato;
  if (dettagli !== undefined) {
    errore.errorDetails = dettagli;
  }
  return errore;
}

// Il 429 vero del piano gratuito: porta con sé un blocco RetryInfo con il tempo di attesa.
function errore429ConAttesa(secondi) {
  const dettagli = [
    {
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [{ quotaMetric: "generate_requests_per_model", quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "15" }],
    },
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: `${secondi}s` },
  ];
  return erroreHttpGemini(429, "Too Many Requests", `Quota exceeded ${JSON.stringify(dettagli)}`, dettagli);
}

// L'annullamento per scadenza, come lo riscrive la libreria. ATTENZIONE al dettaglio che questo
// caso protegge: `GoogleGenerativeAIAbortError` NON imposta `this.name`, quindi il suo `name` vale
// "Error" come quello di qualunque altro errore. Riconoscerlo dal nome non funziona, e questo caso
// esiste perché nessuno ci riprovi.
function erroreAnnullamentoGemini() {
  return new Error(
    "[GoogleGenerativeAI Error]: Request aborted when fetching https://generativelanguage.googleapis.com/v1beta/models/x:generateContent: This operation was aborted"
  );
}

// Il nostro AbortSignal.timeout() su Scryfall: qui il `name` c'è davvero, perché è un DOMException.
function erroreScadenzaScryfall() {
  const errore = new Error("The operation was aborted due to timeout");
  errore.name = "TimeoutError";
  return errore;
}

function erroreDiRete() {
  return new Error(
    "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/x:generateContent: fetch failed"
  );
}

const CASI_CLASSIFICAZIONE = [
  { nome: "429: il tetto di richieste del piano gratuito", errore: errore429ConAttesa(27), atteso: "quota" },
  { nome: "503: servizio sovraccarico dalla parte di Google", errore: erroreHttpGemini(503, "Service Unavailable"), atteso: "sovraccarico" },
  { nome: "500: guasto interno di Google", errore: erroreHttpGemini(500, "Internal Server Error"), atteso: "sovraccarico" },
  { nome: "504: Google non risponde in tempo", errore: erroreHttpGemini(504, "Gateway Timeout"), atteso: "sovraccarico" },
  { nome: "400: richiesta malformata, riprovare e' inutile", errore: erroreHttpGemini(400, "Bad Request"), atteso: "definitivo" },
  { nome: "403: chiave API sbagliata o senza permessi", errore: erroreHttpGemini(403, "Forbidden"), atteso: "definitivo" },
  { nome: "404: nome del modello inesistente", errore: erroreHttpGemini(404, "Not Found"), atteso: "definitivo" },
  { nome: "annullamento per scadenza (il `name` vale \"Error\", non \"AbortError\")", errore: erroreAnnullamentoGemini(), atteso: "timeout" },
  { nome: "scadenza del nostro AbortSignal.timeout() su Scryfall", errore: erroreScadenzaScryfall(), atteso: "timeout" },
  { nome: "la richiesta non e' nemmeno partita", errore: erroreDiRete(), atteso: "rete" },
  { nome: "un errore di programmazione non e' un guasto di rete", errore: new TypeError("p.trim is not a function"), atteso: "sconosciuto" },
  { nome: "null non fa esplodere la classificazione", errore: null, atteso: "sconosciuto" },
  { nome: "una stringa lanciata al posto di un errore", errore: "qualcosa e' andato storto", atteso: "sconosciuto" },
  { nome: "un 429 nel TESTO ma senza stato non e' un guasto di quota", errore: new Error("Error fetching from https://esempio/429: fetch failed"), atteso: "rete" },
];

const CASI_ATTESA_SUGGERITA = [
  { nome: "RetryInfo con 27 secondi", errore: errore429ConAttesa(27), atteso: 27000 },
  { nome: "RetryInfo con decimali", errore: errore429ConAttesa(3.5), atteso: 3500 },
  { nome: "solo nel messaggio, senza errorDetails", errore: erroreHttpGemini(429, "Too Many Requests", 'Quota exceeded {"retryDelay":"12s"}'), atteso: 12000 },
  { nome: "un 503 senza alcun suggerimento", errore: erroreHttpGemini(503, "Service Unavailable"), atteso: null },
  { nome: "null non fa esplodere la lettura del suggerimento", errore: null, atteso: null },
];

const CASI_ATTESA_RIPROVA = [
  { nome: "429 con attesa breve: si aspetta quel tempo", errore: errore429ConAttesa(3), atteso: 3000 },
  { nome: "429 con attesa oltre la soglia: si rinuncia invece di stare fermi", errore: errore429ConAttesa(27), atteso: null },
  { nome: "429 senza suggerimento (quota giornaliera): riprovare non serve", errore: erroreHttpGemini(429, "Too Many Requests"), atteso: null },
  { nome: "503: pausa predefinita", errore: erroreHttpGemini(503, "Service Unavailable"), atteso: ATTESA_PREDEFINITA_MS },
  { nome: "rete caduta: pausa predefinita", errore: erroreDiRete(), atteso: ATTESA_PREDEFINITA_MS },
  { nome: "scadenza: NON si riprova (il tempo gliel'avevamo gia' dato)", errore: erroreAnnullamentoGemini(), atteso: null },
  { nome: "400: non si riprova", errore: erroreHttpGemini(400, "Bad Request"), atteso: null },
  { nome: "errore sconosciuto: non si insiste alla cieca", errore: new TypeError("boom"), atteso: null },
];

const CASI_RISPOSTA = [
  { nome: "quota -> 429, e il messaggio dice di aspettare", tipo: "quota", codiceAtteso: 429, deveContenere: "aspetta un minuto" },
  { nome: "sovraccarico -> 503", tipo: "sovraccarico", codiceAtteso: 503, deveContenere: "sovraccarico" },
  { nome: "timeout -> 504", tipo: "timeout", codiceAtteso: 504, deveContenere: "troppo tempo" },
  { nome: "rete -> 502", tipo: "rete", codiceAtteso: 502, deveContenere: "contattare" },
  { nome: "definitivo -> 500 e messaggio generico", tipo: "definitivo", codiceAtteso: 500, deveContenere: "Si è verificato un errore" },
  { nome: "sconosciuto -> 500 e messaggio generico", tipo: "sconosciuto", codiceAtteso: 500, deveContenere: "Si è verificato un errore" },
];

// Una finta operazione di rete che fallisce nei modi decisi dal chiamante e poi riesce. Registra
// quante volte e' stata chiamata, che e' il numero che dice davvero se la riprova e' avvenuta.
function operazioneFinta(guasti, valoreFinale = "risposta di Gemini") {
  const daLanciare = [...guasti];
  const stato = { chiamate: 0 };
  const operazione = async () => {
    stato.chiamate++;
    if (daLanciare.length > 0) {
      throw daLanciare.shift();
    }
    return valoreFinale;
  };
  return { operazione, stato };
}

const CASI_RIPROVA = [
  {
    nome: "va bene al primo colpo: nessuna riprova, nessuna attesa",
    guasti: [],
    chiamateAttese: 1,
    atteseAttese: [],
    esitoAtteso: { tipo: "valore", valore: "risposta di Gemini" },
  },
  {
    nome: "503 e poi funziona: la risposta arriva lo stesso",
    guasti: [erroreHttpGemini(503, "Service Unavailable")],
    chiamateAttese: 2,
    atteseAttese: [ATTESA_PREDEFINITA_MS],
    esitoAtteso: { tipo: "valore", valore: "risposta di Gemini" },
  },
  {
    nome: "429 con attesa breve e poi funziona: si aspetta il tempo chiesto da Google",
    guasti: [errore429ConAttesa(2)],
    chiamateAttese: 2,
    atteseAttese: [2000],
    esitoAtteso: { tipo: "valore", valore: "risposta di Gemini" },
  },
  {
    nome: "503 due volte: si riprova UNA volta sola, poi l'errore risale",
    guasti: [erroreHttpGemini(503, "Service Unavailable"), erroreHttpGemini(503, "Service Unavailable")],
    chiamateAttese: 2,
    atteseAttese: [ATTESA_PREDEFINITA_MS],
    esitoAtteso: { tipo: "errore", tipoGuasto: "sovraccarico" },
  },
  {
    nome: "400: si rinuncia subito, senza sprecare una seconda chiamata",
    guasti: [erroreHttpGemini(400, "Bad Request")],
    chiamateAttese: 1,
    atteseAttese: [],
    esitoAtteso: { tipo: "errore", tipoGuasto: "definitivo" },
  },
  {
    nome: "429 con quota giornaliera finita: si rinuncia subito",
    guasti: [erroreHttpGemini(429, "Too Many Requests")],
    chiamateAttese: 1,
    atteseAttese: [],
    esitoAtteso: { tipo: "errore", tipoGuasto: "quota" },
  },
  {
    nome: "scadenza: NIENTE seconda chiamata (e' cio' che tiene limitata la durata totale)",
    guasti: [erroreAnnullamentoGemini()],
    chiamateAttese: 1,
    atteseAttese: [],
    esitoAtteso: { tipo: "errore", tipoGuasto: "timeout" },
  },
];

let falliti = 0;

function verifica(nome, ottenuto, atteso) {
  const ottenutoTesto = JSON.stringify(ottenuto);
  const attesoTesto = JSON.stringify(atteso);
  if (ottenutoTesto === attesoTesto) {
    console.log(`OK      ${nome}`);
    return;
  }
  falliti++;
  console.log(`FALLITO ${nome}`);
  console.log(`        atteso:   ${attesoTesto}`);
  console.log(`        ottenuto: ${ottenutoTesto}`);
}

console.log("classificaErroreGemini — che tipo di guasto e'\n");
for (const caso of CASI_CLASSIFICAZIONE) {
  verifica(caso.nome, classificaErroreGemini(caso.errore), caso.atteso);
}

console.log("\nattesaSuggeritaDaGemini — quanto Google chiede di aspettare\n");
for (const caso of CASI_ATTESA_SUGGERITA) {
  verifica(caso.nome, attesaSuggeritaDaGemini(caso.errore), caso.atteso);
}

console.log(`\nattesaPrimaDiRiprovare — se e quanto aspettare (soglia: ${MASSIMA_ATTESA_RIPROVA_MS} ms)\n`);
for (const caso of CASI_ATTESA_RIPROVA) {
  verifica(caso.nome, attesaPrimaDiRiprovare(caso.errore), caso.atteso);
}

console.log("\nrispostaPerGuasto — cosa vede l'utente\n");
for (const caso of CASI_RISPOSTA) {
  const { messaggio, codiceHttp } = rispostaPerGuasto(caso.tipo);
  verifica(`${caso.nome} (codice)`, codiceHttp, caso.codiceAtteso);
  verifica(`${caso.nome} (testo)`, messaggio.includes(caso.deveContenere), true);
}

console.log("\neseguiConRiprova — quante chiamate vengono fatte davvero\n");

for (const caso of CASI_RIPROVA) {
  const { operazione, stato } = operazioneFinta(caso.guasti);
  const attese = [];
  // L'attesa e' finta: registra il tempo che AVREBBE atteso e torna subito. Senza questo, provare
  // il ramo "429 con 2 secondi" costerebbe due secondi reali per ogni caso.
  const attendi = async (ms) => {
    attese.push(ms);
  };

  let esito;
  try {
    const valore = await eseguiConRiprova(operazione, "prova", { attendi, registraAvviso: () => {} });
    esito = { tipo: "valore", valore };
  } catch (errore) {
    esito = { tipo: "errore", tipoGuasto: classificaErroreGemini(errore) };
  }

  verifica(`${caso.nome} (esito)`, esito, caso.esitoAtteso);
  verifica(`${caso.nome} (chiamate)`, stato.chiamate, caso.chiamateAttese);
  verifica(`${caso.nome} (attese)`, attese, caso.atteseAttese);
}

const totale =
  CASI_CLASSIFICAZIONE.length +
  CASI_ATTESA_SUGGERITA.length +
  CASI_ATTESA_RIPROVA.length +
  CASI_RISPOSTA.length * 2 +
  CASI_RIPROVA.length * 3;

console.log(`\n${totale - falliti}/${totale} casi passano`);

if (falliti > 0) {
  console.log(`${falliti} FALLITI: la reazione ai guasti di rete non fa quello che deve.`);
}

process.exit(falliti > 0 ? 1 : 0);
