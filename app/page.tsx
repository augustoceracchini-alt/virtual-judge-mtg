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

// Lato massimo (in pixel) della foto effettivamente inviata al giudice, e qualità della
// ricompressione JPEG. Una foto scattata col telefono pesa spesso 3-5 MB e, convertita in base64
// per viaggiare dentro il JSON, cresce di un altro 33%: supera così i 4,5 MB che Vercel accetta
// come corpo di una richiesta, e la richiesta viene respinta con un errore 413 PRIMA di arrivare
// al nostro codice (per questo il controllo degli 8MB in route.ts non entra mai in funzione in
// produzione). A 1600 pixel di lato il testo delle carte resta leggibile e la foto scende
// abbondantemente sotto il mezzo MB, con l'effetto collaterale gradito di un invio più rapido
// sotto rete mobile.
const LATO_MASSIMO_FOTO = 1600;
const QUALITA_FOTO = 0.85;

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

// Carica il file scelto dall'utente in una forma che si possa disegnare su una tela (canvas).
// `createImageBitmap` è la strada preferita perché sa raddrizzare da sola le foto scattate col
// telefono in verticale, seguendo l'orientamento che la fotocamera scrive nei dati EXIF: senza
// quel raddrizzamento il giudice riceverebbe la foto coricata su un fianco. Dove quell'opzione
// non è disponibile si ripiega sul caricamento classico tramite un elemento <img>.
async function caricaSorgenteImmagine(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Browser che non accetta quell'opzione: si prosegue col metodo classico qui sotto.
    }
  }

  const dataUrl = await new Promise<string>((risolvi, rifiuta) => {
    const lettore = new FileReader();
    lettore.onload = () => risolvi(lettore.result as string);
    lettore.onerror = () => rifiuta(lettore.error ?? new Error("Lettura del file fallita."));
    lettore.readAsDataURL(file);
  });

  return await new Promise<HTMLImageElement>((risolvi, rifiuta) => {
    const elemento = new Image();
    elemento.onload = () => risolvi(elemento);
    elemento.onerror = () => rifiuta(new Error("Il file selezionato non è un'immagine leggibile."));
    elemento.src = dataUrl;
  });
}

// Rimpicciolisce e ricomprime la foto prima dell'invio (vedi LATO_MASSIMO_FOTO per il perché).
// L'anteprima mostrata all'utente è la stessa immagine ricompressa, così quello che si vede sullo
// schermo è esattamente quello che riceve il giudice.
async function preparaFotoPerInvio(file: File): Promise<ImmagineSelezionata> {
  const sorgente = await caricaSorgenteImmagine(file);

  const latoPiuLungo = Math.max(sorgente.width, sorgente.height);
  // Mai ingrandire: una foto già piccola resta alla sua dimensione originale.
  const fattoreDiRiduzione = Math.min(1, LATO_MASSIMO_FOTO / latoPiuLungo);
  const larghezza = Math.max(1, Math.round(sorgente.width * fattoreDiRiduzione));
  const altezza = Math.max(1, Math.round(sorgente.height * fattoreDiRiduzione));

  const tela = document.createElement("canvas");
  tela.width = larghezza;
  tela.height = altezza;
  const contesto = tela.getContext("2d");
  if (!contesto) {
    throw new Error("Il browser non ha fornito un contesto 2D per ridimensionare la foto.");
  }
  contesto.drawImage(sorgente, 0, 0, larghezza, altezza);

  const dataUrl = tela.toDataURL("image/jpeg", QUALITA_FOTO);
  return {
    base64: dataUrl.split(",")[1] || "",
    mimeType: "image/jpeg",
    anteprimaUrl: dataUrl,
  };
}

