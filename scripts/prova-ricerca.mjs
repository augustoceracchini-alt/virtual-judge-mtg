// Banco di prova della ricerca locale nei regolamenti.
//
// Verifica se, date certe parole chiave, la ricerca recupera davvero i blocchi di regolamento
// decisivi. Non chiama Gemini: le parole chiave sono fissate qui invece di essere estratte dalla
// FASE A, quindi la prova è gratuita, istantanea e deterministica. Serve per sapere se una
// modifica alla ricerca migliora o peggiora le cose, invece di indovinarlo.
//
// Importa le funzioni reali di lib/rules.ts (Node stripa i tipi da solo): la prova deve misurare
// il codice che va in produzione, non una copia della sua logica.
//
// Uso: npm run prova-ricerca

import { cercaRegolePertinenti, cercaRegoleTorneo } from "../lib/rules.ts";

// Ogni caso fissa le parole chiave che la FASE A produrrebbe plausibilmente per una domanda, e
// dichiara cosa deve (o non deve) comparire negli estratti restituiti.
//
// "attesi" e "nonVoluti" sono cercati come testo semplice negli estratti: possono essere un numero
// di regola ("714.4") o un'intestazione di capitolo ("[Capitolo 502"), che è il modo più diretto
// per affermare che un capitolo irrilevante non deve essere stato selezionato.
//
// "statoIniziale" documenta l'esito misurato PRIMA delle correzioni al recupero, così un
// fallimento noto non viene confuso con una regressione appena introdotta.
const CASI = [
  {
    nome: "Saga che ha perso le abilità di capitolo",
    fonte: "CR",
    paroleChiave: ["lore counter", "chapter ability", "sacrifice", "state-based action", "permanent"],
    regoleCitate: [],
    attesi: ["714.4"],
    nonVoluti: [],
    statoIniziale: "FALLISCE",
  },
  {
    nome: "Abilità keyword: deathtouch",
    fonte: "CR",
    paroleChiave: ["deathtouch", "lethal damage", "combat damage", "creature"],
    regoleCitate: [],
    attesi: ["702.2"],
    nonVoluti: [],
    statoIniziale: "FALLISCE",
  },
  {
    nome: "Parola chiave 'tap' non deve tirare dentro il passo di stappo",
    fonte: "CR",
    paroleChiave: ["tap", "mana ability", "permanent"],
    regoleCitate: [],
    attesi: [],
    nonVoluti: ["[Capitolo 502"],
    statoIniziale: "FALLISCE",
  },
  {
    nome: "Numero di regola citato esplicitamente",
    fonte: "CR",
    paroleChiave: ["combat damage", "blocking creature"],
    regoleCitate: ["510.1c"],
    attesi: ["510.1c"],
    nonVoluti: [],
    statoIniziale: "PASSA",
  },
  {
    nome: "Danno da combattimento",
    fonte: "CR",
    paroleChiave: ["combat damage", "deathtouch", "lethal damage", "trample"],
    regoleCitate: [],
    attesi: ["510.1"],
    nonVoluti: [],
    statoIniziale: "PASSA",
  },
  {
    nome: "Layer degli effetti continui",
    fonte: "CR",
    paroleChiave: ["layer", "continuous effect", "characteristic"],
    regoleCitate: [],
    attesi: ["613.1"],
    nonVoluti: [],
    statoIniziale: "PASSA",
  },
  {
    // Emerso dallo scenario benchmark a 3 turni: alla domanda se l'abilità del capitolo III si
    // risolva comunque quando Blood Moon arriva mentre è già sulla pila, il giudice ha dato la
    // risposta giusta ma appoggiandosi a un "principio generale della gestione della pila",
    // cioè alla propria memoria, perché la regola che lo dice non era fra gli estratti.
    // Le parole chiave sono quelle REALI prodotte dalla FASE A in quel turno, copiate dal log: con
    // parole scelte a mano il caso passava, perché bastava aggiungere "source" per far salire la
    // 113.7a nella rete di sicurezza globale. Misurato: con queste parole la 113.7a è al rango 47
    // su 721 blocchi con punteggio, e la rete globale ne prende 3.
    nome: "Abilità sulla pila indipendente dalla fonte",
    fonte: "CR",
    paroleChiave: [
      "chapter ability",
      "triggered ability",
      "stack",
      "state-based actions",
      "resolution",
      "continuous effect",
      "Enchantment",
      "Land",
      "Urza",
      "Saga",
    ],
    regoleCitate: [],
    attesi: ["113.7a"],
    nonVoluti: [],
    statoIniziale: "FALLISCE",
  },
  {
    nome: "Corruzione in torneo",
    fonte: "MTR",
    paroleChiave: ["bribery", "wagering", "prize"],
    regoleCitate: [],
    attesi: ["5.2"],
    nonVoluti: [],
    statoIniziale: "PASSA",
  },
  {
    nome: "Sideboard in torneo",
    fonte: "MTR",
    paroleChiave: ["sideboard", "deck registration"],
    regoleCitate: [],
    attesi: ["3.16"],
    nonVoluti: [],
    statoIniziale: "PASSA",
  },
];

