// Normalizzazione di quello che la FASE A si fa restituire da Gemini.
//
// Vive qui e non dentro `route.ts` per poter essere importato da `scripts/prova-estrazione.mjs`,
// che lo mette alla prova sui casi limite senza chiamare Gemini. Per la stessa ragione questo
// modulo non usa l'alias `@/`, che Node non risolve.
//
// Perché serve. `eseguiEstrazioneFaseA` si limitava a controllare che i tre campi fossero array,
// con `Array.isArray`. Ma un array non è una promessa su cosa contiene: un JSON perfettamente
// valido come `{"card_names": [42]}` superava il controllo, e più a valle `cercaDatiCarta(42)`
// chiamava `.trim()` su un numero — metodo che i numeri non hanno — facendo fallire l'INTERA
// richiesta con un 500, per giunta senza spiegare all'utente cosa fosse successo.
//
// Il principio è quello che il progetto applica già alla cronologia (`normalizzaCronologia` in
// `route.ts`): l'uscita di un modello linguistico è input non fidato, alla pari del corpo di una
// richiesta HTTP. Gemini di solito rispetta il formato chiesto dal prompt, ma "di solito" non è
// una garanzia su cui costruire, e qui l'unico modo di scoprire la violazione era un 500.

export type LimitiLista = {
  massimoElementi: number;
  massimaLunghezzaElemento: number;
};

// I tre limiti sono diversi perché diverse sono le cose che contano, e un limite unico sarebbe
// sbagliato per almeno una delle tre.
//
// Parole chiave: nelle estrazioni reali registrate nei log sono 6-10, più le parole della riga del
// tipo che `route.ts` aggiunge DOPO (quelle non passano di qui). 30 lascia molto margine senza
// permettere a un'estrazione impazzita di gonfiare la ricerca locale, che confronta ogni parola
// contro tutti i 3869 blocchi delle CR.
export const LIMITI_PAROLE_CHIAVE: LimitiLista = {
  massimoElementi: 30,
  massimaLunghezzaElemento: 60,
};

// Numeri di regola: la forma è "714.4" o "113.7a", 6-8 caratteri. 30 caratteri coprono con
// abbondanza anche le forme scritte male dal modello ("regola 113.7a"), che la ricerca poi ignora
// da sé.
export const LIMITI_REGOLE_CITATE: LimitiLista = {
  massimoElementi: 20,
  massimaLunghezzaElemento: 30,
};

// Nomi di carta: **qui il limite di lunghezza va misurato, non indovinato**. Il nome di carta più
// lungo mai stampato in Magic ("Our Market Research Shows That Players Like Really Long Card Names
// So We Made this Card to Have the Absolute Longest Card Name Ever Elemental") è di 141 caratteri:
// un tetto stretto come quello delle parole chiave lo taglierebbe a metà e Scryfall non lo
// troverebbe più. 160 lo contiene con margine.
//
// Il numero di elementi è 12 e non 6: `route.ts` cerca su Scryfall solo le prime 6 carte, ma la
// lista intera passa anche a `cercaErrataPertinenti`, che non fa chiamate di rete e non ha motivo
// di fermarsi a 6. Il taglio a 6 resta dov'era, in `route.ts`, e non viene anticipato qui.
export const LIMITI_NOMI_CARTE: LimitiLista = {
  massimoElementi: 12,
  massimaLunghezzaElemento: 160,
};

// Riduce un valore qualunque a un `string[]` utilizzabile: tiene solo le stringhe, le ripulisce ai
// bordi, scarta le vuote, toglie i doppioni e rispetta i due limiti. Se il valore non è nemmeno un
// array restituisce la lista vuota, che è il comportamento che `eseguiEstrazioneFaseA` aveva già
// per il campo mancante.
export function normalizzaListaTesti(valore: unknown, limiti: LimitiLista): string[] {
  if (!Array.isArray(valore)) {
    return [];
  }

  const risultato: string[] = [];
  const chiaviViste = new Set<string>();

  for (const elemento of valore) {
    // Il tetto si applica agli elementi TENUTI, non a quelli letti: così una lista piena di
    // doppioni o di valori scartati non consuma i posti disponibili per quelli buoni.
    if (risultato.length >= limiti.massimoElementi) {
      break;
    }

    if (typeof elemento !== "string") {
      continue;
    }

    // Il secondo `trim` non è di troppo: il taglio a lunghezza massima può lasciare uno spazio in
    // coda, e uno spazio in coda in un nome di carta manda a vuoto la ricerca su Scryfall.
    const ripulito = elemento.trim().slice(0, limiti.massimaLunghezzaElemento).trim();
    if (ripulito === "") {
      continue;
    }

    // Doppioni ignorando maiuscole e minuscole, come fa già `senzaDoppioni` in `lib/rules.ts`.
    // Non è un dettaglio estetico: `cercaRegoleTorneo` NON deduplica le parole chiave, e assegna
    // un punto per ogni parola che aggancia un blocco. Due copie della stessa parola valgono
    // quindi due punti, spostando l'ordine dei blocchi MTR — e siccome `assemblaEstratti` tronca a
    // `LIMITE_CARATTERI`, l'ordine decide QUALI regole arrivano davvero a Gemini.
    //
    // Sopravvive la PRIMA occorrenza, con le maiuscole che aveva: "Blood Moon" non va trasformato
    // in "blood moon", perché il nome serve così com'è alla ricerca fuzzy di Scryfall.
    const chiave = ripulito.toLowerCase();
    if (chiaviViste.has(chiave)) {
      continue;
    }
    chiaviViste.add(chiave);
    risultato.push(ripulito);
  }

  return risultato;
}


// L'esito della FASE A, già normalizzato. Il tipo vive qui e non in `route.ts` perché è il
// contratto che `normalizzaEstrazioneFaseA` garantisce: da qui in poi i tre campi sono `string[]`,
// senza eccezioni.
export type RisultatoEstrazioneFaseA = {
  keywords: string[];
  citedRules: string[];
  cardNames: string[];
};

// Trasforma in un `RisultatoEstrazioneFaseA` quello che `JSON.parse` ha restituito, oppure `null`
// se non è nemmeno un oggetto su cui abbia senso cercare i tre campi.
//
// Il `null` è deliberato, e va tenuto distinto da "tre liste vuote". `JSON.parse` accetta anche
// `"null"`, `"42"` e `"[]"`: sono JSON validi, ma non sono la risposta che il prompt ha chiesto.
// Restituendo liste vuote in silenzio, quel caso diventerebbe indistinguibile da un'estrazione
// riuscita ma povera, e nei log non resterebbe traccia — mentre è proprio quella traccia a dire a
// chi gestisce il servizio che il giudice sta per rispondere senza fonti.
//
// Il controllo di forma sta qui, e non dentro `route.ts`, per poter essere messo alla prova da
// scripts/prova-estrazione.mjs sul caso che ha motivato tutto questo lavoro: `{"card_names": [42]}`,
// un JSON valido che superava `Array.isArray` e faceva poi rispondere 500 all'intera richiesta.
export function normalizzaEstrazioneFaseA(valore: unknown): RisultatoEstrazioneFaseA | null {
  if (valore === null || typeof valore !== "object" || Array.isArray(valore)) {
    return null;
  }

  const campi = valore as Record<string, unknown>;

  return {
    keywords: normalizzaListaTesti(campi.keywords, LIMITI_PAROLE_CHIAVE),
    citedRules: normalizzaListaTesti(campi.cited_rules, LIMITI_REGOLE_CITATE),
    cardNames: normalizzaListaTesti(campi.card_names, LIMITI_NOMI_CARTE),
  };
}
