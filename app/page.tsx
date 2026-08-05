"use client";

import { useRef, useState } from "react";

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
    setCronologia([]);
    setMessaggioCorrente("");
    setErrore("");
    handleRimuoviFoto();
  };

  const handleInvia = async () => {
    if (messaggioCorrente.trim() === "") {
      return;
    }

    const testoMessaggio = messaggioCorrente;
    const cronologiaPrecedente = cronologia;

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
      console.error("Errore di rete durante la richiesta al giudice:", err);
      setErrore("Impossibile contattare il server. Controlla la connessione.");
    } finally {
      setCaricamento(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold text-black dark:text-zinc-50">
            ⚖️ Virtual Judge MTG
          </h1>
          {cronologia.length > 0 && (
            <button
              type="button"
              onClick={handleNuovaConversazione}
              className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Nuova conversazione
            </button>
          )}
        </div>

        {cronologia.length === 0 && (
          <p className="text-center text-zinc-600 dark:text-zinc-400">
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
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg p-4 shadow-sm ${
                    messaggio.ruolo === "utente"
                      ? "bg-black text-white dark:bg-zinc-50 dark:text-black"
                      : "border border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  }`}
                >
                  {messaggio.ruolo === "giudice" && (
                    <div className="mb-1 text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Giudice
                    </div>
                  )}
                  {messaggio.testo}

                  {messaggio.ruolo === "giudice" &&
                    messaggio.chiarimenti &&
                    messaggio.chiarimenti.some((chiarimento) => chiarimento.opzioni.length > 0) && (
                      <div className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                        {messaggio.chiarimenti
                          .filter((chiarimento) => chiarimento.opzioni.length > 0)
                          .map((chiarimento, indiceChiarimento) => (
                            <div key={indiceChiarimento} className="flex flex-col gap-2">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                {chiarimento.domanda}
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {chiarimento.opzioni.map((opzione, indiceOpzione) => (
                                  <button
                                    key={indiceOpzione}
                                    type="button"
                                    onClick={() => handleClickOpzione(chiarimento.domanda, opzione)}
                                    className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-black dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700 dark:focus:ring-zinc-50"
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
          className="w-full min-h-[150px] rounded-lg border border-zinc-300 bg-white p-4 text-black shadow-sm focus:outline-none focus:ring-2 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />

        <div className="flex flex-col gap-3">
          <label
            htmlFor="foto-tavolo"
            className="w-full cursor-pointer rounded-lg border border-dashed border-zinc-400 bg-white p-4 text-center text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
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
                className="max-h-64 rounded-lg border border-zinc-300 object-contain shadow-sm dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={handleRimuoviFoto}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white shadow hover:bg-red-700"
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
          className="w-full rounded-lg bg-black py-3 text-lg font-semibold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
        >
          {caricamento ? "Il giudice sta valutando..." : "Chiedi al Giudice"}
        </button>

        {errore && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {errore}
          </div>
        )}
      </main>
    </div>
  );
}
