// Rilevatore che decide se far scattare la FASE E, il doppio controllo del verdetto.
//
// Vive qui e non dentro `route.ts` per poter essere importato da `scripts/prova-verifica.mjs`, che
// misura su quanti casi reali la verifica scatta: senza quel numero non si sa se la FASE E (7,5 s
// su 11,5 misurati) pesi su quasi tutte le richieste o solo su poche. Per la stessa ragione questo
// modulo non usa l'alias `@/`, che Node non risolve.

// Indicatori testuali del tipo di regola condizionale a più clausole (spesso un'azione basata
// sullo stato con un confronto numerico) su cui il modello ha già mostrato di sbagliare più
// facilmente il ragionamento passo-passo (es. la regola 714.4 sul sacrificio delle Saghe).
export const INDICATORI_REGOLA_CONDIZIONALE = [
  "state-based action",
  "greater than or equal",
  "less than or equal",
  "equal to or greater",
  "equal to or less",
  // Copre anche "and it isn't": qualsiasi testo che contenga quella forma contiene già questa.
  " and it is",
  "if the number of",
  // Regola 709.5 (Stanze/Room e altre carte con riga del tipo condivisa): "As long as this
  // permanent doesn't have [designazione], it doesn't have [caratteristica]". Caso reale: il
  // giudice ha citato correttamente la 709.5 ma ne ha invertito la conclusione (ha detto che il
  // costo di mana si combina SEMPRE, quando la regola dice il contrario per il lato bloccato), e
  // la FASE E non scattava perché nessun indicatore esistente compare in questo testo.
  "as long as this permanent doesn't have",
];

// Indica se il testo delle regole citate contiene uno di quegli indicatori. Quando è così, la
// risposta viene fatta ricontrollare da un secondo passaggio dedicato (FASE E) prima di essere
// inviata all'utente.
export function contieneRegolaCondizionaleComplessa(testoRegole: string): boolean {
  // Gli apostrofi vengono uniformati all'ASCII su ENTRAMBI i lati del confronto. Il testo ufficiale
  // delle CR usa l'apostrofo tipografico (U+2019), gli indicatori qui sopra sono scritti in ASCII:
  // senza questa normalizzazione l'indicatore della 709.5 non troverebbe mai il proprio testo. La
  // dipendenza era fragile in entrambe le direzioni — bastava che una rigenerazione di
  // data/regole-compatte.json normalizzasse la punteggiatura, o che qualcuno riscrivesse un
  // indicatore copiandolo da un'altra fonte, per spegnere il controllo in silenzio.
  const testoNormalizzato = testoRegole.toLowerCase().replace(/[‘’]/g, "'");
  return INDICATORI_REGOLA_CONDIZIONALE.some((indicatore) => testoNormalizzato.includes(indicatore));
}
