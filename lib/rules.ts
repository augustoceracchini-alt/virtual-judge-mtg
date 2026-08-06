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

export function cercaRegoleTorneo(paroleChiave: string[], regoleCitate: string[]): string {
  return cercaBlocchiPertinenti(caricaDati("mtr-compatte.json"), paroleChiave, regoleCitate);
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

  for (const regola of regoleCitate) {
    const numeroCapitolo = regola.split(".")[0];
    if (numeroCapitolo && !capitoliSelezionati.includes(numeroCapitolo)) {
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