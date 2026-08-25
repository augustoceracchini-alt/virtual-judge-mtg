export type ImmagineSelezionata = {
  base64: string;
  mimeType: string;
  anteprimaUrl: string;
};

export type DomandaChiarimento = {
  domanda: string;
  opzioni: string[];
};

// Cosa è successo dentro l'app mentre preparava QUESTA risposta: quali parole chiave sono state
// estratte, quali capitoli di regolamento sono arrivati al modello, se il doppio controllo è
// scattato. Torna da /api/judge insieme al verdetto e non viene mai mostrata all'utente: serve solo
// a essere rimandata indietro con una segnalazione, perché senza di essa un caso segnalato non è
// riproducibile (la FASE A produce parole chiave diverse a ogni esecuzione).
export type DiagnosticaRisposta = {
  paroleChiave: string[];
  regoleCitate: string[];
  carte: string[];
  capitoliCR: string[];
  capitoliMTR: string[];
  faseE: boolean;
  citazioniSenzaFonte: string[];
  conFoto: boolean;
};

export type MessaggioCronologia = {
  ruolo: "utente" | "giudice";
  testo: string;
  chiarimenti?: DomandaChiarimento[];
  diagnostica?: DiagnosticaRisposta;
};
