const DEBUG_ATTIVO = process.env.DEBUG_JUDGE === "true";

export function logDebug(...args: unknown[]) {
  if (DEBUG_ATTIVO) {
    console.log(...args);
  }
}
