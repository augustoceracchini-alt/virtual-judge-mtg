import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";

const percorsoPdf = path.join(process.cwd(), "data", "tournament-rules.pdf");
const percorsoCompatto = path.join(process.cwd(), "data", "mtr-compatte.json");

function normalizzaTitolo(testo) {
  return testo.toLowerCase().replace(/\s+/g, " ").trim();
}

console.log("Leggo il PDF del regolamento torneistico (Magic Tournament Rules)...");
const buffer = fs.readFileSync(percorsoPdf);
const parser = new PDFParse({ data: buffer });
const risultatoEstrazione = await parser.getText();

let testoCompleto = risultatoEstrazione.text.replace(/\r\n/g, "\n");

console.log("Cerco la data di validità del regolamento...");
const regexDataEfficacia = /Effective ([A-Za-z]+ \d{1,2}, \d{4})/;
const dataEfficacia = regexDataEfficacia.exec(testoCompleto)?.[1] ?? null;

if (!dataEfficacia) {
  console.error('ATTENZIONE: non ho trovato la frase "Effective <data>" nel PDF. Il campo dataEfficacia sarà assente (null).');
} else {
  console.log(`Regolamento efficace a partire dal: ${dataEfficacia}`);
}

console.log("Estraggo l'indice ufficiale (capitoli e appendici) dal sommario del documento...");
const regexInizioCorpo = /\nIntroduction\nThe Magic:/;
const risultatoInizio = regexInizioCorpo.exec(testoCompleto);
if (!risultatoInizio) {
  console.error("ERRORE: impossibile trovare l'inizio del corpo del regolamento (dopo copertina e indice).");
  console.error("Verifica che data/tournament-rules.pdf sia stato scaricato correttamente e non sia vuoto o danneggiato.");
  process.exit(1);
}
const testoIndice = testoCompleto.substring(0, risultatoInizio.index);

// Il sommario riporta ogni voce come "N. Titolo ....(molti punti).... paginaN": usiamo questo
// formato (dots + numero di pagina) per riconoscere in modo inequivocabile i titoli ufficiali
// dei capitoli e delle appendici, senza rischiare di confonderli con liste numerate nel corpo.
const regexCapitoloIndice = /^(\d+)\.\s+(.+?)\s*\.{5,}\s*\d+$/gm;
const regexAppendiceIndice = /^Appendix ([A-F])[—-]\s*(.+?)\s*\.{5,}\s*\d+$/gm;
const sequenzaCapitoli = [];
let match;
while ((match = regexCapitoloIndice.exec(testoIndice)) !== null) {
  sequenzaCapitoli.push({ numero: match[1], titolo: match[2].trim() });
}
while ((match = regexAppendiceIndice.exec(testoIndice)) !== null) {
  sequenzaCapitoli.push({ numero: match[1], titolo: match[2].trim() });
}
console.log(`Trovati ${sequenzaCapitoli.length} capitoli/appendici nel sommario.`);

if (sequenzaCapitoli.length === 0) {
  console.error("ERRORE: nessun capitolo trovato nel sommario. La struttura del PDF potrebbe essere cambiata.");
  process.exit(1);
}

console.log("Estraggo capitoli, sottosezioni e blocchi di testo dal corpo del documento...");

// Rimuove i marcatori di pagina ("-- N of 55 --") e il numero di pagina isolato che li segue,
// così il corpo del testo scorre continuo senza interruzioni artificiali di impaginazione.
const testoSenzaPagine = testoCompleto.replace(/--\s*\d+\s+of\s+\d+\s*--\n+\d+\n*/g, "\n");
const indiceCorpo = testoSenzaPagine.search(regexInizioCorpo);
const testoCorpo = testoSenzaPagine.substring(indiceCorpo + 1);

const regexSottosezione = /^(\d+)\.(\d+)\s+(.+)$/;
const regexCapitoloCorpo = /^(\d+)\.\s+(.+)$/;
const regexAppendiceCorpo = /^Appendix ([A-F])[—-]\s*(.+)$/;

let indiceProssimoCapitolo = 0;
let capitoloCorrente = { numero: "0", titolo: "Introduction" };
let sottosezioneCorrente = null;
let bufferTesto = [];
const blocchi = [];

