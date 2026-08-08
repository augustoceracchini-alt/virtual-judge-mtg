// Sonda di copertura delle discussioni della community (Board Games Stack Exchange).
//
// A cosa serve: misurare, PRIMA di toccare l'app, quanto aiuterebbero davvero le spiegazioni scritte
// dagli umani. È la stessa ragione per cui esiste scripts/prova-ricerca.mjs: raccogliere numeri
// invece di tirare a indovinare. Questa sonda non modifica nulla e non è collegata all'endpoint.
//
// Non chiama Gemini: i termini di ricerca sono fissati nei casi qui sotto, come in prova-ricerca.mjs,
// quindi girare la sonda è gratuito e ripetibile. Consuma però la quota dell'API di Stack Exchange
// (300 richieste al giorno senza chiave): una richiesta per caso.
//
// Importa la funzione reale di lib/discussioni.ts (Node stripa i tipi da solo): la sonda deve
// misurare il codice che andrebbe in produzione, non una copia della sua logica.
//
// Uso: npm run prova-copertura

import { cercaDiscussioniPertinenti } from "../lib/discussioni.ts";
import { getDataEfficaciaRegole } from "../lib/rules.ts";

// Ogni caso fissa i termini con cui si cercherebbe la discussione. `carte` ha la priorità (è il
// segnale più forte); `paroleChiave` viene usata solo quando non ci sono nomi di carta, così un caso
// senza carte prova anche quella strada.
//
// I primi casi sono quelli già usati come banco di prova in questo progetto. Il caso Urza's Saga +
// Blood Moon fa anche da controllo della sonda stessa: se non trova la 714.4, è la sonda a essere
// rotta, non la fonte.
const CASI = [
  {
    domanda: "Blood Moon su Urza's Saga: la devo sacrificare?",
    carte: ["Urza's Saga", "Blood Moon"],
    paroleChiave: [],
  },
  {
    domanda: "Lightning Bolt fa danno letale a una creatura con deathtouch?",
    carte: ["Lightning Bolt"],
    paroleChiave: ["deathtouch", "lethal damage"],
  },
  {
    domanda: "Una Saga che perde le abilità di capitolo va sacrificata?",
    carte: [],
    paroleChiave: ["saga", "lore counter", "chapter ability", "sacrifice"],
  },
  {
    domanda: "In che ordine si applicano gli effetti continui (layer)?",
    carte: [],
    paroleChiave: ["layers", "continuous effects", "characteristic"],
  },
  {
    domanda: "Come funziona l'ordine di assegnazione del danno con più bloccanti?",
    carte: [],
    paroleChiave: ["damage assignment order", "blocking creatures"],
  },
  {
    domanda: "Posso cambiare mazzo col sideboard fra le partite?",
    carte: [],
    paroleChiave: ["sideboard", "between games", "tournament"],
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ⬇ AGGIUNGI QUI le domande su cui Google ti ha dato una risposta migliore del Judge.
  //   Copia il blocco di uno dei casi sopra e cambia i tre campi:
  //     domanda      = la domanda in italiano (serve solo per leggere il rapporto)
  //     carte        = i nomi ESATTI IN INGLESE delle carte coinvolte (max 3), oppure []
  //     paroleChiave = termini di regolamento in inglese, usati solo se `carte` è vuoto
  // ─────────────────────────────────────────────────────────────────────────────────────────────
];

const dataEfficaciaRegole = getDataEfficaciaRegole();
const dataEfficaciaMs = dataEfficaciaRegole ? new Date(dataEfficaciaRegole).getTime() : null;

function anteprima(testo, caratteri = 220) {
  const unaRiga = testo.replace(/\s+/g, " ").trim();
  return unaRiga.length > caratteri ? `${unaRiga.slice(0, caratteri)}…` : unaRiga;
}

async function valutaCaso(caso) {
  const esito = await cercaDiscussioniPertinenti(caso.carte, caso.paroleChiave);
  const migliore = esito.discussioni[0] ?? null;
  const risposta = migliore?.miglioreRisposta ?? null;

  return {
    caso,
    query: esito.query,
    quantitaDiscussioni: esito.discussioni.length,
    discussione: migliore,
    risposta,
    quotaRimanente: esito.quotaRimanente,
  };
}

const esiti = [];
for (const caso of CASI) {
  esiti.push(await valutaCaso(caso));
}

for (const esito of esiti) {
  const { caso, risposta, discussione } = esito;

  if (!discussione) {
    console.log(`NESSUNA  ${caso.domanda}`);
    console.log(`         query usata: "${esito.query}" — nessuna discussione trovata`);
    console.log("");
    continue;
  }

  const etichetta = risposta ? "TROVATA " : "SENZA-R.";
  console.log(`${etichetta} ${caso.domanda}`);
  console.log(`         query usata: "${esito.query}" (${esito.quantitaDiscussioni} discussioni)`);
  console.log(`         "${discussione.titolo}" — ${discussione.votiDomanda} voti alla domanda`);
  console.log(`         ${discussione.link}`);

  if (!risposta) {
    console.log("         la discussione non ha risposte");
    console.log("");
    continue;
  }

  const accettata = risposta.accettata ? "accettata" : "non accettata";
  const modifica = risposta.ultimaModifica ?? "mai modificata dopo la pubblicazione";
  console.log(
    `         risposta: ${risposta.voti} voti, ${accettata}, ${risposta.testo.length} caratteri, ultima modifica ${modifica}`
  );
  console.log(`         regole CR citate: ${risposta.regoleCitate.join(", ") || "(nessuna)"}`);
  console.log(`         inizio risposta: ${anteprima(risposta.testo)}`);
  console.log("");
}

// ── Riepilogo ────────────────────────────────────────────────────────────────────────────────────
const conRisposta = esiti.filter((e) => e.risposta !== null);
const conRegoleCitate = conRisposta.filter((e) => e.risposta.regoleCitate.length > 0);
const conRispostaAccettata = conRisposta.filter((e) => e.risposta.accettata);
const modificateDopoLeCr = conRisposta.filter((e) => {
  if (dataEfficaciaMs === null || e.risposta.ultimaModifica === null) {
    return false;
  }
  return new Date(e.risposta.ultimaModifica).getTime() >= dataEfficaciaMs;
});

const lunghezze = conRisposta.map((e) => e.risposta.testo.length);
const lunghezzaMedia =
  lunghezze.length > 0 ? Math.round(lunghezze.reduce((a, b) => a + b, 0) / lunghezze.length) : 0;

console.log("─".repeat(80));
console.log(`${conRisposta.length}/${esiti.length} casi hanno una discussione con almeno una risposta`);
console.log(`${conRispostaAccettata.length}/${esiti.length} hanno una risposta accettata`);
console.log(`${conRegoleCitate.length}/${esiti.length} citano almeno un numero di regola CR`);

// Segnale di allarme scoperto misurando: quando la ricerca prende una discussione fuori tema, la
// risposta non cita alcun numero di regola. È un filtro automatico di pertinenza quasi gratuito.
const senzaRegoleCitate = conRisposta.filter((e) => e.risposta.regoleCitate.length === 0);
if (senzaRegoleCitate.length > 0) {
  console.log(
    `⚠ ${senzaRegoleCitate.length} risposta/e trovata/e NON cita/no regole — probabile fuori tema:`
  );
  for (const e of senzaRegoleCitate) {
    console.log(`   "${e.caso.domanda}" → query "${e.query}" → "${e.discussione.titolo}"`);
  }
}
console.log(
  `${modificateDopoLeCr.length}/${esiti.length} sono state modificate dopo l'ultimo aggiornamento delle CR locali (${dataEfficaciaRegole ?? "data non disponibile"})`
);
console.log(`Lunghezza media delle risposte: ${lunghezzaMedia} caratteri (peso stimato nel prompt)`);

const votiRisposte = conRisposta.map((e) => e.risposta.voti).sort((a, b) => a - b);
if (votiRisposte.length > 0) {
  console.log(`Voti delle risposte, dal più basso al più alto: ${votiRisposte.join(", ")}`);
  console.log("   (serve a scegliere una soglia minima di voti sui dati, invece che a intuito)");
}

const ultimaQuota = esiti.map((e) => e.quotaRimanente).filter((q) => q !== null).pop();
if (ultimaQuota !== undefined) {
  console.log(`Quota API rimanente oggi: ${ultimaQuota} richieste su 300`);
}

// Nota sulla data di modifica: una risposta modificata PRIMA dell'ultimo aggiornamento delle CR non
// è automaticamente superata (la regola di cui parla può non essere cambiata). È solo un indizio su
// quanto la spiegazione è tenuta viva, non un verdetto.

// Sempre codice di uscita 0: è una sonda di misura, non un test che deve passare.
process.exit(0);
