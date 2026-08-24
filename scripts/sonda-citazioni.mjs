// Sonda di misura per il difetto della 113.7a: il giudice dà la conclusione giusta ma PARAFRASA la
// regola invece di citarne il numero, pur avendola fra gli estratti.
//
// Ripete la stessa domanda N volte sulla sola FASE D e conta quante volte il numero compare. Usa
// MODELLO_STANDARD (gemini-3.5-flash-lite), che ha quota generosa: si può ripetere, a differenza
// della FASE E. Serve a misurare il tasso PRIMA e DOPO una modifica al prompt, invece di giudicare
// da una singola esecuzione un comportamento che è variabile per natura.
import { readFileSync } from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { cercaRegolePertinenti } from "../lib/rules.ts";
import { costruisciPromptSistema } from "../lib/prompts.ts";

for (const riga of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = riga.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const RIPETIZIONI = Number(process.argv[2] ?? 5);
const REGOLA_ATTESA = "113.7a";

// Parole chiave plausibili per il terzo turno del banco di prova: l'abilità del capitolo III è già
// sulla pila quando Blood Moon risolve.
const PAROLE = ["triggered ability", "stack", "source", "ability", "independent", "Saga", "chapter ability"];

const CRONOLOGIA = `Utente: Ho Urza's Saga in gioco al secondo capitolo e il mio avversario lancia Blood Moon. Cosa succede?

Giudice: Urza's Saga NON viene sacrificata: la 714.4 richiede che la Saga abbia una o più abilità di capitolo, e Blood Moon (305.7) gliele ha rimosse.`;

const DOMANDA = "E se il mio avversario avesse aspettato il terzo capitolo, lanciando Blood Moon con l'abilità del terzo capitolo già sulla pila? Il tutor si risolve comunque?";

const estrattiRegole = cercaRegolePertinenti(PAROLE, []);

console.log("La regola", REGOLA_ATTESA, "è negli estratti?", estrattiRegole.includes(REGOLA_ATTESA) ? "SÌ" : "NO — la misura non avrebbe senso");
console.log("caratteri di estratti:", estrattiRegole.length);
if (!estrattiRegole.includes(REGOLA_ATTESA)) process.exit(1);

const prompt = costruisciPromptSistema({
  haImmagine: false,
  errataPertinenti: "",
  estrattiRegole,
  dataEfficaciaRegole: null,
  estrattiRegoleTorneo: "",
  dataEfficaciaRegoleTorneo: null,
  sezioneCarte: "",
  testoCronologia: CRONOLOGIA,
  domanda: DOMANDA,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash-lite" });

let cita = 0;
for (let i = 1; i <= RIPETIZIONI; i++) {
  const r = await model.generateContent(prompt);
  const testo = r.response.text();
  const laCita = testo.includes(REGOLA_ATTESA);
  if (laCita) cita++;
  console.log(`  ${i}/${RIPETIZIONI}: ${laCita ? "CITA " + REGOLA_ATTESA : "parafrasa (nessun numero)"}`);
}

console.log(`\nRISULTATO: ${cita}/${RIPETIZIONI} esecuzioni citano ${REGOLA_ATTESA}`);
