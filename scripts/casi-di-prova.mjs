// Casi di prova condivisi fra i due banchi di prova della ricerca locale:
// `prova-ricerca.mjs` (i blocchi decisivi vengono recuperati?) e `prova-verifica.mjs` (su quanti di
// questi casi scatta la FASE E?). Stanno in un file a parte per non essere copiati in due posti:
// una lista di casi duplicata invecchia male, e le due prove devono guardare gli stessi scenari.
//
// Ogni caso fissa le parole chiave che la FASE A produrrebbe plausibilmente per una domanda, e
// dichiara cosa deve (o non deve) comparire negli estratti restituiti.
//
// "attesi" e "nonVoluti" sono cercati come testo semplice negli estratti: possono essere un numero
// di regola ("714.4") o un'intestazione di capitolo ("[Capitolo 502"), che è il modo più diretto
// per affermare che un capitolo irrilevante non deve essere stato selezionato.
//
// "statoIniziale" documenta l'esito misurato PRIMA delle correzioni al recupero, così un
// fallimento noto non viene confuso con una regressione appena introdotta.
export const CASI = [
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
    // Stessa domanda del caso qui sopra (lo scenario benchmark: Blood Moon su Urza's Saga al
    // secondo capitolo), ma con le parole chiave REALI prodotte dalla FASE A in quel turno,
    // copiate dal log di produzione. Il caso precedente usa parole scelte a mano e passa; questo
    // fallisce, e la differenza fra i due misura quanto il recupero dipenda dal vocabolario che
    // arriva davvero invece che da quello ideale.
    //
    // Due differenze decisive rispetto alle parole da laboratorio:
    // 1. la FASE A produce "ability", non "chapter ability", e non produce affatto "sacrifice";
    // 2. route.ts aggiunge in automatico le parole della riga del tipo di Scryfall, e qui sono
    //    quattro tipi generici ("Enchantment" due volte, perché lo sono sia Urza's Saga sia Blood
    //    Moon, più "Land") che compaiono in centinaia di blocchi.
    // Il punteggio dei blocchi è binario (+1 per parola chiave trovata), quindi "Enchantment" e
    // "Land" pesano quanto "lore counter" e trascinano in classifica capitoli genericamente
    // pertinenti (205 "Type Line", 303 "Enchantments", 305 "Lands") al posto del 714 "Saga Cards".
    // Notare che "Saga" È fra le parole chiave e nonostante questo il capitolo non entra.
    //
    // Misurato dal vivo con lo scenario benchmark a 3 turni: il verdetto cita 714.4, 714.2d e
    // 714.3b senza che nessuna delle tre compaia negli estratti (il rilevatore di citazioni senza
    // fonte in route.ts le registra), quindi il modello le prende dalla propria memoria. La
    // risposta resta corretta solo perché la nota di data/errata-locali.json su Urza's Saga
    // enuncia già quelle regole per esteso: su una Saga senza errata non ci sarebbe nulla.
    //
    // È il caso di prova che manca alla voce "Estendere la pesatura per rarità al punteggio dei
    // blocchi" di CLAUDE.md: serve per misurare quella modifica invece di indovinarla.
    nome: "Saga: parole chiave reali, coi tipi generici di Scryfall",
    fonte: "CR",
    paroleChiave: [
      "enchantment",
      "land",
      "lore counter",
      "ability",
      "type-changing effect",
      "Enchantment",
      "Land",
      "Urza",
      "Saga",
      "Enchantment",
    ],
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
    // Domanda reale di un utente: costo di mana di una Stanza (Room) sul campo con un solo lato
    // sbloccato (Roaring Furnace, senza Bottomless Pool). La regola decisiva è 709.5 (radice): finché
    // un permanente non ha la designazione "lato sbloccato" per un lato, non ha il nome, il costo di
    // mana né il testo di QUEL lato. Il capitolo 709 si intitola "Split Cards" e non condivide
    // vocabolario con "Room"/"door"/"unlocked"/"mana value" (stesso problema già noto per "Saga
    // Cards"/"lore counter" e "Keyword Abilities"/"deathtouch"), e il blocco 709.5 non è mai il più
    // pertinente del documento su parole chiave comuni come "mana cost"/"locked" (a differenza dei
    // casi già risolti, dove il blocco decisivo era primo su tutto il documento): resta fuori dalla
    // rete di sicurezza di 3 blocchi. Il giudice, privo di questa regola, ha risposto di non avere
    // fonti sufficienti invece di calcolare il valore di mana del solo lato sbloccato.
    nome: "Stanza (Room) con un solo lato sbloccato",
    fonte: "CR",
    paroleChiave: ["Room", "door", "unlocked", "mana cost", "mana value", "locked"],
    regoleCitate: [],
    attesi: ["709.5."],
    nonVoluti: [],
    statoIniziale: "FALLISCE",
  },
  {
    // Stessa domanda del caso precedente, ma con le parole chiave POVERE che la FASE A produce
    // davvero in certi turni: solo il nome della meccanica, senza i descrittori di stato. Serve
    // perché il caso qui sopra usa parole scelte a mano, e passava già mentre la produzione
    // sbagliava: senza questa variante non si distingue un miglioramento vero da uno fortunato.
    //
    // Difficoltà specifica, misurata: nell'intero capitolo 709 la parola "Room" compare in UN SOLO
    // blocco su 22, la 709.5j, che è un rimando di 92 caratteri e non risponde alla domanda. La
    // regola decisiva 709.5. non contiene né "room" né "door", quindi prende punteggio zero e
    // veniva scartata dal filtro `punteggio > 0` anche quando il capitolo 709 era selezionato.
    nome: "Stanza: solo il nome della meccanica",
    fonte: "CR",
    paroleChiave: ["Room", "door"],
    regoleCitate: [],
    attesi: ["709.5."],
    nonVoluti: [],
    statoIniziale: "FALLISCE",
  },
  {
    // Variante più dura ancora: le parole generiche di un turno reale ("mana cost", "Enchantment",
    // "permanent") con "Room" annegato in mezzo. Qui il capitolo 709 esiste nella classifica dei
    // voti del Glossario ma è SETTIMO, perché ogni parola generica porta un voto ad altrettanti
    // capitoli genericamente pertinenti (107 "Numbers and Symbols", 303 "Enchantments", 110
    // "Permanents", 205 "Type Line", 729 "Merging with Permanents") e tutto pareggia a un voto.
    nome: "Stanza: nome della meccanica annegato fra parole generiche",
    fonte: "CR",
    paroleChiave: ["mana cost", "Enchantment", "permanent", "Room"],
    regoleCitate: [],
    attesi: ["709.5."],
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
