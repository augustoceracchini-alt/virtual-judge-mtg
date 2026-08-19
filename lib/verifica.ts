// Rilevatore che decide se far scattare la FASE E, il doppio controllo del verdetto.
//
// Vive qui e non dentro `route.ts` per poter essere importato da `scripts/prova-verifica.mjs`, che
// misura su quanti casi reali la verifica scatta: senza quel numero non si sa se la FASE E (7,5 s
// su 11,5 misurati) pesi su quasi tutte le richieste o solo su poche. Per la stessa ragione questo
// modulo non usa l'alias `@/`, che Node non risolve.

// Indicatori testuali del tipo di regola condizionale a più clausole (spesso un'azione basata
// sullo stato con un confronto numerico) su cui il modello ha già mostrato di sbagliare più
// facilmente il ragionamento passo-passo (es. la regola 714.4 sul sacrificio delle Saghe).
// Ogni voce deve descrivere una CONDIZIONE DA RICALCOLARE, non un meccanismo di gioco: sono state
// tolte "state-based action" e " and it is" perché nominano soltanto il meccanismo e ricorrono in
// mezzo regolamento. Misurato con `npm run prova-verifica`: "state-based action" da sola causava 6
// scatti su 9, arrivando a far ricontrollare perfino una domanda sulla corruzione in torneo, dove
// non c'è nulla di condizionale. Toglierle porta gli scatti da 9 casi su 13 a 8, senza perdere
// nessuno dei cinque casi in cui la verifica è servita davvero (Saga 714.4 e le tre varianti
// Stanze/709.5, coperti dai confronti quantitativi e dal pattern specifico qui sotto).
//
// Provata e scartata anche la strada opposta, aggiungere le quantità scritte a parole ("at least",
// "more than", "fewer than"): riportava gli scatti a 9 su 13 e ne accendeva di nuovi altrettanto
// inutili, fra cui una domanda sul sideboard. Sono locuzioni troppo comuni.
export const INDICATORI_REGOLA_CONDIZIONALE = [
  "greater than or equal",
  "less than or equal",
  "equal to or greater",
  "equal to or less",
  "if the number of",
  // Formula esatta della regola dei permanenti leggendari (704.5j, "If two or more legendary
  // permanents with the same name are controlled by..."): è una condizione a più clausole che non
  // usa nessuno dei confronti qui sopra, quindi senza questa voce resterebbe senza innesco.
  // Aggiunta la formula precisa e non il generico "or more", che è comunissimo.
  "two or more",
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
