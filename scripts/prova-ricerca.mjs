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
import { CASI } from "./casi-di-prova.mjs";

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
