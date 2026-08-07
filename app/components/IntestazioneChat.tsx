function Fregio() {
  return (
    <svg viewBox="0 0 24 24" className="fregio-titolo h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M12 1 L15 9 L23 12 L15 15 L12 23 L9 15 L1 12 L9 9 Z" />
    </svg>
  );
}

type Props = {
  mostraNuovaConversazione: boolean;
  onNuovaConversazione: () => void;
};

export default function IntestazioneChat({ mostraNuovaConversazione, onNuovaConversazione }: Props) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-app-border pb-4">
      <div />
      <h1 className="flex items-center justify-center gap-3 font-serif text-3xl font-bold tracking-wide text-app-fg">
        <Fregio />
        Virtual Judge MTG
        <Fregio />
      </h1>
      <div className="justify-self-end">
        {mostraNuovaConversazione && (
          <button
            type="button"
            onClick={onNuovaConversazione}
            className="shrink-0 rounded-none border border-app-border px-3 py-2 text-sm font-medium text-app-fg-muted transition-colors duration-200 ease-out hover:border-app-accent hover:text-app-accent"
          >
            Nuova conversazione
          </button>
        )}
      </div>
    </div>
  );
}
