export type ImmagineSelezionata = {
  base64: string;
  mimeType: string;
  anteprimaUrl: string;
};

export type DomandaChiarimento = {
  domanda: string;
  opzioni: string[];
};

export type MessaggioCronologia = {
  ruolo: "utente" | "giudice";
  testo: string;
  chiarimenti?: DomandaChiarimento[];
};
