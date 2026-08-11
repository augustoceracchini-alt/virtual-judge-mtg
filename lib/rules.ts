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

interface VoceGlossario {
  termine: string;
  definizione: string;
}

interface DatiRegole {
  dataEfficacia: string | null;
  capitoli: Capitolo[];
  blocchi: BloccoRegola[];
  // Presente solo in regole-compatte.json (le CR hanno un Glossario ufficiale). mtr-compatte.json
  // non ha questo campo: va trattato come assente, non come un errore.
  glossario?: VoceGlossario[];
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
//
// Il valore precedente (9000) era stato scelto quando si credeva che la quota gratuita di Gemini
// fosse vincolata sui TOKEN. Non è così: è limitata soprattutto nel numero di richieste al giorno.
// Nel frattempo quel tetto era diventato il vincolo che decideva sempre quali regole arrivavano al
// modello: misurato sui casi di scripts/prova-ricerca.mjs, gli estratti delle CR pesavano
// 7362 / 8703 / 8414 / 7553 / 8949 / 8659 / 8715 / 7769 caratteri, cioè fra l'82% e il 99% del
// limite in OGNI caso di prova. Con entrambe le fonti al massimo si passa da ~4500 a ~9000 token
// di regolamento per richiesta: irrilevante per la quota, decisivo per non troncare via proprio la
// regola che risponde alla domanda.
const LIMITE_CARATTERI = 18000;

function assemblaEstratti(blocchiOrdinati: BloccoRegola[]): string {
  let testoFinale = "";
  for (const blocco of blocchiOrdinati) {
    const prossimoBlocco = `[Capitolo ${blocco.numeroCapitolo} - ${blocco.titoloCapitolo}]\n${blocco.testo}\n\n`;
    if ((testoFinale + prossimoBlocco).length > LIMITE_CARATTERI) {
      // `continue` e non `break`: il blocco che non ci sta viene saltato, ma quelli dopo di lui
      // continuano a riempire lo spazio rimasto. Con `break` bastava un blocco lungo per chiudere
      // l'assemblaggio e buttare via anche tutti i blocchi corti che sarebbero entrati dopo: i
      // blocchi delle CR arrivano a 2818 caratteri, e i 17 blocchi sopra i 1500 caratteri (su 3129)
      // potevano così azzerare tutta la coda della classifica. I blocchi arrivano qui già ordinati
      // per pertinenza, quindi saltarne uno non fa mai scavalcare un blocco più pertinente.
      continue;
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

// I blocchi delle Comprehensive Rules sono organizzati ad albero: la regola "709.5." enuncia il
// principio, e le sotto-regole "709.5a".."709.5j" lo raffinano. Il punteggio per parole chiave le
// tratta invece come blocchi indipendenti, e questo fa perdere il senso proprio nei casi difficili.
//
// Misurato sul caso delle Stanze: nell'intero capitolo 709 la parola "Room" compare in UN SOLO
// blocco su 22, la 709.5j (92 caratteri, dice soltanto che le Stanze sono carte divise con
// designazioni "porta"). La regola che risponde davvero alla domanda è la 709.5. (633 caratteri:
// finché un lato non ha la designazione "sbloccato", il permanente non ha il nome, il costo di mana
// né il testo di quel lato), e NON contiene né "room" né "door". Recuperare la 709.5j senza la
// 709.5. consegna al modello il rimando senza la regola: è esattamente il caso in cui il giudice
// citava la 709.5 e ne invertiva la conclusione.
//
// Restituisce il prefisso del blocco padre ("709.5j" -> "709.5."), oppure null se il blocco è già
// una radice. Il vincolo delle tre cifre iniziali limita di fatto la funzione alle CR: la
// numerazione dell'MTR ("3.16 Sideboard") non corrisponde, e per quel documento è un no-op.
function prefissoBloccoPadre(testoBlocco: string): string | null {
  const corrispondenza = testoBlocco.trimStart().match(/^(\d{3}\.\d+)[a-z]\b/);
  return corrispondenza ? `${corrispondenza[1]}.` : null;
}

// Antepone a ogni blocco selezionato la propria regola padre, se esiste e non è già in lista. Il
// padre va PRIMA del figlio per due motivi: enuncia il principio che il figlio raffina, e stando
// davanti sopravvive insieme a lui al limite di caratteri invece di essere accodato e troncato.
function conBlocchiPadre(selezionati: BloccoRegola[], tuttiIBlocchi: BloccoRegola[]): BloccoRegola[] {
  const risultato: BloccoRegola[] = [];
  const visti = new Set<BloccoRegola>();

  function aggiungi(blocco: BloccoRegola) {
    if (!visti.has(blocco)) {
      visti.add(blocco);
      risultato.push(blocco);
    }
  }

  for (const blocco of selezionati) {
    const prefissoPadre = prefissoBloccoPadre(blocco.testo);
    if (prefissoPadre !== null) {
      const padre = tuttiIBlocchi.find(
        (candidato) =>
          candidato.numeroCapitolo === blocco.numeroCapitolo &&
          candidato.testo.trimStart().startsWith(prefissoPadre)
      );
      if (padre) {
        aggiungi(padre);
      }
    }
    aggiungi(blocco);
  }

  return risultato;
}

// Quanto conta il voto di una parola chiave nella scelta dei capitoli suggeriti dal Glossario: una
// parola rara nel regolamento dice molto di più su quale capitolo serve di una parola diffusa.
// Misurato sul corpus attuale (3129 blocchi): "door" compare in 1 blocco e pesa 0,631; "Room" in 15
// e pesa 0,245; "Enchantment" in 55 e pesa 0,171; "permanent" in 532 e pesa 0,110. Il logaritmo
// serve a comprimere la scala: senza, una parola presente in un solo blocco varrebbe cinquecento
// volte una comune, e un singolo termine raro fuori tema deciderebbe da solo la selezione.
//
// La pesatura è applicata DELIBERATAMENTE solo qui e non al punteggio dei blocchi: quel punteggio è
// tarato su molti casi misurati, mentre questo canale è nuovo e isolato. Estenderla al punteggio
// principale resta un'ipotesi da misurare a parte.
function pesoDiRarita(blocchi: BloccoRegola[], parola: string): number {
  let quantiBlocchi = 0;
  for (const blocco of blocchi) {
    if (iniziaUnaParolaDi(blocco.testo, parola)) {
      quantiBlocchi += 1;
    }
  }
  return 1 / Math.log2(2 + quantiBlocchi);
}

// Quanti capitoli al massimo possono entrare grazie ai rimandi del Glossario ufficiale.
const MASSIMO_CAPITOLI_DA_GLOSSARIO = 2;

// Le Comprehensive Rules si chiudono con un Glossario ufficiale (726 voci, estratte a parte da
// scripts/prepara-regole.mjs) e 631 di quelle voci contengono un rimando esplicito al capitolo che
// tratta il termine, nella forma "See rule 709, 'Split Cards.'". È una mappa vocabolario -> capitolo
// scritta da Wizards: esattamente il ponte che manca alla selezione per titolo, che fallisce ogni
// volta che il titolo del capitolo non condivide parole con la domanda ("Saga Cards" non contiene
// "lore counter", "Keyword Abilities" non contiene "deathtouch", "Split Cards" non contiene "Room").
//
// Un tentativo precedente di agganciare il glossario era stato scartato perché guardava UNA PAROLA
// ALLA VOLTA, e su "Room" il glossario è ambiguo: rimanda sia a 709 "Split Cards" sia a 309
// "Dungeons", che usa "room" con un significato completamente diverso. Qui invece si contano i VOTI
// di tutte le parole chiave insieme, e l'ambiguità si scioglie da sola senza dover indovinare: nel
// caso reale delle Stanze le parole "room", "door" e "unlocked" danno 709 -> 3 voti contro
// 309 -> 1 voto, perché solo "room" è ambiguo mentre le altre due rimandano al solo 709.
//
// Ogni parola chiave vota al massimo UNA VOLTA per capitolo (da qui l'insieme intermedio): senza
// questo vincolo una parola generica come "mana", che compare in molte voci di glossario rimandanti
// allo stesso capitolo, peserebbe quanto diverse parole indipendenti che convergono.
//
// Il voto non vale però 1 per tutti: vale `pesoDiRarita` (vedi sotto). Con voti tutti uguali a 1
// bastavano poche parole generiche per soffocare quella decisiva — misurato sul caso reale delle
// Stanze con le parole chiave di un turno vero ("mana cost", "Enchantment", "permanent", "Room"):
// ogni parola generica portava un voto a un capitolo genericamente pertinente (107 "Numbers and
// Symbols", 303 "Enchantments", 110 "Permanents", 205 "Type Line", 729 "Merging with Permanents"),
// tutto pareggiava a un voto e il capitolo 709 finiva SETTIMO in classifica.
function capitoliDaGlossario(
  dati: DatiRegole,
  paroleChiave: string[],
  puntoMassimoPerCapitolo: Map<string, number>
): string[] {
  const glossario = dati.glossario;
  // Il campo è opzionale nel tipo e mtr-compatte.json non ce l'ha: l'assenza è un caso previsto,
  // non un errore.
  if (!glossario) {
    return [];
  }

  const voti = new Map<string, number>();
  for (const parola of paroleChiave) {
    const capitoliDiQuestaParola = new Set<string>();
    for (const voce of glossario) {
      if (!iniziaUnaParolaDi(voce.termine, parola)) {
        continue;
      }
      for (const rimando of voce.definizione.matchAll(/See rule (\d{3})/g)) {
        capitoliDiQuestaParola.add(rimando[1]);
      }
    }
    if (capitoliDiQuestaParola.size === 0) {
      continue;
    }
    // Calcolato solo per le parole che hanno davvero agganciato una voce di glossario, che sono
    // poche: il costo resta trascurabile anche se ogni chiamata riscorre i blocchi.
    const peso = pesoDiRarita(dati.blocchi, parola);
    for (const numeroCapitolo of capitoliDiQuestaParola) {
      voti.set(numeroCapitolo, (voti.get(numeroCapitolo) ?? 0) + peso);
    }
  }

  return [...voti.entries()]
    // Stesso controllo già usato per le regole citate: il capitolo deve esistere in QUESTA fonte.
    .filter(([numeroCapitolo]) => dati.capitoli.some((c) => c.numero === numeroCapitolo))
    .sort((a, b) => {
      const differenzaVoti = b[1] - a[1];
      if (differenzaVoti !== 0) {
        return differenzaVoti;
      }
      // A parità di voti si riusa lo spareggio già adottato per i capitoli ammessi solo per corpo,
      // invece di inventarne un altro: il capitolo davvero pertinente tende ad avere almeno un
      // blocco nettamente più specifico degli altri.
      return (puntoMassimoPerCapitolo.get(b[0]) ?? 0) - (puntoMassimoPerCapitolo.get(a[0]) ?? 0);
    })
    .slice(0, MASSIMO_CAPITOLI_DA_GLOSSARIO)
    .map(([numeroCapitolo]) => numeroCapitolo);
}

function cercaBlocchiPertinenti(dati: DatiRegole, paroleChiave: string[], regoleCitate: string[]): string {
  const paroleChiaveFiltrate = paroleChiave.filter((p) => p.length > 2);

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

  // Calcolato una sola volta e riusato sia per candidare i capitoli per corpo (sotto), sia per
  // scegliere i blocchi migliori dentro ciascun capitolo, sia per la rete di sicurezza globale.
  const punteggiBlocchi = dati.blocchi.map((blocco) => ({ blocco, punteggio: calcolaPunteggioBlocco(blocco) }));

  // Quanti punti deve avere un singolo blocco perché il suo capitolo venga considerato "pertinente
  // nel corpo": una sola parola chiave comune (punteggio 1, es. "cost") non basta, altrimenti
  // qualunque capitolo che nomina di sfuggita un termine generico entrerebbe in lista.
  const SOGLIA_PUNTEGGIO_BLOCCO_PER_CORPO = 2;
  // Quanti blocchi con quel punteggio minimo deve avere un capitolo per essere candidato SOLO in
  // base al corpo (titolo escluso). Misurato sul caso "Stanza con un solo lato sbloccato" (vedi
  // scripts/prova-ricerca.mjs): il capitolo 709 "Split Cards" contiene la regola 709.5 che risponde
  // alla domanda (il costo di mana di una Stanza dipende da quale lato è sbloccato), ma il titolo
  // non condivide vocabolario con "Room"/"door"/"unlocked"/"mana value" (lo stesso problema già
  // noto per "Saga Cards"/"lore counter" e "Keyword Abilities"/"deathtouch") e nessun suo blocco
  // è mai il più pertinente in assoluto sul documento, quindi restava fuori anche dalla rete di
  // sicurezza globale. Il capitolo però ha SEI blocchi diversi che citano "door", "unlocked",
  // "mana cost" o "locked": un segnale di pertinenza aggregato sul corpo, anche senza un titolo
  // che lo dica. La soglia 3 è scelta per escludere capitoli con un solo blocco fuori tema (es.
  // "116 Special Actions", che cita di sfuggita "locked" una volta sola) pur restando sotto le sei
  // occorrenze reali del caso misurato.
  const MINIMO_BLOCCHI_CORPO_PER_CANDIDATURA = 3;

  const blocchiCorpoPerCapitolo = new Map<string, number>();
  // Punteggio del blocco singolarmente più pertinente di ciascun capitolo. Serve da spareggio fra
  // capitoli candidati solo per corpo (vedi sotto): un conteggio di blocchi può pareggiare per puro
  // caso fra capitoli scorrelati che condividono solo parole generiche ("half", "Enchantment"), ma
  // il capitolo davvero pertinente tende ad avere ALMENO un blocco con un punteggio nettamente più
  // alto degli altri, perché quel blocco tratta l'argomento specifico invece di nominarlo di
  // sfuggita. Misurato sul caso "Stanza con un solo lato sbloccato": con le parole chiave reali
  // prodotte dalla FASE A, i capitoli 111 "Tokens", 309 "Dungeons", 702 "Keyword Abilities" e 709
  // "Split Cards" pareggiavano tutti a 8 blocchi con punteggio, e l'ordine del documento (che decide
  // i pareggi rimasti) escludeva 709 solo perché ha il numero di capitolo più alto dei quattro. Il
  // blocco più pertinente di ciascuno vale invece 2, 3, 2 e 5: 709.5j (quello che nomina
  // esplicitamente "door" e "Room") è nettamente il più specifico.
  const puntoMassimoPerCapitolo = new Map<string, number>();
  for (const { blocco, punteggio } of punteggiBlocchi) {
    if (punteggio >= SOGLIA_PUNTEGGIO_BLOCCO_PER_CORPO) {
      blocchiCorpoPerCapitolo.set(blocco.numeroCapitolo, (blocchiCorpoPerCapitolo.get(blocco.numeroCapitolo) ?? 0) + 1);
    }
    const massimoAttuale = puntoMassimoPerCapitolo.get(blocco.numeroCapitolo) ?? 0;
    if (punteggio > massimoAttuale) {
      puntoMassimoPerCapitolo.set(blocco.numeroCapitolo, punteggio);
    }
  }

  const punteggiCapitoli = dati.capitoli.map((capitolo) => {
    let punteggioTitolo = 0;
    for (const parola of paroleChiaveFiltrate) {
      if (titoloCapitoloPertinente(capitolo.titolo, parola)) {
        punteggioTitolo += 1;
      }
    }
    return {
      capitolo,
      punteggioTitolo,
      blocchiCorpo: blocchiCorpoPerCapitolo.get(capitolo.numero) ?? 0,
      puntoMassimo: puntoMassimoPerCapitolo.get(capitolo.numero) ?? 0,
    };
  });

  // Il titolo resta il criterio principale della selezione euristica (è il segnale più affidabile
  // fra quelli non certi, misurato su molti casi).
  const MASSIMO_CAPITOLI_PER_TITOLO = 4;
  const capitoliPerTitolo = punteggiCapitoli
    .filter((c) => c.punteggioTitolo > 0)
    .sort((a, b) => b.punteggioTitolo - a.punteggioTitolo)
    .slice(0, MASSIMO_CAPITOLI_PER_TITOLO)
    .map((c) => c.capitolo.numero);

  // I candidati SOLO per corpo (punteggio di titolo zero) hanno un budget di capitoli separato,
  // più piccolo, invece di competere con quelli per titolo per lo stesso taglio. Motivo: quando più
  // capitoli scorrelati pareggiano per puro caso sul punto massimo (vedi `puntoMassimoPerCapitolo`
  // sopra), un taglio unico ammette solo IL PRIMO in ordine di documento, ed è un caso reale, non
  // ipotetico — misurato sul caso "Stanza con un solo lato sbloccato": con le parole chiave vere
  // della FASE A, il capitolo 709 "Split Cards" pareggia a punteggio massimo 5 con "205 Type Line"
  // (che tratta i sottotipi di incantesimo in generale, non le Stanze in particolare), e un solo
  // slot ammetteva 205 ma non 709 solo perché "205" precede "709" nel documento. Ammettendone due
  // entrano entrambi, senza dover indovinare quale dei due pareggianti sia quello vero.
  const MASSIMO_CAPITOLI_SOLO_CORPO = 2;
  const capitoliSoloCorpo = punteggiCapitoli
    .filter((c) => c.punteggioTitolo === 0 && c.blocchiCorpo >= MINIMO_BLOCCHI_CORPO_PER_CANDIDATURA)
    .sort((a, b) => b.puntoMassimo - a.puntoMassimo)
    .slice(0, MASSIMO_CAPITOLI_SOLO_CORPO)
    .map((c) => c.capitolo.numero);

  const capitoliPerTitoloOCorpo = [...capitoliPerTitolo, ...capitoliSoloCorpo];

  // Quarto canale di selezione, accanto a titolo / corpo / regola citata: i rimandi del Glossario
  // ufficiale (vedi `capitoliDaGlossario` sopra). Serve a recuperare i capitoli il cui titolo non
  // condivide vocabolario con la domanda, che gli altri canali non vedono. I capitoli già ammessi
  // da un altro canale vengono esclusi qui per non finire due volte in `capitoliSelezionati`:
  // conserverebbero comunque il budget di blocchi del canale che li ha ammessi per primo.
  const capitoliGlossario = capitoliDaGlossario(dati, paroleChiaveFiltrate, puntoMassimoPerCapitolo)
    .filter((numero) => !capitoliPerTitoloOCorpo.includes(numero));

  const capitoliSelezionati = [...capitoliPerTitoloOCorpo, ...capitoliGlossario];

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

  // Prende i migliori blocchi PER CIASCUN capitolo selezionato (invece di un unico taglio
  // "top N assoluti" su tutti i capitoli insieme), così un capitolo poco chiacchierone ma
  // decisivo (es. 714 "Saga Cards" con un solo blocco davvero pertinente) non viene escluso
  // solo perché un altro capitolo tra quelli scelti (es. 305 "Lands", con molti più blocchi)
  // ne ha tanti con punteggio pari o superiore.
  const MASSIMO_BLOCCHI_PER_CAPITOLO = 6;

  // I capitoli ammessi solo per corpo hanno diritto a meno blocchi ciascuno dei capitoli trovati per
  // titolo (un segnale più affidabile): quando più di uno di questi capitoli viene ammesso (vedi
  // `capitoliSoloCorpo` sopra), un budget pieno per ciascuno esaurirebbe comunque LIMITE_CARATTERI
  // prima che tocchi al secondo, vanificando il motivo per cui se ne ammette più di uno.
  const MASSIMO_BLOCCHI_PER_CAPITOLO_SOLO_CORPO = 3;
  const insiemeCapitoliSoloCorpo = new Set(capitoliSoloCorpo);

  // I capitoli agganciati dal Glossario stanno in mezzo fra gli altri due budget: il rimando è
  // ufficiale, quindi più affidabile di un segnale ricavato dal solo corpo del testo, ma indica il
  // CAPITOLO e non il blocco, quindi non merita il budget pieno dei capitoli trovati per titolo.
  const MASSIMO_BLOCCHI_PER_CAPITOLO_DA_GLOSSARIO = 4;
  const insiemeCapitoliGlossario = new Set(capitoliGlossario);

  function quantiBlocchiPerCapitolo(numeroCapitolo: string): number {
    if (insiemeCapitoliSoloCorpo.has(numeroCapitolo)) {
      return MASSIMO_BLOCCHI_PER_CAPITOLO_SOLO_CORPO;
    }
    if (insiemeCapitoliGlossario.has(numeroCapitolo)) {
      return MASSIMO_BLOCCHI_PER_CAPITOLO_DA_GLOSSARIO;
    }
    return MASSIMO_BLOCCHI_PER_CAPITOLO;
  }

  function miglioriBlocchiTra(elementi: { blocco: BloccoRegola; punteggio: number }[], quanti: number) {
    return elementi
      .filter((b) => b.punteggio > 0)
      .sort((a, b) => b.punteggio - a.punteggio)
      .slice(0, quanti);
  }

  const perCapitolo = capitoliSelezionati.flatMap((numeroCapitolo) =>
    miglioriBlocchiTra(
      punteggiBlocchi.filter(({ blocco }) => blocco.numeroCapitolo === numeroCapitolo),
      quantiBlocchiPerCapitolo(numeroCapitolo)
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
  const globali = miglioriBlocchiTra(punteggiBlocchi, quantiGlobali);

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

  return assemblaEstratti(conBlocchiPadre(senzaDuplicati.map((item) => item.blocco), dati.blocchi));
}