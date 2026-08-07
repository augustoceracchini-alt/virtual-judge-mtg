import type { MessaggioCronologia } from "@/app/tipi";

type Props = {
  messaggio: MessaggioCronologia;
  onClickOpzione: (domandaChiarimento: string, opzione: string) => void;
};

export default function BollaMessaggio({ messaggio, onClickOpzione }: Props) {
  return (
    <div className={`flex ${messaggio.ruolo === "utente" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-sm p-4 shadow-sm transition-colors duration-200 ${
          messaggio.ruolo === "utente"
            ? "bg-bubble-user-bg text-bubble-user-fg"
            : "border border-app-border border-t-2 border-t-app-accent bg-app-surface text-app-fg"
        }`}
      >
        {messaggio.ruolo === "giudice" && (
          <div className="mb-1 text-xs font-bold uppercase tracking-widest text-app-accent">Giudice</div>
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
                    <span className="text-xs text-app-fg-muted">{chiarimento.domanda}</span>
                    <div className="flex flex-wrap gap-2">
                      {chiarimento.opzioni.map((opzione, indiceOpzione) => (
                        <button
                          key={indiceOpzione}
                          type="button"
                          onClick={() => onClickOpzione(chiarimento.domanda, opzione)}
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
  );
}