function eseguiRicerca(caso) {
  if (caso.fonte === "CR") {
    return cercaRegolePertinenti(caso.paroleChiave, caso.regoleCitate);
  }
  return cercaRegoleTorneo(caso.paroleChiave, caso.regoleCitate);
}

function capitoliNegliEstratti(estratti) {
  const numeri = [...estratti.matchAll(/\[Capitolo (\S+)/g)].map((m) => m[1]);
  return [...new Set(numeri)];
}

function valutaCaso(caso) {
  const estratti = eseguiRicerca(caso);
  const mancanti = caso.attesi.filter((atteso) => !estratti.includes(atteso));
  const indesiderati = caso.nonVoluti.filter((nonVoluto) => estratti.includes(nonVoluto));

  return {
    caso,
    passa: mancanti.length === 0 && indesiderati.length === 0,
    mancanti,
    indesiderati,
    caratteri: estratti.length,
    capitoli: capitoliNegliEstratti(estratti),
  };
}

const esiti = CASI.map(valutaCaso);

for (const esito of esiti) {
  const { caso } = esito;
  const etichetta = esito.passa ? "PASSA   " : "FALLISCE";
  const comeAtteso = esito.passa === (caso.statoIniziale === "PASSA");
  const nota = comeAtteso ? "" : esito.passa ? "   <-- MIGLIORATO" : "   <-- REGRESSIONE";

  console.log(`${etichetta}[${caso.fonte}] ${caso.nome}${nota}`);
  if (esito.mancanti.length > 0) {
    console.log(`        non recuperato: ${esito.mancanti.join(", ")}`);
  }
  if (esito.indesiderati.length > 0) {
    console.log(`        presente ma non voluto: ${esito.indesiderati.join(", ")}`);
  }
  console.log(
    `        ${esito.caratteri} caratteri, capitoli: ${esito.capitoli.join(", ") || "(nessuno)"}`
  );
}

const passati = esiti.filter((e) => e.passa).length;
const regressioni = esiti.filter((e) => !e.passa && e.caso.statoIniziale === "PASSA");
const migliorati = esiti.filter((e) => e.passa && e.caso.statoIniziale === "FALLISCE");

console.log(`\n${passati}/${esiti.length} casi passano`);
if (migliorati.length > 0) {
  console.log(`${migliorati.length} migliorati rispetto allo stato iniziale registrato`);
}
if (regressioni.length > 0) {
  console.log(`${regressioni.length} REGRESSIONI: casi che prima passavano e ora no`);
}

// Codice di uscita diverso da zero solo in caso di regressione: i fallimenti noti sono lo stato di
// partenza da cui vogliamo migliorare, non un motivo per bloccare.
process.exit(regressioni.length > 0 ? 1 : 0);
