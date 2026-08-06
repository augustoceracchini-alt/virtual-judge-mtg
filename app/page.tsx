"use client";

import { useRef, useState } from "react";

// Illustrazione di "Balance" (Kev Walker) via Scryfall, usata come sfondo decorativo
// dietro tutta la chat: stessa fonte di immagini già usata dall'app per i dati delle carte.
const IMMAGINE_SFONDO =
  "https://cards.scryfall.io/art_crop/front/c/e/ce648aa3-098b-4af0-a433-fd290bc85904.jpg";

function Fregio() {
  return (
    <svg viewBox="0 0 24 24" className="fregio-titolo h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M12 1 L15 9 L23 12 L15 15 L12 23 L9 15 L1 12 L9 9 Z" />
    </svg>
  );
}

type ImmagineSelezionata = {
  base64: string;
  mimeType: string;
  anteprimaUrl: string;
};

type DomandaChiarimento = {
  domanda: string;
  opzioni: string[];
};

type MessaggioCronologia = {
  ruolo: "utente" | "giudice";
  testo: string;
  chiarimenti?: DomandaChiarimento[];
};

function estraiTestoEChiarimenti(rispostaGrezza: string): {
  testo: string;
  chiarimenti: DomandaChiarimento[];
} {
  const marcatoreInizio = "===OPZIONI_CHIARIMENTO===";
  const marcatoreFine = "===FINE_OPZIONI===";
  const indiceInizio = rispostaGrezza.indexOf(marcatoreInizio);
  const indiceFine = rispostaGrezza.indexOf(marcatoreFine);

  if (indiceInizio === -1 || indiceFine === -1 || indiceFine < indiceInizio) {
    return { testo: rispostaGrezza, chiarimenti: [] };
  }

  const testoPulito = (
    rispostaGrezza.slice(0, indiceInizio) +
    rispostaGrezza.slice(indiceFine + marcatoreFine.length)
  ).trim();

  const jsonGrezzo = rispostaGrezza
    .slice(indiceInizio + marcatoreInizio.length, indiceFine)
    .trim();

  let chiarimenti: DomandaChiarimento[] = [];
  try {
    const parsato = JSON.parse(jsonGrezzo);
    if (Array.isArray(parsato)) {
      chiarimenti = parsato.filter(
        (voce): voce is DomandaChiarimento =>
          voce &&
          typeof voce.domanda === "string" &&
          Array.isArray(voce.opzioni) &&
          voce.opzioni.every((opzione: unknown) => typeof opzione === "string")
      );
    }
  } catch {
    chiarimenti = [];
  }

  return { testo: testoPulito, chiarimenti: chiarimenti };
}

