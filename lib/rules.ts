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
//
// La usano entrambe le ricerche. Nelle Comprehensive Rules sostituisce un confronto per
// sottostringa che gonfiava il punteggio di blocchi e capitoli irrilevanti: "tap" faceva punto
// dentro "untapped" in 48 blocchi, e il capitolo 722 "Controlling Another Player" veniva
// selezionato per una domanda sui layer perché "layer" sta dentro "Player".
//
// Oltre a togliere quei falsi positivi migliora anche il recupero, perché normalizza la
// punteggiatura su entrambi i lati del confronto: la parola chiave "state-based action" trova
// ora anche un testo scritto "state based action", che con il confronto grezzo richiedeva
// l'esatta trattinatura.
function iniziaUnaParolaDi(testo: string, parolaChiave: string): boolean {
  return aSequenzaDiParole(testo).includes(aSequenzaDiParole(parolaChiave));
}

// Confronto pensato per i TITOLI DEI CAPITOLI, che sono di una o due parole ("Abilities", "Lands",
// "Saga Cards"), mentre le parole chiave della FASE A sono spesso locuzioni ("triggered ability",
// "continuous effect"). Confrontare la locuzione intera contro un titolo di una parola sola non può
// riuscire: "triggered ability" non comparirà mai dentro "Abilities". Per i titoli si confronta
// quindi anche la sola parola-testa della locuzione (vedi il commento nella funzione).
//
// Si tollera inoltre il plurale in -ies, che il confronto per prefisso non copre: "ability" non è
// prefisso di "abilities" (abilit-y contro abilit-ies), mentre per i plurali regolari il prefisso
// basta già ("deck check" trova "Deck Checks").
//
// Misurato: senza questo, per una domanda su un'abilità di capitolo sulla pila il capitolo 113
// "Abilities" non veniva mai selezionato, e la regola decisiva 113.7a restava al rango 47 su 721
// blocchi con punteggio, fuori portata della rete di sicurezza globale che ne prende 3.
const LUNGHEZZA_MINIMA_PAROLA_SINGOLA = 4;

function conVariantePlurale(parola: string): string[] {
  if (parola.endsWith("y")) {
    return [parola, `${parola.slice(0, -1)}ies`];
  }
  return [parola];
}

function titoloCapitoloPertinente(titolo: string, parolaChiave: string): boolean {
  // Della locuzione si prova solo l'ULTIMA parola, non tutte: in inglese è la testa del sostantivo
  // composto, quella che dice di che cosa si parla ("triggered ABILITY", "continuous EFFECT",
  // "lore COUNTER"). Provarle tutte allargava troppo la selezione: misurato, portava il testo dei
  // casi di prova a sbattere contro LIMITE_CARATTERI, dove ogni blocco in più ne fa troncare un
  // altro.
  const parole = parolaChiave.split(/\s+/);
  const ultima = parole[parole.length - 1];
  const termini =
    parole.length > 1 && ultima.length >= LUNGHEZZA_MINIMA_PAROLA_SINGOLA
      ? [parolaChiave, ultima]
      : [parolaChiave];
  return termini.some((termine) =>
    conVariantePlurale(termine).some((variante) => iniziaUnaParolaDi(titolo, variante))
  );
}

// Verifica se un blocco è uno di quelli il cui numero l'utente ha citato esplicitamente. I numeri
// arrivano da Gemini (FASE A), che li restituisce quasi sempre nella forma chiesta dal prompt
// ("510.1c") ma non è tenuto a farlo: un confronto grezzo con `startsWith` è case-sensitive e
// sensibile agli spazi, quindi con "510.1C" o " 510.1c" la citazione andava persa proprio quando
// l'utente aveva indicato la regola precisa da guardare.
//
// Il controllo sulla stringa vuota non è teorico: `"qualsiasi cosa".startsWith("")` è true, quindi
// un solo elemento vuoto nell'array avrebbe reso "esplicitamente citato" OGNI blocco. Nell'MTR, dove
// quella condizione decide l'ammissione, sarebbe finito l'intero regolamento torneistico nel prompt
// di qualunque domanda, comprese quelle di pura meccanica di gioco.
function bloccoCitaUnaDelleRegole(testoBlocco: string, regoleCitate: string[]): boolean {
  const inizioBlocco = testoBlocco.trim().toLowerCase();
  return regoleCitate.some((regola) => {
    const cercata = regola.trim().toLowerCase();
    return cercata !== "" && inizioBlocco.startsWith(cercata);
  });
}

// Quanto testo di regolamento al massimo può finire nel prompt, per singola fonte.
const LIMITE_CARATTERI = 9000;

