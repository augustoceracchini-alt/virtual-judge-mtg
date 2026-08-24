// Come parliamo con Gemini: quale modello per quale fase, e con quali impostazioni di generazione.
//
// Sta in lib/ e non dentro route.ts perche' le sonde di scripts/ devono misurare le IMPOSTAZIONI
// REALI usate in produzione, non una copia scritta a mano dentro lo script: e' la stessa ragione
// per cui lib/verifica.ts vive qui. Per lo stesso motivo questo file **non usa l'alias `@/`** e non
// importa nulla, nemmeno un tipo: Node lo carica direttamente dagli script .mjs.

// Due modelli diversi per due scopi diversi. MODELLO_STANDARD (quota gratuita generosa) gira su
// ogni domanda, nelle FASI A e D. MODELLO_VERIFICA ragiona meglio ma ha una quota gratuita molto
// più stretta (~20 richieste/giorno): usarlo solo nella FASE E, che scatta già solo per le
// domande con regole condizionali complesse, non per ogni domanda.
export const MODELLO_STANDARD = "gemini-3.5-flash-lite";
export const MODELLO_VERIFICA = "gemini-3.6-flash";

// Quanto ragionamento interno concedere al revisore della FASE E, che è di gran lunga la fase più
// lenta dell'app.
//
// **Misurato, e smentisce l'ipotesi che era scritta qui prima.** Il tempo della FASE E non se ne va
// nel LEGGERE i regolamenti né nello SCRIVERE il verdetto: se ne va nel ragionamento interno. Su
// una chiamata reale senza alcun limite: 5.135 token letti, 191 scritti e **5.303 di ragionamento**,
// per 27,6 secondi. Ridurre il testo in ingresso — la strada che il progetto si era annotato —
// avrebbe quindi tagliato solo il prefill, cioè una frazione minima.
//
// Con questo valore la stessa verifica scende a 7,6-13,0 secondi, e continua a fare **entrambe** le
// cose per cui la FASE E esiste: corregge un verdetto con la conclusione invertita, e restituisce
// invece byte per byte identico un verdetto già corretto (verificato in tutti e due i sensi sullo
// scenario benchmark Urza's Saga + Blood Moon, e senza passare al modello la nota di
// errata-locali.json, quindi partendo dalle sole regole).
//
// Non è un tetto rigido: il modello ne usa quanti gliene servono (misurati 913 token su un caso e
// 2.164 su un altro, a parità di richiesta), quindi il valore ORIENTA il ragionamento, non lo
// tronca. Abbassarlo ancora non è stato provato; alzarlo riporta i tempi su (a 1024: 15,0-20,9 s).
// Prima di cambiarlo, rimisurare con scripts/sonda-fase-e.mjs — a occhio non si vede nulla, perché
// la durata della FASE E varia molto anche a parità di domanda.
export const BUDGET_RAGIONAMENTO_VERIFICA = 256;

// --- Generazione deterministica ---
//
// Senza queste impostazioni Gemini sceglie A CASO fra le continuazioni plausibili, perche' la sua
// temperatura di default non e' zero: la stessa domanda produceva quindi risposte diverse a ogni
// invio, e non per un difetto nascosto ma perche' non gli avevamo mai detto di non farlo. Era la
// prima causa di incoerenza fra le risposte, davanti alla variabilita' del vocabolario della FASE A.
//
// `temperature: 0` chiede di prendere sempre la continuazione che il modello ritiene migliore
// invece di sorteggiarla; `topK: 1` e `topP: 1` dicono la stessa cosa dal lato opposto (scegli fra
// un solo candidato), e servono da cintura oltre alle bretelle: sono innocui e rendono esplicito
// che qui non si campiona.
//
// **Cosa NON e' incluso, e perche': il `seed`.** Un seme fisso serve a rendere ripetibile un
// sorteggio, ma qui il sorteggio e' gia' spento: a temperatura 0 non c'e' nulla da seminare. E'
// anche l'unico dei quattro campi che la libreria deprecata @google/generative-ai non espone nei
// propri tipi, quindi andrebbe passato con un cast come si fa per `thinkingConfig`, senza che si
// possa verificare in anticipo che l'API lo accetti: un campo rifiutato farebbe fallire OGNI
// richiesta, in produzione. Se la sonda di coerenza mostrasse variabilita' residua, il seme e' la
// cosa successiva da provare — ma va provata in locale con `npm run sonda-coerenza` prima di
// pubblicare, non direttamente sul sito.
//
// **Quello che questa impostazione non promette.** Google non garantisce risposte identiche bit per
// bit nemmeno a temperatura 0: resta un margine dovuto all'aritmetica dei calcoli e a come le
// richieste vengono raggruppate sui loro server. Aspettarsi forte convergenza, non una garanzia
// matematica — ed e' esattamente per questo che esiste `npm run sonda-coerenza`, che la misura
// invece di darla per fatta.
//
// **L'effetto collaterale da conoscere:** a temperatura 0 anche gli ERRORI diventano stabili. Se il
// modello sbaglia un caso, da quel momento lo sbaglia sempre allo stesso modo, mentre prima poteva
// azzeccarlo per fortuna una volta su cinque. E' un vantaggio, non un danno: un errore che si
// ripete si vede e si corregge (come e' stato per Urza's Saga), uno intermittente fa perdere
// giornate — questo progetto ne ha gia' perse inseguendone.
export const CONFIGURAZIONE_DETERMINISTICA = {
  temperature: 0,
  topK: 1,
  topP: 1,
};
