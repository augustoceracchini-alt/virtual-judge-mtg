import fs from "fs";
import path from "path";

interface BloccoRegola {
  numeroCapitolo: string;
  titoloCapitolo: string;
  testo: string;
}

interface Capitolo {
  numero: string;
  titolo: string;
}

interface DatiRegole {
  dataEfficacia: string | null;
  capitoli: Capitolo[];
  blocchi: BloccoRegola[];
}

const cacheDati = new Map<string, DatiRegole>();

function caricaDati(nomeFile: string): DatiRegole {
  const esistente = cacheDati.get(nomeFile);
  if (esistente) {
    return esistente;
  }

  const percorsoFile = path.join(process.cwd(), "data", nomeFile);
  const testoJson = fs.readFileSync(percorsoFile, "utf-8");
  const dati = JSON.parse(testoJson) as DatiRegole;
  cacheDati.set(nomeFile, dati);
  return dati;
}

function normalizza(testo: string): string {
  return testo.toLowerCase();
}

export function getDataEfficaciaRegole(): string | null {
  return caricaDati("regole-compatte.json").dataEfficacia;
}

export function getDataEfficaciaRegoleTorneo(): string | null {
  return caricaDati("mtr-compatte.json").dataEfficacia;
}

export function cercaRegolePertinenti(paroleChiave: string[], regoleCitate: string[]): string {
  return cercaBlocchiPertinenti(caricaDati("regole-compatte.json"), paroleChiave, regoleCitate);
}

// Ogni blocco dell'MTR inizia con il titolo della propria sottosezione, nella forma
// "3.16 Sideboard: <corpo del testo>". Quel titolo è l'etichetta dell'argomento di policy
// trattato dal blocco, molto più specifica dei 16 titoli di capitolo del documento
// (che sono tutti generici: "Tournament Rules", "Communication", ...).
const LUNGHEZZA_MASSIMA_TITOLO_SOTTOSEZIONE = 80;

function titoloSottosezione(testoBlocco: string): string {
  const posizioneDuePunti = testoBlocco.indexOf(":");
  if (posizioneDuePunti === -1 || posizioneDuePunti > LUNGHEZZA_MASSIMA_TITOLO_SOTTOSEZIONE) {
    return "";
  }
  return testoBlocco.slice(0, posizioneDuePunti);
}

// Riduce un testo a parole separate da spazi singoli, con uno spazio iniziale, in modo da poter
// verificare con una semplice `includes` se una parola chiave comincia una parola del testo.
function aSequenzaDiParole(testo: string): string {
  return ` ${testo.toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, " ").trim()}`;
}

// Verifica che `parolaChiave` compaia in `testo` all'inizio di una parola. Serve a evitare i
// falsi positivi da sottostringa: senza questo controllo la parola chiave "layer" risultava
// contenuta nel titolo "1.10 Players", facendo sembrare pertinente il regolamento torneistico
// per una domanda sui layer degli effetti continui. Il vincolo è solo sull'inizio della parola,
// non anche sulla fine, così una parola chiave al singolare continua a trovare il titolo al
// plurale (la chiave "deck check" trova la sottosezione "2.8 Deck Checks").
function iniziaUnaParolaDi(testo: string, parolaChiave: string): boolean {
  return aSequenzaDiParole(testo).includes(aSequenzaDiParole(parolaChiave));
}

export function cercaRegoleTorneo(paroleChiave: string[], regoleCitate: string[]): string {
  const dati = caricaDati("mtr-compatte.json");
  const paroleChiaveNormalizzate = paroleChiave.map(normalizza).filter((p) => p.length > 2);

  // L'MTR è una fonte secondaria: riguarda le procedure di torneo, non il funzionamento delle
  // carte. Va quindi incluso solo quando la domanda tocca davvero quel dominio, altrimenti
  // finisce nel prompt anche per domande di pura meccanica di gioco, rubando spazio alle
  // Comprehensive Rules e distraendo il modello. Il filtro non può basarsi sul punteggio dei
  // blocchi: i blocchi dell'MTR sono in media cinque volte più lunghi di quelli delle CR, e
  // proprio i più lunghi intercettano per caso parole comuni come "damage" o "spell",
  // sopravvivendo a qualsiasi soglia. Il titolo della sottosezione invece separa nettamente i
  // due domini, perché nessun argomento di policy si chiama "damage" o "deathtouch".
  const qualcheSottosezionePertinente = dati.blocchi.some((blocco) => {
    const titolo = titoloSottosezione(blocco.testo);
    return titolo !== "" && paroleChiaveNormalizzate.some((parola) => iniziaUnaParolaDi(titolo, parola));
  });

  // Una regola citata esplicitamente con la numerazione dell'MTR (es. "6.1") è comunque una
  // richiesta diretta di consultare questo documento, anche se le parole chiave non toccano
  // nessun titolo di sottosezione.
  const citazioneAppartieneAllMtr = regoleCitate.some((regola) =>
    dati.capitoli.some((capitolo) => capitolo.numero === regola.split(".")[0])
  );

  if (!qualcheSottosezionePertinente && !citazioneAppartieneAllMtr) {
    return "";
  }

  return cercaBlocchiPertinenti(dati, paroleChiave, regoleCitate);
}

