// Banco di prova della normalizzazione dell'output della FASE A.
//
// Perché serve. `eseguiEstrazioneFaseA` si fidava di `Array.isArray`, che dice solo che il campo è
// un array, non cosa contiene: `{"card_names": [42]}` è un JSON perfettamente valido che superava
// il controllo, e più a valle `cercaDatiCarta(42)` chiamava `.trim()` su un numero facendo
// rispondere 500 all'INTERA richiesta. Gemini di solito rispetta il formato chiesto dal prompt, ma
// "di solito" non è una garanzia, e l'unico modo di accorgersi della violazione era un errore 500.
//
// Come `prova-ricerca.mjs` e `prova-verifica.mjs`: importa le funzioni reali di lib/ (Node stripa i
// tipi da solo), quindi prova il codice che va in produzione e non una copia della sua logica. È il
// motivo per cui `lib/estrazione.ts` non usa l'alias `@/`, che Node non risolve — e per cui il
// controllo di forma sta lì e non dentro `route.ts`, altrimenti il caso del bug non sarebbe
// provabile da qui. Non chiama Gemini, non tocca la rete: gratuito, istantaneo, deterministico.
//
// A differenza di `prova-ricerca`, qui non esistono "fallimenti noti" da cui migliorare: ogni caso
// è un'affermazione su cosa la funzione deve fare, quindi un caso rosso è un difetto e l'uscita è
// diversa da zero.
//
// Uso: npm run prova-estrazione

import {
  normalizzaListaTesti,
  normalizzaEstrazioneFaseA,
  LIMITI_PAROLE_CHIAVE,
  LIMITI_REGOLE_CITATE,
  LIMITI_NOMI_CARTE,
} from "../lib/estrazione.ts";

// Il nome di carta più lungo mai stampato in Magic: 141 caratteri. Serve a dimostrare perché il
// tetto di lunghezza dei nomi di carta non può essere lo stesso delle parole chiave.
const NOME_CARTA_PIU_LUNGO =
  "Our Market Research Shows That Players Like Really Long Card Names So We Made this Card to Have the Absolute Longest Card Name Ever Elemental";

const LIMITI_FINTI_CORTI = { massimoElementi: 5, massimaLunghezzaElemento: 3 };

