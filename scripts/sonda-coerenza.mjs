// Sonda di misura della COERENZA: la stessa domanda, ripetuta N volte, riceve la stessa risposta?
//
//   npm run sonda-coerenza              5 ripetizioni, con la generazione deterministica (il DOPO)
//   npm run sonda-coerenza -- 5 libero  5 ripetizioni SENZA, come si comportava prima (il PRIMA)
//
// Serve a rispondere con un numero a una domanda che finora era un'impressione: quanto cambiano fra
// loro le risposte a parita' di domanda. Va lanciata due volte, con e senza `libero`, e confrontata:
// e' l'unico modo per sapere se la generazione deterministica ha davvero cambiato qualcosa.
//
// Misura DUE cose separate, perche' sono due problemi diversi:
//
//   1. FASE A (l'estrazione delle parole chiave). E' l'amplificatore: parole diverse -> capitoli
//      diversi -> il verdetto parte da fonti diverse. Se qui la variabilita' e' alta, nessuna
//      stabilita' della FASE D puo' salvare la coerenza.
//   2. FASE D (il verdetto). Qui le parole chiave sono FISSATE nel codice, cosi' la misura riguarda
//      solo la scrittura del verdetto e non eredita la variabilita' del passo precedente.
//
// E per la FASE D riporta TRE numeri distinti, che possono raccontare storie molto diverse:
//   - varianti di testo: quante versioni diverse, parola per parola;
//   - varianti delle regole citate: quante liste diverse di numeri di regola;
//   - varianti di conclusione: quante risposte diverse nella sostanza. E' l'unico che conta per
//     l'utente. Puo' benissimo essere 1 (sempre la stessa conclusione) mentre il primo e' 5: in quel
//     caso lo strumento e' gia' coerente e cambia solo il modo di dirlo.
//
// Costo: 2 x N richieste a MODELLO_STANDARD (gemini-3.5-flash-lite), che ha quota generosa — si puo'
// ripetere, a differenza di sonda-fase-e. Con i valori di default sono 10 richieste.
//
// Importa i moduli reali di lib/, comprese le impostazioni di generazione: misura il codice che va
// in produzione, non una copia della sua logica.
import { readFileSync } from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { cercaRegolePertinenti } from "../lib/rules.ts";
import { costruisciPromptEstrazione, costruisciPromptSistema } from "../lib/prompts.ts";
import { MODELLO_STANDARD, CONFIGURAZIONE_DETERMINISTICA } from "../lib/generazione.ts";

