// Sonda diagnostica (NON un banco di prova): misura DOVE va il tempo della FASE E.
//
//   npm run sonda-fase-e                 verdetto corretto, nessun limite di ragionamento
//   npm run sonda-fase-e -- 256          verdetto corretto, budget di ragionamento 256
//   npm run sonda-fase-e -- 256 sbagliato   verdetto INVERTITO: la FASE E deve correggerlo
//
// Le due direzioni vanno provate ENTRAMBE, perche' un budget che accorcia i tempi ma non fa piu'
// scattare la correzione e' un guadagno finto, e uno che fa riscrivere un verdetto gia' giusto e'
// un danno. La sonda non passa la nota di errata-locali.json: il modello deve arrivarci dalle sole
// regole, che e' il caso normale e anche il piu' severo.
// Chiama Gemini davvero, quindi consuma la quota stretta di gemini-3.6-flash (~20/giorno).
//
// La domanda a cui risponde: la FASE E è lenta perché LEGGE tanto (36.000 caratteri di
// regolamenti) o perché SCRIVE tanto (deve ricopiare l'intero verdetto anche quando è d'accordo)?
// I due casi si distinguono guardando i token: promptTokenCount contro candidatesTokenCount
// più thoughtsTokenCount.
import { readFileSync } from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { cercaRegolePertinenti } from "../lib/rules.ts";
import { costruisciPromptVerifica } from "../lib/prompts.ts";
import { MODELLO_VERIFICA, CONFIGURAZIONE_DETERMINISTICA } from "../lib/generazione.ts";

for (const riga of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = riga.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const PAROLE = ["enchantment", "land", "lore counter", "ability", "type-changing effect", "Urza", "Saga"];
const DOMANDA = "Ho Urza's Saga in gioco al secondo capitolo e il mio avversario lancia Blood Moon. Cosa succede?";
const VERDETTO = `Urza's Saga NON viene sacrificata. Ecco il ragionamento:

1. **Effetto di Blood Moon:** poiché Urza's Saga è una terra non base, Blood Moon ne imposta il tipo a Mountain (regola 305.7) e le fa perdere tutte le abilità generate dal proprio testo di regole, incluse le abilità di capitolo.
2. **Abilità già concesse:** la 305.7 non rimuove le abilità già concesse da altri effetti, quindi quelle conferite dai capitoli I e II sopravvivono e restano utilizzabili.
3. **Nessun sacrificio:** la regola 714.4 richiede che la Saga ABBIA una o più abilità di capitolo perché il sacrificio scatti. Blood Moon gliele ha rimosse, quindi la condizione non è soddisfatta e la Saga resta sul campo di battaglia.`;

// Secondo argomento "sbagliato": sottopone alla verifica un verdetto con la conclusione INVERTITA.
// E' il test che conta davvero: la FASE E esiste per correggere, non per confermare. Un budget di
// ragionamento che accorcia i tempi ma non fa piu' scattare la correzione e' un guadagno finto.
const VERDETTO_SBAGLIATO = `Urza's Saga VIENE sacrificata. Ecco il ragionamento:

1. **Effetto di Blood Moon:** poiché Urza's Saga è una terra non base, Blood Moon ne imposta il tipo a Mountain (regola 305.7) e le fa perdere tutte le abilità generate dal proprio testo di regole, incluse le abilità di capitolo.
2. **Sacrificio immediato:** la regola 714.4 prevede che una Saga venga sacrificata quando NON ha più abilità di capitolo. Avendogliele Blood Moon rimosse tutte, la condizione è soddisfatta e la Saga viene sacrificata come azione basata sullo stato.`;

const usaSbagliato = process.argv[3] === "sbagliato";
const verdettoDaVerificare = usaSbagliato ? VERDETTO_SBAGLIATO : VERDETTO;

const estrattiRegole = cercaRegolePertinenti(PAROLE, []);
const input = {
  errataPertinenti: "",
  estrattiRegole,
  estrattiRegoleTorneo: "",
  sezioneCarte: "",
  testoCronologia: "",
  domanda: DOMANDA,
  risposta: verdettoDaVerificare,
};

const prompt = costruisciPromptVerifica(input);
console.log("caratteri del prompt inviato:", prompt.length);
console.log("verdetto sottoposto:", usaSbagliato ? "SBAGLIATO (deve essere corretto)" : "corretto (deve essere confermato)");

// Primo argomento: budget di ragionamento da provare (vuoto = nessun limite).
//
// Alla configurazione si aggiunge SEMPRE CONFIGURAZIONE_DETERMINISTICA, presa da lib/generazione.ts:
// la sonda deve misurare la FASE E com'e' davvero in produzione, e in produzione la verifica gira a
// temperatura 0. Prima questo script costruiva il proprio generationConfig con il solo budget, quindi
// misurava una FASE E che non esiste piu': due richieste della quota stretta (~20 al giorno) spese
// senza rispondere alla domanda per cui si lancia la sonda.
const budget = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
const generationConfig = {
  ...CONFIGURAZIONE_DETERMINISTICA,
  ...(budget === null ? {} : { thinkingConfig: { thinkingBudget: budget } }),
};
console.log("budget di ragionamento richiesto:", budget === null ? "nessun limite" : budget);
console.log("generazione deterministica:", JSON.stringify(CONFIGURAZIONE_DETERMINISTICA));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODELLO_VERIFICA, generationConfig });

const t0 = Date.now();
const r = await model.generateContent(prompt);
const durata = Date.now() - t0;
const testo = r.response.text().trim();
const u = r.response.usageMetadata ?? {};

console.log("\n===== DOVE VA IL TEMPO =====");
console.log("durata totale:            ", durata, "ms");
console.log("token LETTI (prompt):     ", u.promptTokenCount);
console.log("token di ragionamento:    ", u.thoughtsTokenCount ?? "(non riportati)");
console.log("token SCRITTI (risposta): ", u.candidatesTokenCount);
console.log("token totali:             ", u.totalTokenCount);
console.log("\ncaratteri restituiti:", testo.length, "- identico al verdetto?", testo === VERDETTO);

console.log("\n===== TESTO RESTITUITO =====");
console.log(testo);
console.log("\n===== ESITO =====");
console.log(/NON\s+viene\s+sacrificat/i.test(testo)
  ? "conclusione CORRETTA: non viene sacrificata"
  : "ATTENZIONE, conclusione SBAGLIATA o ambigua");
