import fs from "fs";
import path from "path";

interface VoceErrata {
  carte: string[];
  nota: string;
}

let cache: VoceErrata[] | null = null;

function caricaErrata(): VoceErrata[] {
  if (cache) {
    return cache;
  }

  const percorsoFile = path.join(process.cwd(), "data", "errata-locali.json");
  const testoJson = fs.readFileSync(percorsoFile, "utf-8");
  cache = JSON.parse(testoJson) as VoceErrata[];
  return cache;
}

// A differenza delle Comprehensive Rules e del Magic Tournament Rules, questa non è una fonte
// generata da un documento ufficiale: è una lista curata a mano dal proprietario dello strumento
// per i casi noti in cui un ruling ufficiale di una carta è superato da una modifica successiva
// delle Comprehensive Rules che gli estratti automatici, da soli, non riescono a segnalare (il
// modello vede un ruling molto specifico sulla carta esatta e una regola generale astratta, e
// tende a fidarsi del primo anche quando le istruzioni gli chiedono di dare priorità alla
// seconda). La corrispondenza è per nome esatto (case-insensitive, non parziale) per evitare che
// una nota scritta per una carta finisca applicata per errore a un'altra con un nome simile.
export function cercaErrataPertinenti(nomiCarte: string[]): string {
  const nomiNormalizzati = nomiCarte.map((nome) => nome.toLowerCase());

  const noteCorrispondenti = caricaErrata()
    .filter((voce) => voce.carte.some((carta) => nomiNormalizzati.includes(carta.toLowerCase())))
    .map((voce) => voce.nota);

  return noteCorrispondenti.join("\n\n");
}
