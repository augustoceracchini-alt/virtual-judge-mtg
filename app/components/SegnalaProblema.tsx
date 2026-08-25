import { useState } from "react";
import type { DiagnosticaRisposta } from "@/app/tipi";

type Props = {
  domanda: string;
  risposta: string;
  cronologia: string;
  diagnostica?: DiagnosticaRisposta;
};

// Le stesse voci accettate da app/api/segnalazione/route.ts, che le valida contro la propria lista:
// se una viene cambiata qui va cambiata anche là, altrimenti il server risponde 400.
const TIPI = [
  "Risposta sbagliata",
  "Risposta incompleta o poco chiara",
  "Non ha risposto / troppi chiarimenti",
  "Altro",
];

type Stato = "chiuso" | "aperto" | "invio" | "inviata" | "errore";

// Il pulsante di segnalazione sotto ogni risposta del giudice. Sta chiuso e discreto finché non
// serve: è uno strumento per i casi sbagliati, non un invito a votare ogni risposta.
export default function SegnalaProblema({ domanda, risposta, cronologia, diagnostica }: Props) {
  const [stato, setStato] = useState<Stato>("chiuso");
  const [tipo, setTipo] = useState(TIPI[0]);
  const [commento, setCommento] = useState("");

  const invia = async () => {
    setStato("invio");
    try {
      const response = await fetch("/api/segnalazione", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, commento, domanda, risposta, cronologia, diagnostica }),
      });
      setStato(response.ok ? "inviata" : "errore");
    } catch (err) {
      console.error("Invio della segnalazione fallito:", err);
      setStato("errore");
    }
  };

  if (stato === "inviata") {
    return (
      <p className="pl-1 text-xs text-app-fg-muted">
        Segnalazione inviata, grazie: il caso verrà usato per migliorare il giudice.
      </p>
    );
  }

  if (stato === "chiuso") {
    return (
      <button
        type="button"
        onClick={() => setStato("aperto")}
        className="self-start pl-1 text-xs text-app-fg-muted underline decoration-dotted underline-offset-4 transition-colors duration-200 hover:text-app-accent focus:outline-none focus:ring-2 focus:ring-app-accent"
      >
        Segnala un problema con questa risposta
      </button>
    );
  }

  return (
    <div className="flex max-w-[85%] flex-col gap-3 rounded-sm border border-app-border bg-app-surface p-4 shadow-sm">
      <span className="text-xs font-bold uppercase tracking-widest text-app-fg-muted">
        Segnala un problema
      </span>

      <div className="flex flex-wrap gap-2">
        {TIPI.map((voce) => (
          <button
            key={voce}
            type="button"
            onClick={() => setTipo(voce)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-sm transition-colors duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-app-accent ${
              tipo === voce
                ? "border-app-accent bg-app-bg text-app-accent"
                : "border-app-border bg-app-bg text-app-fg hover:border-app-accent hover:text-app-accent"
            }`}
          >
            {voce}
          </button>
        ))}
      </div>

      <textarea
        value={commento}
        onChange={(e) => setCommento(e.target.value)}
        maxLength={1000}
        placeholder="Se lo sai, scrivi qual era la risposta giusta e perché (facoltativo, ma è la parte più utile)."
        className="min-h-[80px] w-full rounded-sm border border-app-border bg-app-bg p-3 text-sm text-app-fg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-app-accent"
      />

      {/* Detto apertamente perché il repository del progetto è pubblico: la segnalazione, con dentro
          la domanda e la risposta, può diventare una scheda visibile a chiunque. */}
      <p className="text-xs text-app-fg-muted">
        Vengono inviate la tua domanda, la risposta del giudice e la conversazione di questo scambio.
        Non viene inviata nessuna foto allegata.
      </p>

      {stato === "errore" && (
        <p className="text-xs text-red-700 dark:text-red-300">
          Non sono riuscito a inviare la segnalazione. Riprova fra qualche istante.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={invia}
          disabled={stato === "invio"}
          className="rounded-sm bg-app-accent px-4 py-2 text-sm font-semibold tracking-wide text-[#17161a] transition-colors duration-200 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {stato === "invio" ? "Invio..." : "Invia segnalazione"}
        </button>
        <button
          type="button"
          onClick={() => setStato("chiuso")}
          className="rounded-sm border border-app-border bg-app-bg px-4 py-2 text-sm font-medium text-app-fg transition-colors duration-200 ease-out hover:border-app-accent hover:text-app-accent focus:outline-none focus:ring-2 focus:ring-app-accent"
        >
          Annulla
        </button>
      </div>
    </div>
  );
}