for (const riga of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = riga.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

// Il piano gratuito consente 15 richieste al MINUTO per modello, non solo un tetto giornaliero.
// Misurato dal vivo: l'errore 429 riporta "GenerateRequestsPerMinutePerProjectPerModel-FreeTier,
// limit: 15". Questa sonda fa 2 x N richieste una dietro l'altra, quindi senza pausa una passata da
// 10 ripetizioni sfonda il tetto a meta' strada e fa perdere anche le misure gia' raccolte. A 4,5
// secondi il ritmo resta intorno alle 13 al minuto, sotto il limite con un margine.
const PAUSA_FRA_RICHIESTE_MS = 4500;

function attendi(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

// Una richiesta, con la pausa prima e UNA riprova se il tetto scatta lo stesso — puo' succedere se
// la stessa chiave e' usata altrove nello stesso minuto (l'app in locale, un'altra finestra).
// Il messaggio di Google dice quanti secondi aspettare: si usa quello quando c'e'.
async function generaConPausa(model, prompt, etichetta) {
  await attendi(PAUSA_FRA_RICHIESTE_MS);
  try {
    return await model.generateContent(prompt);
  } catch (errore) {
    if (errore?.status !== 429) {
      throw errore;
    }
    const secondi = Number(String(errore.message).match(/retry in (\d+)/i)?.[1] ?? 30) + 2;
    console.log(`  (tetto di 15 richieste al minuto raggiunto durante ${etichetta}: aspetto ${secondi}s e riprovo)`);
    await attendi(secondi * 1000);
    return await model.generateContent(prompt);
  }
}

const RIPETIZIONI = Number(process.argv[2] ?? 5);
const LIBERO = process.argv[3] === "libero";

// Lo scenario di misura e' una Stanza (Room), NON il benchmark Urza's Saga: quel caso ha una nota in
// errata-locali.json che serve al modello la conclusione quasi pronta, quindi misurerebbe una
// coerenza piu' alta di quella reale. La regola decisiva qui e' la 709.5 e nessuna nota la anticipa.
const DOMANDA =
  "Ho in campo una stanza con un solo lato aperto (Roaring Furnace). Quanto e' il costo di mana della stanza?";

// Parole chiave FISSE per la misura della FASE D: sono quelle generiche di un turno reale (lo stesso
// caso di scripts/casi-di-prova.mjs), non quelle ideali. Fissarle isola la scrittura del verdetto
// dalla variabilita' della FASE A, che viene misurata a parte qui sotto.
const PAROLE_FISSE = ["mana cost", "Enchantment", "permanent", "Room"];

// Classificatore APPROSSIMATIVO della conclusione: due espressioni cercate nel testo italiano. Non
// e' un giudice, e' un contatore — per questo la sonda stampa comunque un estratto di ogni variante,
// che resta la verifica vera. Si controlla prima la conclusione corretta, perche' una risposta
// giusta puo' benissimo nominare quella sbagliata per escluderla ("non si sommano entrambi i lati").
const CONCLUSIONI = [
  { etichetta: "solo il lato sbloccato (corretta)", regex: /(sol[oa]|soltanto|unicamente|esclusivamente)[^.]{0,60}(sbloccat|apert)/i },
  { etichetta: "entrambi i lati (sbagliata)", regex: /(entrambi i lati|somma dei due lati|si combina|si sommano)/i },
];

function classificaConclusione(testo) {
  const trovata = CONCLUSIONI.find((c) => c.regex.test(testo));
  return trovata ? trovata.etichetta : "non classificabile a macchina";
}

function numeriDiRegolaCitati(testo) {
  return [...new Set(testo.match(/\b\d{3}\.\d+[a-z]?\b/g) ?? [])].sort().join(", ") || "(nessuna)";
}

// Quante versioni diverse dello stesso valore, e con quale frequenza. Una sola variante = coerenza
// piena su quella misura.
function contaVarianti(valori) {
  const conteggio = new Map();
  for (const valore of valori) {
    conteggio.set(valore, (conteggio.get(valore) ?? 0) + 1);
  }
  return [...conteggio.entries()].sort((a, b) => b[1] - a[1]);
}

function riga(etichetta, varianti) {
  console.log(`  ${etichetta}: ${varianti.length} variant${varianti.length === 1 ? "e" : "i"} su ${RIPETIZIONI} esecuzioni (${varianti.map(([, n]) => n).join(" + ")})`);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel(
  LIBERO ? { model: MODELLO_STANDARD } : { model: MODELLO_STANDARD, generationConfig: CONFIGURAZIONE_DETERMINISTICA }
);

console.log(`Sonda di coerenza — ${RIPETIZIONI} ripetizioni, ${LIBERO ? "SENZA generazione deterministica (il PRIMA)" : "CON generazione deterministica (il DOPO)"}`);
console.log(`Modello: ${MODELLO_STANDARD}`);
console.log(`Domanda: ${DOMANDA}`);
console.log(`Richieste totali: ${RIPETIZIONI * 2}, con ${PAUSA_FRA_RICHIESTE_MS / 1000}s di pausa fra una e l'altra per restare sotto le 15 al minuto del piano gratuito.`);
console.log(`Tempo previsto: circa ${Math.ceil((RIPETIZIONI * 2 * (PAUSA_FRA_RICHIESTE_MS + 2000)) / 60000)} minuti.\n`);

// --- Misura 1: la FASE A produce sempre lo stesso vocabolario? ---
console.log(`FASE A — estrazione delle parole chiave (${RIPETIZIONI} richieste)`);
const promptEstrazione = costruisciPromptEstrazione(DOMANDA, "");
const vocabolari = [];
for (let i = 1; i <= RIPETIZIONI; i++) {
  const risultato = await generaConPausa(model, promptEstrazione, "la FASE A");
  const testo = risultato.response.text().trim().replace(/```json/g, "").replace(/```/g, "").trim();
  let parole = [];
  try {
    const dati = JSON.parse(testo);
    parole = Array.isArray(dati.keywords) ? dati.keywords : [];
  } catch {
    // Stesso comportamento di route.ts: senza parole chiave la ricerca non trova nulla e il giudice
    // finisce a rispondere a memoria. Va contato come una variante a se', non nascosto.
    parole = ["(JSON NON VALIDO)"];
  }
  const canonico = parole.map((p) => String(p).toLowerCase().trim()).sort().join(" | ");
  vocabolari.push(canonico);
  console.log(`  ${i}/${RIPETIZIONI}: ${canonico}`);
}
const variantiVocabolario = contaVarianti(vocabolari);
console.log("");
riga("vocabolari distinti", variantiVocabolario);

// --- Misura 2: a parita' di fonti, il verdetto e' sempre lo stesso? ---
const estratti = cercaRegolePertinenti(PAROLE_FISSE, []);
console.log(`\nFASE D — verdetto a parole chiave fisse (${RIPETIZIONI} richieste)`);
console.log(`  parole chiave fisse: ${PAROLE_FISSE.join(", ")}`);
console.log(`  estratti CR: ${estratti.length} caratteri, la regola decisiva 709.5. c'e'? ${estratti.includes("709.5.") ? "SI" : "NO"}`);

const promptVerdetto = costruisciPromptSistema({
  haImmagine: false,
  errataPertinenti: "",
  estrattiRegole: estratti,
  dataEfficaciaRegole: null,
  estrattiRegoleTorneo: "",
  dataEfficaciaRegoleTorneo: null,
  sezioneCarte: "",
  testoCronologia: "",
  domanda: DOMANDA,
});

const testi = [];
const regole = [];
const conclusioni = [];
for (let i = 1; i <= RIPETIZIONI; i++) {
  const risultato = await generaConPausa(model, promptVerdetto, "la FASE D");
  const testo = risultato.response.text().trim();
  testi.push(testo);
  regole.push(numeriDiRegolaCitati(testo));
  conclusioni.push(classificaConclusione(testo));
  console.log(`  ${i}/${RIPETIZIONI}: ${testo.length} caratteri | regole: ${numeriDiRegolaCitati(testo)} | conclusione: ${classificaConclusione(testo)}`);
}

const variantiTesto = contaVarianti(testi);
const variantiRegole = contaVarianti(regole);
const variantiConclusione = contaVarianti(conclusioni);

console.log("\n--- RISULTATO ---");
riga("FASE A, vocabolari distinti     ", variantiVocabolario);
riga("FASE D, varianti di testo       ", variantiTesto);
riga("FASE D, varianti di regole citate", variantiRegole);
riga("FASE D, varianti di conclusione ", variantiConclusione);

console.log("\nConclusioni osservate (il classificatore e' approssimativo: controllare gli estratti qui sotto):");
for (const [etichetta, quante] of variantiConclusione) {
  const esempio = testi[conclusioni.indexOf(etichetta)].replace(/\s+/g, " ").slice(0, 200);
  console.log(`  ${quante}x  ${etichetta}\n       "${esempio}..."`);
}

console.log("\nCome leggerlo: 1 variante = coerenza piena su quella misura. La riga che conta per");
console.log("l'utente e' l'ultima, la conclusione: se e' a 1 mentre il testo e' a 5, lo strumento e'");
console.log("gia' coerente nella sostanza e cambia solo il modo di dirlo.");