// Messaggio da mostrare quando la risposta NON arriva in JSON: in quel caso a rispondere non è
// stata la nostra API (che restituisce sempre un campo `errore` in italiano) ma la piattaforma,
// prima o dopo il nostro codice. Senza questa traduzione l'utente vedeva sempre e comunque
// "Impossibile contattare il server", che è fuorviante: il server era stato contattato benissimo,
// aveva solo risposto che la foto allegata era troppo pesante.
function messaggioPerErroreDiPiattaforma(codiceHttp: number): string {
  if (codiceHttp === 413) {
    return "La foto allegata è troppo pesante per essere inviata. Riprova con una foto più piccola, oppure senza allegato.";
  }
  if (codiceHttp === 408 || codiceHttp === 502 || codiceHttp === 504) {
    return "Il giudice ci ha messo troppo tempo a rispondere. Riprova fra qualche istante.";
  }
  if (codiceHttp === 429) {
    return "Troppe richieste in poco tempo. Aspetta qualche minuto e riprova.";
  }
  return `Il server ha risposto con un errore (codice ${codiceHttp}).`;
}

export default function Home() {
  const [messaggioCorrente, setMessaggioCorrente] = useState("");
  const [cronologia, setCronologia] = useState<MessaggioCronologia[]>([]);
  const [caricamento, setCaricamento] = useState(false);
  const [errore, setErrore] = useState("");
  const [immagine, setImmagine] = useState<ImmagineSelezionata | null>(null);
  // Il ridimensionamento della foto richiede una frazione di secondo (su un telefono lento anche
  // di più): finché è in corso, l'invio resta bloccato, altrimenti la richiesta partirebbe senza
  // l'allegato che l'utente ha appena scelto.
  const [fotoInPreparazione, setFotoInPreparazione] = useState(false);
  const inputFileRef = useRef<HTMLInputElement>(null);

  // Identifica la conversazione in corso. Viene incrementato a ogni azzeramento, così una
  // richiesta partita prima dell'azzeramento può accorgersi, quando la risposta arriva, che
  // intanto la conversazione è cambiata: senza questo controllo la risposta veniva aggiunta alla
  // cronologia ormai vuota e compariva un verdetto del Giudice senza la domanda che lo aveva
  // generato.
  const conversazioneCorrenteRef = useRef(0);

  const handleRimuoviFoto = () => {
    setImmagine(null);
    if (inputFileRef.current) {
      inputFileRef.current.value = "";
    }
  };

  const handleSelezionaFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    setErrore("");
    setFotoInPreparazione(true);
    try {
      setImmagine(await preparaFotoPerInvio(file));
    } catch (err) {
      console.error("Preparazione della foto fallita:", err);
      setErrore("Non sono riuscito a leggere questa foto. Prova a sceglierne un'altra.");
      handleRimuoviFoto();
    } finally {
      setFotoInPreparazione(false);
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

      // Il corpo si legge come testo e si interpreta a parte: se la risposta non è in JSON (errore
      // della piattaforma, vedi `messaggioPerErroreDiPiattaforma`) un `response.json()` diretto
      // lancerebbe un'eccezione, che finirebbe nel `catch` di rete più in basso facendo dire
      // all'app che il server è irraggiungibile.
      const corpoRisposta = await response.text();
      let dati: { risposta?: string; errore?: string } | null = null;
      try {
        dati = JSON.parse(corpoRisposta);
      } catch {
        console.error(
          "Risposta non in JSON dall'API del giudice:",
          response.status,
          corpoRisposta.slice(0, 300)
        );
      }

      if (!eAncoraLaStessaConversazione()) {
        return;
      }

      if (!response.ok) {
        setErrore(dati?.errore || messaggioPerErroreDiPiattaforma(response.status));
      } else if (typeof dati?.risposta !== "string") {
        setErrore("Il server ha risposto in un formato inatteso. Riprova fra qualche istante.");
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

  const etichettaPulsante = caricamento
    ? "Il giudice sta valutando..."
    : fotoInPreparazione
      ? "Preparo la foto..."
      : "Chiedi al Giudice";

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
          disabled={caricamento || fotoInPreparazione}
          className="w-full rounded-sm bg-app-accent py-3 text-lg font-semibold tracking-wide text-[#17161a] transition-colors duration-200 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {etichettaPulsante}
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
