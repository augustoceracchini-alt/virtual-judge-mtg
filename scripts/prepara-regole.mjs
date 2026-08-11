import fs from "fs";
import path from "path";

const percorsoFileGrezzo = path.join(process.cwd(), "data", "comprehensive-rules.txt");
const percorsoFileCompatto = path.join(process.cwd(), "data", "regole-compatte.json");

console.log("Leggo il file grezzo delle regole...");
let testoCompleto = fs.readFileSync(percorsoFileGrezzo, "utf-8");

// Normalizza gli a capo (Windows \r\n -> Unix \n) per rendere la ricerca affidabile
testoCompleto = testoCompleto.replace(/\r\n/g, "\n");

// Cerca l'inizio del corpo del documento con un pattern elastico invece di un testo fisso
const regexInizioCorpo = /100\.\s+General\s*\n+\s*100\.1\./;
const risultatoRicerca = regexInizioCorpo.exec(testoCompleto);

if (!risultatoRicerca) {
  console.error("ERRORE: impossibile trovare l'inizio del corpo delle regole.");
  console.error("Verifica che il file data/comprehensive-rules.txt sia stato scaricato correttamente e non sia vuoto o danneggiato.");
  console.error("Lunghezza del file letto: " + testoCompleto.length + " caratteri.");
  console.error("Prime 500 caratteri del file, per debug:");
  console.error(testoCompleto.substring(0, 500));
  process.exit(1);
}

const indiceInizioCorpo = risultatoRicerca.index;
const testoIndice = testoCompleto.substring(0, indiceInizioCorpo);
const testoCorpo = testoCompleto.substring(indiceInizioCorpo);

console.log("Cerco la data di validità del regolamento...");
const regexDataEfficacia = /effective as of ([A-Za-z]+ \d{1,2}, \d{4})/;
const risultatoData = regexDataEfficacia.exec(testoCompleto);
const dataEfficacia = risultatoData ? risultatoData[1] : null;

if (!dataEfficacia) {
  console.error("ATTENZIONE: non ho trovato la frase \"effective as of <data>\" nel file. Il campo dataEfficacia sarà assente (null) nel file compatto: il giudice non saprà comunicare a che data sono aggiornate le regole.");
} else {
  console.log(`Regole efficaci a partire dal: ${dataEfficacia}`);
}

console.log("Estraggo i capitoli (macro-argomenti)...");
const capitoli = [];
const regexCapitolo = /^(\d{3})\.\s+(.+)$/gm;
let match;
while ((match = regexCapitolo.exec(testoIndice)) !== null) {
  capitoli.push({ numero: match[1], titolo: match[2].trim() });
}
console.log(`Trovati ${capitoli.length} capitoli.`);

// Il corpo del documento finisce con due sezioni non numerate: il Glossario (definizioni dei
// termini di gioco in ordine alfabetico) e i Credits (crediti/legale, senza alcun valore per la
// ricerca). Senza individuarle esplicitamente, il ciclo qui sotto le attribuirebbe entrambe
// all'ultimo capitolo numerato incontrato prima di loro (905, "Conspiracy Draft"): le quasi 750
// voci di glossario finirebbero etichettate come se fossero la regola 905, un'attribuzione falsa
// che rischia di essere mostrata al modello come fonte citabile. Il Glossario va invece isolato ed
// estratto a parte: ogni voce spesso rimanda esplicitamente al capitolo numerato che tratta quel
// termine ("Room" -> "See rule 709, 'Split Cards.'"), un indizio utile quando quel capitolo ha un
// titolo che non condivide vocabolario con la domanda dell'utente.
console.log("Individuo il confine del Glossario nel testo...");
const paragrafiCompleti = testoCorpo.split(/\n\s*\n+/).filter((p) => p.trim() !== "");
const indiceGlossario = paragrafiCompleti.findIndex((p) => p.trim() === "Glossary");
const indiceCredits = paragrafiCompleti.findIndex((p) => p.trim() === "Credits");

if (indiceGlossario === -1 || indiceCredits === -1 || indiceCredits <= indiceGlossario) {
  console.error(
    "ATTENZIONE: non ho trovato i paragrafi \"Glossary\"/\"Credits\" che delimitano il Glossario nel testo. Il glossario non verrà estratto: la ricerca perde la possibilità di reindirizzare una parola chiave nota (es. \"Room\") al capitolo numerato giusto, ma il resto del regolamento viene comunque elaborato normalmente."
  );
}

const paragrafiRegole = indiceGlossario !== -1 ? paragrafiCompleti.slice(0, indiceGlossario) : paragrafiCompleti;
const paragrafiGlossario =
  indiceGlossario !== -1 && indiceCredits > indiceGlossario
    ? paragrafiCompleti.slice(indiceGlossario + 1, indiceCredits)
    : [];

console.log("Estraggo i blocchi di regole...");
const blocchi = [];
let capitoloCorrente = null;

for (const paragrafo of paragrafiRegole) {
  const headerMatch = paragrafo.match(/^(\d{3})\.\s+(.+)$/);
  if (headerMatch) {
    capitoloCorrente = { numero: headerMatch[1], titolo: headerMatch[2].trim() };
    continue;
  }
  if (capitoloCorrente) {
    blocchi.push({
      numeroCapitolo: capitoloCorrente.numero,
      titoloCapitolo: capitoloCorrente.titolo,
      testo: paragrafo.trim(),
    });
  }
}
console.log(`Trovati ${blocchi.length} blocchi di regole.`);

console.log("Estraggo il Glossario...");
const glossario = [];
for (const paragrafo of paragrafiGlossario) {
  const righe = paragrafo.split("\n");
  const termine = righe[0].trim();
  const definizione = righe.slice(1).join("\n").trim();
  if (termine !== "" && definizione !== "") {
    glossario.push({ termine, definizione });
  }
}
console.log(`Trovate ${glossario.length} voci di glossario.`);

if (capitoli.length === 0 || blocchi.length === 0) {
  console.error("ATTENZIONE: il numero di capitoli o blocchi trovati è zero. Qualcosa non va nella struttura del file. Contatta il supporto prima di procedere.");
  process.exit(1);
}

const datiCompatti = { dataEfficacia, capitoli, blocchi, glossario };
fs.writeFileSync(percorsoFileCompatto, JSON.stringify(datiCompatti), "utf-8");

const dimensioneOriginale = (fs.statSync(percorsoFileGrezzo).size / 1024 / 1024).toFixed(2);
const dimensioneCompatta = (fs.statSync(percorsoFileCompatto).size / 1024 / 1024).toFixed(2);

console.log("");
console.log("✅ File compatto creato con successo: data/regole-compatte.json");
console.log(`   File originale: ${dimensioneOriginale} MB`);
console.log(`   File compatto:  ${dimensioneCompatta} MB`);
console.log(`   Data di validità delle regole: ${dataEfficacia ?? "NON TROVATA"}`);
