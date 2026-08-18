import type { RefObject } from "react";
import type { ImmagineSelezionata } from "@/app/tipi";

type Props = {
  immagine: ImmagineSelezionata | null;
  inputFileRef: RefObject<HTMLInputElement | null>;
  onSelezionaFoto: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRimuoviFoto: () => void;
};

export default function AllegatoFoto({ immagine, inputFileRef, onSelezionaFoto, onRimuoviFoto }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor="foto-tavolo"
        className="w-full cursor-pointer rounded-sm border border-dashed border-app-border bg-app-surface p-4 text-center text-app-fg-muted transition-colors duration-200 hover:border-app-accent hover:text-app-accent"
      >
        📷 Allega o scatta una foto del tavolo (opzionale)
      </label>
      {/*
        NON rimettere l'attributo `capture`: su telefono apre di filato la fotocamera e toglie
        all'utente la possibilità di scegliere una foto già presente in galleria (su desktop
        viene invece ignorato). Senza, il browser mobile mostra da solo il menu con entrambe le
        strade — fotocamera E galleria/file — che è quanto promette l'etichetta qui sopra.
      */}
      <input
        id="foto-tavolo"
        ref={inputFileRef}
        type="file"
        accept="image/*"
        onChange={onSelezionaFoto}
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
            onClick={onRimuoviFoto}
            className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white shadow transition-colors duration-200 hover:bg-red-700"
            aria-label="Rimuovi foto"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