function assemblaEstratti(blocchiOrdinati: BloccoRegola[]): string {
  let testoFinale = "";
  for (const blocco of blocchiOrdinati) {
    const prossimoBlocco = `[Capitolo ${blocco.numeroCapitolo} - ${blocco.titoloCapitolo}]\n${blocco.testo}\n\n`;
    if ((testoFinale + prossimoBlocco).length > LIMITE_CARATTERI) {
      break;
    }
    testoFinale += prossimoBlocco;
  }
  return testoFinale.trim();
}

// Quanto pesa, nell'ordinamento, il fatto che l'argomento della sottosezione corrisponda alla
// domanda: deve contare più di qualsiasi numero di occorrenze sparse nel corpo del testo.
const PUNTI_ARGOMENTO_PERTINENTE = 100;
const PUNTI_REGOLA_CITATA = 100;

// L'MTR ha una ricerca propria invece di condividere quella delle Comprehensive Rules, perché i
// due documenti hanno strutture opposte. Le CR sono 3869 blocchi brevi distribuiti su 146
// capitoli dai titoli specifici ("Sagas", "Lands"): lì selezionare prima i capitoli pertinenti
// serve a evitare che un capitolo prolisso soffochi quello decisivo. L'MTR invece ha 94 blocchi
// lunghi su appena 16 capitoli dai titoli quasi identici: la parola "Tournament" compare in
// cinque titoli su sedici, che finiscono così a pari punteggio, e il taglio ai primi quattro
// scarta arbitrariamente il capitolo giusto (una domanda su "bribery" selezionava i capitoli 3,
// 6, 7 e 8, lasciando fuori il capitolo 5 dove sta la sottosezione "5.2 Bribery").
// Qui il criterio è invece il titolo della sottosezione con cui ogni blocco inizia
// ("5.2 Bribery: ...", "2.8 Deck Checks: ..."): è l'etichetta dell'argomento trattato, ed è
// abbastanza specifica sia per trovare il blocco giusto sia per escludere l'intero documento
// quando la domanda riguarda le meccaniche di gioco e non le procedure di torneo.
export function cercaRegoleTorneo(paroleChiave: string[], regoleCitate: string[]): string {
  const dati = caricaDati("mtr-compatte.json");
  const paroleChiaveFiltrate = paroleChiave.filter((p) => p.length > 2);

  const blocchiValutati = dati.blocchi.map((blocco) => {
    const titolo = titoloSottosezione(blocco.testo);

    const argomentoPertinente =
      titolo !== "" && paroleChiaveFiltrate.some((parola) => iniziaUnaParolaDi(titolo, parola));
    const esplicitamenteCitato = bloccoCitaUnaDelleRegole(blocco.testo, regoleCitate);

    let punteggio = 0;
    for (const parola of paroleChiaveFiltrate) {
      // Confronto per parola anche nel corpo, non solo nel titolo: il corpo usava ancora una
      // `includes` grezza, rimasta indietro rispetto alla correzione applicata alle CR. Qui non
      // decide l'ammissione (quella dipende dal titolo o dalla citazione esplicita) ma decide
      // l'ORDINE, e l'ordine conta: assemblaEstratti tronca a LIMITE_CARATTERI, quindi un blocco
      // spinto in basso da punti falsi come "tap" dentro "untapped" può finire tagliato via.
      if (iniziaUnaParolaDi(blocco.testo, parola)) {
        punteggio += 1;
      }
    }
    if (argomentoPertinente) {
      punteggio += PUNTI_ARGOMENTO_PERTINENTE;
    }
    if (esplicitamenteCitato) {
      punteggio += PUNTI_REGOLA_CITATA;
    }

    // Le sole occorrenze nel corpo del testo non bastano ad ammettere un blocco: i blocchi
    // dell'MTR sono in media cinque volte più lunghi di quelli delle CR e intercettano parole
    // comuni come "damage" o "spell" per statistica, non per pertinenza.
    return { blocco, punteggio, ammesso: argomentoPertinente || esplicitamenteCitato };
  });

  const pertinenti = blocchiValutati
    .filter((valutato) => valutato.ammesso)
    .sort((a, b) => b.punteggio - a.punteggio)
    .map((valutato) => valutato.blocco);

  return assemblaEstratti(pertinenti);
}