function chiudiBlocco() {
  const testo = bufferTesto.join(" ").replace(/\s+/g, " ").trim();
  bufferTesto = [];
  if (testo === "") {
    return;
  }
  const prefisso = sottosezioneCorrente ? `${sottosezioneCorrente.numero} ${sottosezioneCorrente.titolo}: ` : "";
  blocchi.push({
    numeroCapitolo: capitoloCorrente.numero,
    titoloCapitolo: capitoloCorrente.titolo,
    testo: prefisso + testo,
  });
}

for (const rigaGrezza of testoCorpo.split("\n")) {
  const riga = rigaGrezza.trim();
  const prossimoCapitolo = sequenzaCapitoli[indiceProssimoCapitolo];

  // Un capitolo/appendice viene riconosciuto SOLO se numero E titolo coincidono esattamente
  // con la voce attesa dal sommario ufficiale: il solo numero non basta, perché il corpo del
  // documento contiene liste numerate (es. i passaggi della procedura di pregame in 2.3) che
  // per pura coincidenza possono avere lo stesso numero del capitolo atteso in quel momento.
  if (prossimoCapitolo) {
    const matchAppendice = regexAppendiceCorpo.exec(riga);
    if (
      matchAppendice &&
      matchAppendice[1] === prossimoCapitolo.numero &&
      normalizzaTitolo(matchAppendice[2]) === normalizzaTitolo(prossimoCapitolo.titolo)
    ) {
      chiudiBlocco();
      capitoloCorrente = { numero: matchAppendice[1], titolo: matchAppendice[2].trim() };
      sottosezioneCorrente = null;
      indiceProssimoCapitolo += 1;
      continue;
    }

    const matchCapitolo = regexCapitoloCorpo.exec(riga);
    if (
      matchCapitolo &&
      matchCapitolo[1] === prossimoCapitolo.numero &&
      normalizzaTitolo(matchCapitolo[2]) === normalizzaTitolo(prossimoCapitolo.titolo)
    ) {
      chiudiBlocco();
      capitoloCorrente = { numero: matchCapitolo[1], titolo: matchCapitolo[2].trim() };
      sottosezioneCorrente = null;
      indiceProssimoCapitolo += 1;
      continue;
    }
  }

  const matchSottosezione = regexSottosezione.exec(riga);
  if (matchSottosezione && matchSottosezione[1] === capitoloCorrente.numero) {
    chiudiBlocco();
    sottosezioneCorrente = {
      numero: `${matchSottosezione[1]}.${matchSottosezione[2]}`,
      titolo: matchSottosezione[3].trim(),
    };
    continue;
  }

  if (riga !== "") {
    bufferTesto.push(riga);
  }
}
chiudiBlocco();

console.log(`Capitoli/appendici trovati nel corpo: ${indiceProssimoCapitolo} / ${sequenzaCapitoli.length}.`);
console.log(`Blocchi di testo estratti: ${blocchi.length}.`);

if (indiceProssimoCapitolo !== sequenzaCapitoli.length || blocchi.length === 0) {
  console.error("ATTENZIONE: non tutti i capitoli previsti dal sommario sono stati trovati nel corpo del documento.");
  console.error("La struttura del PDF potrebbe essere cambiata rispetto a quella prevista da questo script: verifica manualmente prima di usare il file compatto.");
  process.exit(1);
}

const capitoli = sequenzaCapitoli.map((c) => ({ numero: c.numero, titolo: c.titolo }));
const datiCompatti = { dataEfficacia, capitoli, blocchi };
fs.writeFileSync(percorsoCompatto, JSON.stringify(datiCompatti), "utf-8");

const dimensioneOriginale = (fs.statSync(percorsoPdf).size / 1024 / 1024).toFixed(2);
const dimensioneCompatta = (fs.statSync(percorsoCompatto).size / 1024 / 1024).toFixed(2);

console.log("");
console.log("✅ File compatto creato con successo: data/mtr-compatte.json");
console.log(`   PDF originale: ${dimensioneOriginale} MB`);
console.log(`   File compatto:  ${dimensioneCompatta} MB`);
console.log(`   Data di validità: ${dataEfficacia ?? "NON TROVATA"}`);