function cercaBlocchiPertinenti(dati: DatiRegole, paroleChiave: string[], regoleCitate: string[]): string {
  const paroleChiaveNormalizzate = paroleChiave.map(normalizza).filter((p) => p.length > 2);

  const punteggiCapitoli = dati.capitoli.map((capitolo) => {
    const titoloNormalizzato = normalizza(capitolo.titolo);
    let punteggio = 0;
    for (const parola of paroleChiaveNormalizzate) {
      if (titoloNormalizzato.includes(parola)) {
        punteggio += 1;
      }
    }
    return { capitolo, punteggio };
  });

  const capitoliSelezionati = punteggiCapitoli
    .filter((c) => c.punteggio > 0)
    .sort((a, b) => b.punteggio - a.punteggio)
    .slice(0, 4)
    .map((c) => c.capitolo.numero);

  // Un numero di regola citato porta con sé il capitolo di appartenenza (es. "510.1c" -> "510"),
  // che aggiungiamo a quelli da esaminare. Il capitolo va però verificato contro l'indice del
  // documento in cui stiamo effettivamente cercando: le due fonti hanno numerazioni diverse
  // (le CR usano tre cifre, l'MTR va da "1" a "10" più le appendici "A"-"F") ma ricevono
  // entrambe la stessa lista di citazioni. Senza questo controllo un capitolo inesistente
  // nella fonte corrente renderebbe comunque `capitoliSelezionati` non vuoto, disattivando la
  // ricerca globale di riserva più sotto e facendo restituire zero risultati.
  for (const regola of regoleCitate) {
    const numeroCapitolo = regola.split(".")[0];
    const capitoloEsisteInQuestaFonte = dati.capitoli.some((c) => c.numero === numeroCapitolo);
    if (capitoloEsisteInQuestaFonte && !capitoliSelezionati.includes(numeroCapitolo)) {
      capitoliSelezionati.push(numeroCapitolo);
    }
  }

  function calcolaPunteggioBlocco(blocco: BloccoRegola): number {
    const testoNormalizzato = normalizza(blocco.testo);
    let punteggio = 0;
    for (const parola of paroleChiaveNormalizzate) {
      if (testoNormalizzato.includes(parola)) {
        punteggio += 1;
      }
    }
    for (const regola of regoleCitate) {
      if (blocco.testo.startsWith(regola)) {
        punteggio += 10;
      }
    }
    return punteggio;
  }

  // Prende i migliori blocchi PER CIASCUN capitolo selezionato (invece di un unico taglio
  // "top N assoluti" su tutti i capitoli insieme), così un capitolo poco chiacchierone ma
  // decisivo (es. 714 "Saga Cards" con un solo blocco davvero pertinente) non viene escluso
  // solo perché un altro capitolo tra quelli scelti (es. 305 "Lands", con molti più blocchi)
  // ne ha tanti con punteggio pari o superiore.
  const MASSIMO_BLOCCHI_PER_CAPITOLO = 6;
  let migliori: { blocco: BloccoRegola; punteggio: number }[] = [];

  if (capitoliSelezionati.length > 0) {
    for (const numeroCapitolo of capitoliSelezionati) {
      const blocchiDelCapitolo = dati.blocchi.filter((b) => b.numeroCapitolo === numeroCapitolo);
      const punteggiDelCapitolo = blocchiDelCapitolo
        .map((blocco) => ({ blocco, punteggio: calcolaPunteggioBlocco(blocco) }))
        .filter((b) => b.punteggio > 0)
        .sort((a, b) => b.punteggio - a.punteggio)
        .slice(0, MASSIMO_BLOCCHI_PER_CAPITOLO);
      migliori.push(...punteggiDelCapitolo);
    }
  } else {
    migliori = dati.blocchi
      .map((blocco) => ({ blocco, punteggio: calcolaPunteggioBlocco(blocco) }))
      .filter((b) => b.punteggio > 0)
      .sort((a, b) => b.punteggio - a.punteggio)
      .slice(0, 15);
  }

  if (migliori.length === 0) {
    return "";
  }

  const LIMITE_CARATTERI = 9000;
  let testoFinale = "";
  for (const item of migliori) {
    const prossimoBlocco = `[Capitolo ${item.blocco.numeroCapitolo} - ${item.blocco.titoloCapitolo}]\n${item.blocco.testo}\n\n`;
    if ((testoFinale + prossimoBlocco).length > LIMITE_CARATTERI) {
      break;
    }
    testoFinale += prossimoBlocco;
  }

  return testoFinale.trim();
}