function cercaBlocchiPertinenti(dati: DatiRegole, paroleChiave: string[], regoleCitate: string[]): string {
  const paroleChiaveFiltrate = paroleChiave.filter((p) => p.length > 2);

  const punteggiCapitoli = dati.capitoli.map((capitolo) => {
    let punteggio = 0;
    for (const parola of paroleChiaveFiltrate) {
      if (titoloCapitoloPertinente(capitolo.titolo, parola)) {
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
    let punteggio = 0;
    for (const parola of paroleChiaveFiltrate) {
      if (iniziaUnaParolaDi(blocco.testo, parola)) {
        punteggio += 1;
      }
    }
    if (bloccoCitaUnaDelleRegole(blocco.testo, regoleCitate)) {
      punteggio += 10;
    }
    return punteggio;
  }

  // Prende i migliori blocchi PER CIASCUN capitolo selezionato (invece di un unico taglio
  // "top N assoluti" su tutti i capitoli insieme), così un capitolo poco chiacchierone ma
  // decisivo (es. 714 "Saga Cards" con un solo blocco davvero pertinente) non viene escluso
  // solo perché un altro capitolo tra quelli scelti (es. 305 "Lands", con molti più blocchi)
  // ne ha tanti con punteggio pari o superiore.
  const MASSIMO_BLOCCHI_PER_CAPITOLO = 6;

  function miglioriBlocchiTra(blocchi: BloccoRegola[], quanti: number) {
    return blocchi
      .map((blocco) => ({ blocco, punteggio: calcolaPunteggioBlocco(blocco) }))
      .filter((b) => b.punteggio > 0)
      .sort((a, b) => b.punteggio - a.punteggio)
      .slice(0, quanti);
  }

  const perCapitolo = capitoliSelezionati.flatMap((numeroCapitolo) =>
    miglioriBlocchiTra(
      dati.blocchi.filter((b) => b.numeroCapitolo === numeroCapitolo),
      MASSIMO_BLOCCHI_PER_CAPITOLO
    )
  );

  // La ricerca su tutto il documento non è più un ripiego per quando nessun capitolo viene
  // selezionato: è SEMPRE attiva, come rete di sicurezza sopra la selezione per capitoli. Il
  // pre-filtro sceglie i capitoli solo in base alle parole presenti nel loro TITOLO, e i titoli
  // non contengono sempre il vocabolario della domanda: il capitolo 714 si intitola "Saga Cards"
  // e non contiene "lore counter", il capitolo 702 si intitola "Keyword Abilities" e non contiene
  // "deathtouch". Senza questa rete quei capitoli prendono punteggio 0, vengono eliminati prima
  // del taglio ai primi quattro, e la regola decisiva viene scartata anche quando è il blocco col
  // punteggio più alto dell'intero documento (misurato: 714.4 era primo su 3869 blocchi, e non
  // compariva negli estratti).
  //
  // Quando invece nessun capitolo è stato selezionato la ricerca globale è l'unica fonte di
  // risultati, e allora può prenderne di più: da sola non deve spartire il limite di caratteri
  // con nient'altro.
  // Il valore 3 è tenuto basso deliberatamente. Misurato con scripts/prova-ricerca.mjs: qualsiasi
  // valore da 1 a 8 fa passare esattamente gli stessi casi, ma il testo complessivo inviato a
  // Gemini cresce del 32% passando da 1 a 8 (40007 -> 52838 caratteri sui casi di prova). I blocchi
  // in più non comprano niente di misurabile e consumano il limite di caratteri a scapito dei
  // blocchi dei capitoli selezionati. Non è 1 solo per lasciare un margine: nei due casi misurati
  // il blocco decisivo era primo in classifica, ma non c'è garanzia che lo sia sempre.
  const MASSIMO_BLOCCHI_RETE_DI_SICUREZZA = 3;
  const MASSIMO_BLOCCHI_SENZA_CAPITOLI = 15;
  const quantiGlobali =
    capitoliSelezionati.length > 0 ? MASSIMO_BLOCCHI_RETE_DI_SICUREZZA : MASSIMO_BLOCCHI_SENZA_CAPITOLI;
  const globali = miglioriBlocchiTra(dati.blocchi, quantiGlobali);

  // I blocchi trovati globalmente vanno per primi: sono i più pertinenti in assoluto, e solo
  // stando in testa sopravvivono al limite di caratteri applicato da assemblaEstratti invece di
  // essere accodati e troncati via.
  const visti = new Set<BloccoRegola>();
  const senzaDuplicati = [...globali, ...perCapitolo].filter(({ blocco }) => {
    if (visti.has(blocco)) {
      return false;
    }
    visti.add(blocco);
    return true;
  });

  return assemblaEstratti(senzaDuplicati.map((item) => item.blocco));
}