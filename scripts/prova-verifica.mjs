// Misura su quanti casi scatta la FASE E, il doppio controllo del verdetto.
//
// Perché serve: la FASE E è costata 7,5 secondi su 11,5 in una richiesta reale misurata, cioè due
// terzi del tempo totale. Ma non scatta sempre: parte solo se negli estratti di regolamento
// compare una regola condizionale a più clausole. Se scatta quasi sempre, quei 7,5 secondi sono il
// costo ordinario dell'app e vale la pena intervenire; se scatta di rado, l'app è normalmente
// veloce (2,3 s misurati senza FASE E) e non c'è niente da ottimizzare.
//
// Come `prova-ricerca.mjs`: importa le funzioni reali di lib/ (Node stripa i tipi da solo), quindi
// misura il codice che va in produzione e non una copia della sua logica. Non chiama Gemini, non
// tocca la rete: gratuito, istantaneo, deterministico.
//
// Nota di fedeltà: il rilevatore riceve la CONCATENAZIONE degli estratti CR e MTR, esattamente
// come in route.ts (`tutteLeFonti`), quindi entrambe le ricerche vengono eseguite per ogni caso,
// anche quando il caso è pensato per una sola delle due fonti.
//
// Questa prova NON copre l'altro innesco della FASE E, le citazioni senza fonte: quello dipende dal
// verdetto prodotto da Gemini, che qui non viene chiamato. Il numero misurato è quindi il MINIMO:
// nella realtà la FASE E scatta almeno così spesso.
//
// Uso: npm run prova-verifica

import { cercaRegolePertinenti, cercaRegoleTorneo } from "../lib/rules.ts";
import { contieneRegolaCondizionaleComplessa, INDICATORI_REGOLA_CONDIZIONALE } from "../lib/verifica.ts";
import { CASI } from "./casi-di-prova.mjs";

// Quali indicatori hanno fatto scattare la verifica in questo caso: se uno solo è responsabile di
// quasi tutti gli scatti, è lì che si interviene per renderlo più selettivo.
function indicatoriTrovati(testoFonti) {
  const normalizzato = testoFonti.toLowerCase().replace(/[‘’]/g, "'");
  return INDICATORI_REGOLA_CONDIZIONALE.filter((indicatore) => normalizzato.includes(indicatore));
}

const esiti = CASI.map((caso) => {
  const estrattiRegole = cercaRegolePertinenti(caso.paroleChiave, caso.regoleCitate);
  const estrattiRegoleTorneo = cercaRegoleTorneo(caso.paroleChiave, caso.regoleCitate);
  const tutteLeFonti = `${estrattiRegole}\n${estrattiRegoleTorneo}`;

  return {
    nome: caso.nome,
    scatta: contieneRegolaCondizionaleComplessa(tutteLeFonti),
    indicatori: indicatoriTrovati(tutteLeFonti),
    caratteri: tutteLeFonti.length,
  };
});

for (const esito of esiti) {
  const etichetta = esito.scatta ? "SCATTA " : "NO     ";
  console.log(`${etichetta} ${esito.nome}`);
  console.log(`        ${esito.caratteri} caratteri di fonti` + (esito.scatta ? ` — per: ${esito.indicatori.join(" | ")}` : ""));
}

const scattati = esiti.filter((esito) => esito.scatta).length;
const percentuale = Math.round((scattati / esiti.length) * 100);

console.log(`\n${scattati}/${esiti.length} casi fanno scattare la FASE E (${percentuale}%)`);

// Conteggio per indicatore: dice quale frase è responsabile degli scatti, non solo quanti sono.
const conteggioPerIndicatore = new Map();
for (const esito of esiti) {
  for (const indicatore of esito.indicatori) {
    conteggioPerIndicatore.set(indicatore, (conteggioPerIndicatore.get(indicatore) ?? 0) + 1);
  }
}

if (conteggioPerIndicatore.size > 0) {
  console.log("\nQuante volte ha agganciato ciascun indicatore:");
  const ordinati = [...conteggioPerIndicatore.entries()].sort((a, b) => b[1] - a[1]);
  for (const [indicatore, quante] of ordinati) {
    console.log(`  ${String(quante).padStart(2)} x  "${indicatore}"`);
  }
}
