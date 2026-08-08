// Limite di richieste per IP, per evitare che una singola persona (per errore o abuso) esaurisca
// la quota gratuita di Gemini condivisa da tutti gli utenti dell'app.
//
// Il contatore vive in memoria del processo: su Vercel free le funzioni serverless sono stateless
// tra invocazioni diverse e possono girare su istanze parallele, quindi questa è una protezione
// parziale (si azzera ai cold start, non è condivisa tra istanze) — accettata per restare senza
// servizi esterni a pagamento.
const FINESTRA_MS = 10 * 60 * 1000;
const LIMITE_RICHIESTE = 20;

const richiestePerIp = new Map<string, number[]>();

export function richiestaConsentita(ip: string): boolean {
  const ora = Date.now();
  const recenti = (richiestePerIp.get(ip) ?? []).filter((t) => ora - t < FINESTRA_MS);

  if (recenti.length >= LIMITE_RICHIESTE) {
    richiestePerIp.set(ip, recenti);
    return false;
  }

  recenti.push(ora);
  richiestePerIp.set(ip, recenti);
  return true;
}
