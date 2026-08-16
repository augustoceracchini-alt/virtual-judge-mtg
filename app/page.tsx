"use client";

import { useRef, useState } from "react";
import AllegatoFoto from "@/app/components/AllegatoFoto";
import BollaMessaggio from "@/app/components/BollaMessaggio";
import IntestazioneChat from "@/app/components/IntestazioneChat";
import type { DomandaChiarimento, ImmagineSelezionata, MessaggioCronologia } from "@/app/tipi";

// Illustrazione di "Balance" (Kev Walker) via Scryfall, usata come sfondo decorativo
// dietro tutta la chat: stessa fonte di immagini già usata dall'app per i dati delle carte.
const IMMAGINE_SFONDO =
  "https://cards.scryfall.io/art_crop/front/c/e/ce648aa3-098b-4af0-a433-fd290bc85904.jpg";

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

    // La conversazione può essere azzerata mentre la richiesta è ancora in volo: in quel caso la
    // risposta riguarda una domanda che non è più sullo schermo e va scartata. Il controllo serve
    // in tre punti diversi (risposta ricevuta, errore di rete, chiusura del caricamento), quindi
    // ha un nome invece di essere ripetuto tre volte.
    const eAncoraLaStessaConversazione = () => conversazioneCorrenteRef.current === conversazioneDiPartenza;

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

      if (!eAncoraLaStessaConversazione()) {
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
      if (!eAncoraLaStessaConversazione()) {
        return;
      }
      console.error("Errore di rete durante la richiesta al giudice:", err);
      setErrore("Impossibile contattare il server. Controlla la connessione.");
    } finally {
      if (eAncoraLaStessaConversazione()) {
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
        <IntestazioneChat
          mostraNuovaConversazione={cronologia.length > 0}
          onNuovaConversazione={handleNuovaConversazione}
        />

        {cronologia.length === 0 && (
          <p className="text-center text-app-fg-muted">
            Fai una domanda su una situazione di gioco o su una regola di Magic: The Gathering.
          </p>
        )}

        {cronologia.length > 0 && (
          <div className="flex flex-col gap-4">
            {cronologia.map((messaggio, indice) => (
              <BollaMessaggio key={indice} messaggio={messaggio} onClickOpzione={handleClickOpzione} />
            ))}
          </div>
        )}

        <textarea
          value={messaggioCorrente}
          onChange={(e) => setMessaggioCorrente(e.target.value)}
          placeholder="Esempio: Se attacco con una creatura con doppio strike che ha un aura di +1/+1, come si calcola il danno nei due passaggi di combattimento?"
          className="w-full min-h-[150px] rounded-sm border border-app-border bg-app-surface p-4 text-app-fg shadow-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-app-accent"
        />

        <AllegatoFoto
          immagine={immagine}
          inputFileRef={inputFileRef}
          onSelezionaFoto={handleSelezionaFoto}
          onRimuoviFoto={handleRimuoviFoto}
        />

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
