// Esportata perché `route.ts` la usa anche per decidere se allegare alla risposta i tempi delle
// fasi: la misura deve comparire solo dove compaiono i log di debug, mai in produzione.
export const DEBUG_ATTIVO = process.env.DEBUG_JUDGE === "true";

export function logDebug(...args: unknown[]) {
  if (DEBUG_ATTIVO) {
    console.log(...args);
  }
}