const CASI_LISTA = [
  {
    nome: "una lista già pulita passa invariata",
    valore: ["lore counter", "triggered ability", "stack"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["lore counter", "triggered ability", "stack"],
  },
  {
    nome: "IL CASO DEL BUG: un array di numeri non produce più stringhe finte",
    valore: [42],
    limiti: LIMITI_NOMI_CARTE,
    atteso: [],
  },
  {
    nome: "tipi misti: sopravvivono solo le stringhe",
    valore: ["Blood Moon", 42, null, undefined, {}, ["Urza's Saga"], true, "Urza's Saga"],
    limiti: LIMITI_NOMI_CARTE,
    atteso: ["Blood Moon", "Urza's Saga"],
  },
  {
    nome: "spazi e a capo ai bordi vengono tolti",
    valore: ["  lore counter  ", "\n stack \t"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["lore counter", "stack"],
  },
  {
    nome: "stringhe vuote e di soli spazi vengono scartate",
    valore: ["", "   ", "\t\n", "saga"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["saga"],
  },
  {
    nome: "doppioni identici: sopravvive il primo",
    valore: ["Saga", "Saga", "Saga"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["Saga"],
  },
  {
    nome: "doppioni di sole maiuscole: sopravvive il primo CON le sue maiuscole",
    valore: ["Enchantment", "enchantment", "ENCHANTMENT"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["Enchantment"],
  },
  {
    nome: "doppioni che tali diventano solo dopo il trim",
    valore: ["saga", "  saga  "],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["saga"],
  },
  {
    nome: "l'ordine di prima apparizione non cambia",
    valore: ["stack", "saga", "stack", "lands", "saga"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["stack", "saga", "lands"],
  },
  {
    nome: "non-array: null",
    valore: null,
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: [],
  },
  {
    nome: "non-array: campo mancante (undefined)",
    valore: undefined,
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: [],
  },
  {
    nome: "non-array: una stringa sola invece di una lista",
    valore: "lore counter",
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: [],
  },
  {
    nome: "non-array: un oggetto",
    valore: { keywords: "saga" },
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: [],
  },
  {
    nome: "tetto sul numero di elementi",
    valore: Array.from({ length: 100 }, (_, i) => `parola${i}`),
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: Array.from({ length: LIMITI_PAROLE_CHIAVE.massimoElementi }, (_, i) => `parola${i}`),
  },
  {
    nome: "il tetto conta gli elementi TENUTI, non quelli letti: 70 doppioni non rubano i posti",
    valore: [...Array.from({ length: 70 }, () => "saga"), "stack", "lands", "counter"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["saga", "stack", "lands", "counter"],
  },
  {
    nome: "gli elementi scartati non rubano i posti",
    valore: [...Array.from({ length: 70 }, () => 42), "saga", "stack"],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["saga", "stack"],
  },
  {
    nome: "una stringa troppo lunga viene tagliata al limite",
    valore: ["x".repeat(500)],
    limiti: LIMITI_PAROLE_CHIAVE,
    atteso: ["x".repeat(LIMITI_PAROLE_CHIAVE.massimaLunghezzaElemento)],
  },
  {
    nome: "il taglio non lascia spazi in coda (uno spazio manda a vuoto Scryfall)",
    valore: ["ab cd"],
    limiti: LIMITI_FINTI_CORTI,
    atteso: ["ab"],
  },
  {
    nome: "il nome di carta più lungo di Magic (141 caratteri) sopravvive intero",
    valore: [NOME_CARTA_PIU_LUNGO],
    limiti: LIMITI_NOMI_CARTE,
    atteso: [NOME_CARTA_PIU_LUNGO],
  },
  {
    nome: "numeri di regola: ripuliti e deduplicati",
    valore: ["714.4", " 113.7a ", "714.4", 305, ""],
    limiti: LIMITI_REGOLE_CITATE,
    atteso: ["714.4", "113.7a"],
  },
];

const CASI_OGGETTO = [
  {
    nome: "estrazione normale, tutti e tre i campi",
    valore: {
      keywords: ["lore counter", "saga"],
      cited_rules: ["714.4"],
      card_names: ["Urza's Saga", "Blood Moon"],
    },
    atteso: {
      keywords: ["lore counter", "saga"],
      citedRules: ["714.4"],
      cardNames: ["Urza's Saga", "Blood Moon"],
    },
  },
  {
    nome: 'IL CASO DEL BUG, per intero: {"card_names": [42]} non arriva più a Scryfall',
    valore: { card_names: [42] },
    atteso: { keywords: [], citedRules: [], cardNames: [] },
  },
  {
    nome: "campi mancanti: tre liste vuote, non un errore",
    valore: {},
    atteso: { keywords: [], citedRules: [], cardNames: [] },
  },
  {
    nome: "campi del tipo sbagliato: tre liste vuote",
    valore: { keywords: "saga", cited_rules: 714.4, card_names: null },
    atteso: { keywords: [], citedRules: [], cardNames: [] },
  },
  {
    nome: 'JSON valido ma non un oggetto: "null" -> null, così il log lo segnala',
    valore: null,
    atteso: null,
  },
  {
    nome: 'JSON valido ma non un oggetto: "42" -> null',
    valore: 42,
    atteso: null,
  },
  {
    nome: 'JSON valido ma non un oggetto: "[]" -> null',
    valore: [],
    atteso: null,
  },
  {
    nome: "JSON valido ma non un oggetto: una stringa -> null",
    valore: "lore counter",
    atteso: null,
  },
];

let falliti = 0;

function verifica(nome, ottenuto, atteso) {
  const ottenutoTesto = JSON.stringify(ottenuto);
  const attesoTesto = JSON.stringify(atteso);
  if (ottenutoTesto === attesoTesto) {
    console.log(`OK      ${nome}`);
    return;
  }
  falliti++;
  console.log(`FALLITO ${nome}`);
  console.log(`        atteso:   ${attesoTesto}`);
  console.log(`        ottenuto: ${ottenutoTesto}`);
}

console.log("normalizzaListaTesti — la ripulitura di una singola lista\n");
for (const caso of CASI_LISTA) {
  verifica(caso.nome, normalizzaListaTesti(caso.valore, caso.limiti), caso.atteso);
}

console.log("\nnormalizzaEstrazioneFaseA — l'oggetto intero, come esce da JSON.parse\n");
for (const caso of CASI_OGGETTO) {
  verifica(caso.nome, normalizzaEstrazioneFaseA(caso.valore), caso.atteso);
}

const totale = CASI_LISTA.length + CASI_OGGETTO.length;
console.log(`\n${totale - falliti}/${totale} casi passano`);

if (falliti > 0) {
  console.log(`${falliti} FALLITI: la normalizzazione non fa quello che deve.`);
}

process.exit(falliti > 0 ? 1 : 0);