export default function Home() {
  const [messaggioCorrente, setMessaggioCorrente] = useState("");
  const [cronologia, setCronologia] = useState<MessaggioCronologia[]>([]);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [immagine, setImmagine] = useState<ImmagineSelezionata | null>(null);
  const inputFileRef = useRef<HTMLInputElement>(null);

  // Identifica la conversazione in corso. Viene incrementato a ogni azzeramento, così una
  // richiesta partita prima dell'azzeramento può accorgersi, quando la risposta arriva, che
  // intanto la conversazione è cambiata: senza questo controllo la risposta veniva aggiunta alla
  // cronologia ormai vuota e compariva un verdetto del Giudice senza la domanda che lo aveva
  // generato.
  const conversazioneCorrenteRef = useRef(0);

  const handleSelezionaFoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] || "";
      setImmagine({
        base64: base64,
        mimeType: file.type,
        anteprimaUrl: dataUrl,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRimuoviFoto = () => {
    setImmagine(null);
    if (inputFileRef.current) {
      inputFileRef.current.value = "";
    }
  };

  const handleClickOpzione = (domandaChiarimento: string, opzione: string) => {
    const rigaFormattata = `Riguardo a "${domandaChiarimento}": ${opzione}`;
    setMessaggioCorrente((prev) => (prev.trim() === "" ? rigaFormattata : `${prev}\n${rigaFormattata}`));
  };

  const handleNuovaConversazione = () => {
    conversazioneCorrenteRef.current += 1;
    setCronologia([]);
    setMessaggioCorrente("");
    setErrore("");
    setCaricamento(false);
    handleRimuoviFoto();
  };

  const handleInvia = async () => {
    if (messaggioCorrente.trim() === "") {
      return;
    }

    const testoMessaggio = messaggioCorrente;
    const cronologiaPrecedente = cronologia;
    const conversazioneDiPartenza = conversazioneCorrenteRef.current;

    setCronologia((prev) => [...prev, { ruolo: "utente", testo: testoMessaggio }]);
    setMessaggioCorrente("");
    setCaricamento(true);
    setErrore("");

    try {
      const response = await fetch("/api/judge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          domanda: testoMessaggio,
          cronologia: cronologiaPrecedente,
          ...(immagine
            ? {
                immagineBase64: immagine.base64,
                mimeTypeImmagine: immagine.mimeType,
              }
            : {}),
        }),
      });

      const dati = await response.json();

      // La conversazione è stata azzerata mentre la richiesta era in volo: questa risposta
      // riguarda una domanda che non è più sullo schermo e va scartata.
      if (conversazioneCorrenteRef.current !== conversazioneDiPartenza) {
        return;
      }

      if (!response.ok) {
        setErrore(dati.errore || "Si è verificato un errore imprevisto.");
      } else {
        const { testo: testoRisposta, chiarimenti } = estraiTestoEChiarimenti(dati.risposta);
        setCronologia((prev) => [
          ...prev,
          { ruolo: "giudice", testo: testoRisposta, chiarimenti: chiarimenti },
        ]);
        handleRimuoviFoto();
      }
    } catch (err) {
      if (conversazioneCorrenteRef.current !== conversazioneDiPartenza) {
        return;
      }
      console.error("Errore di rete durante la richiesta al giudice:", err);
      setErrore("Impossibile contattare il server. Controlla la connessione.");
    } finally {
      if (conversazioneCorrenteRef.current === conversazioneDiPartenza) {
        setCaricamento(false);
      }
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center font-sans">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-top opacity-[0.25] grayscale [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_80%,transparent)]"
        style={{ backgroundImage: `url(${IMMAGINE_SFONDO})` }}
        aria-hidden="true"
      />
      <main className="relative z-10 flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-app-border pb-4">
          <div />
          <h1 className="flex items-center justify-center gap-3 font-serif text-3xl font-bold tracking-wide text-app-fg">
            <Fregio />
            Virtual Judge MTG
            <Fregio />
          </h1>
          <div className="justify-self-end">
            {cronologia.length > 0 && (
              <button
                type="button"
                onClick={handleNuovaConversazione}
                className="shrink-0 rounded-none border border-app-border px-3 py-2 text-sm font-medium text-app-fg-muted transition-colors duration-200 ease-out hover:border-app-accent hover:text-app-accent"
              >
                Nuova conversazione
              </button>
            )}
          </div>
        </div>

        {cronologia.length === 0 && (
          <p className="text-center text-app-fg-muted">
            Fai una domanda su una situazione di gioco o su una regola di Magic: The Gathering.
          </p>
        )}

        {cronologia.length > 0 && (
          <div className="flex flex-col gap-4">
            {cronologia.map((messaggio, indice) => (
              <div
                key={indice}
                className={`flex ${messaggio.ruolo === "utente" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-sm p-4 shadow-sm transition-colors duration-200 ${
                    messaggio.ruolo === "utente"
                      ? "bg-bubble-user-bg text-bubble-user-fg"
                      : "border border-app-border border-t-2 border-t-app-accent bg-app-surface text-app-fg"
                  }`}
                >
                  {messaggio.ruolo === "giudice" && (
                    <div className="mb-1 text-xs font-bold uppercase tracking-widest text-app-accent">
                      Giudice
                    </div>
                  )}
                  {messaggio.testo}

                  {messaggio.ruolo === "giudice" &&
                    messaggio.chiarimenti &&
                    messaggio.chiarimenti.some((chiarimento) => chiarimento.opzioni.length > 0) && (
                      <div className="mt-4 flex flex-col gap-3 border-t border-app-border pt-3">
                        {messaggio.chiarimenti
                          .filter((chiarimento) => chiarimento.opzioni.length > 0)
                          .map((chiarimento, indiceChiarimento) => (
                            <div key={indiceChiarimento} className="flex flex-col gap-2">
                              <span className="text-xs text-app-fg-muted">
                                {chiarimento.domanda}
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {chiarimento.opzioni.map((opzione, indiceOpzione) => (
                                  <button
                                    key={indiceOpzione}
                                    type="button"
                                    onClick={() => handleClickOpzione(chiarimento.domanda, opzione)}
                                    className="rounded-full border border-app-border bg-app-bg px-3.5 py-1.5 text-sm font-medium text-app-fg shadow-sm transition-colors duration-200 ease-out hover:border-app-accent hover:text-app-accent focus:outline-none focus:ring-2 focus:ring-app-accent"
                                  >
                                    {opzione}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={messaggioCorrente}
          onChange={(e) => setMessaggioCorrente(e.target.value)}
          placeholder="Esempio: Se attacco con una creatura con doppio strike che ha un aura di +1/+1, come si calcola il danno nei due passaggi di combattimento?"
          className="w-full min-h-[150px] rounded-sm border border-app-border bg-app-surface p-4 text-app-fg shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-app-accent"
        />

        <div className="flex flex-col gap-3">
          <label
            htmlFor="foto-tavolo"
            className="w-full cursor-pointer rounded-sm border border-dashed border-app-border bg-app-surface p-4 text-center text-app-fg-muted transition-colors duration-200 hover:border-app-accent hover:text-app-accent"
          >
            📷 Allega o scatta una foto del tavolo (opzionale)
          </label>
          <input
            id="foto-tavolo"
            ref={inputFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleSelezionaFoto}
            className="hidden"
          />

          {immagine && (
            <div className="relative w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element -- anteprima da data-URI generata al volo lato client (FileReader), non un asset remoto/statico adatto a next/image */}
              <img
                src={immagine.anteprimaUrl}
                alt="Anteprima della foto del tavolo"
                className="max-h-64 rounded-sm border border-app-border object-contain shadow-sm"
              />
              <button
                type="button"
                onClick={handleRimuoviFoto}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white shadow transition-colors duration-200 hover:bg-red-700"
                aria-label="Rimuovi foto"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleInvia}
          disabled={caricamento}
          className="w-full rounded-sm bg-app-accent py-3 text-lg font-semibold tracking-wide text-[#17161a] transition-colors duration-200 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {caricamento ? "Il giudice sta valutando..." : "Chiedi al Giudice"}
        </button>

        {errore && (
          <div className="rounded-sm border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {errore}
          </div>
        )}
      </main>
    </div>
  );
}
