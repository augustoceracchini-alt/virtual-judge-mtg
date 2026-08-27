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
// **Il valore è passato da 256 a 1024 il 25 agosto 2026, e il motivo NON è più la velocità.** Il 256
// era stato scelto quando si credeva che l'unico problema della FASE E fosse la lentezza: con quel
// valore la verifica scende a 7,6-13,0 secondi e continua a correggere un verdetto con la
// conclusione invertita. Poi è stato misurato quanto costa in correttezza, ed è molto:
//
// **Sei esecuzioni della stessa identica invocazione con budget 256, verdetto CORRETTO sottoposto:
// tre lo hanno restituito immutato e tre lo hanno riscritto invertendone la conclusione.** Una volta
// su due. Cade con questo anche la nota che diceva che la FASE E restituisce "byte per byte
// identico" un verdetto già corretto: era vera su una misura sola. Vedi "La FASE E può peggiorare un
// verdetto corretto" in CLAUDE.md per la tabella completa.
//
// **La traccia che ha suggerito 1024**: le esecuzioni sbagliate sono quelle in cui
// `thoughtsTokenCount` torna `undefined`, cioè quelle in cui il modello non ha ragionato affatto
// (una è durata 3,4 secondi contro i 19-27 delle altre). Se l'errore arriva quando il ragionamento
// viene saltato, un budget più alto dovrebbe renderlo più difficile da saltare. La correlazione non
// è però perfetta: una delle sbagliate aveva 1.833 token di ragionamento.
//
// **Misurato dopo la modifica: 6 esecuzioni su 6 corrette a 1024, contro 3 su 6 a 256.** Se la
// probabilità di errore fosse rimasta al 50%, sei esecuzioni buone di fila avrebbero una probabilità
// dell'1,6%: segnale forte, non prova definitiva. Sei esecuzioni restano poche, e questa fase ha già
// smentito due volte conclusioni tratte da campioni piccoli — se ricomparissero verdetti corretti
// stravolti, la prima cosa da rifare è questa misura, non una modifica.
//
// **Il costo, già misurato: l'app rallenta.** A 1024 la FASE E torna a 15,0-20,9 secondi contro i
// 7,6-13,0 di prima, ed è la fase più lenta dell'app. È uno scambio deliberato fra velocità e
// correttezza, a favore della seconda: un verdetto giusto che arriva in venti secondi vale più di
// uno sbagliato che arriva in otto.
//
// Non è un tetto rigido: il modello ne usa quanti gliene servono (misurati 913 token su un caso e
// 2.164 su un altro, a parità di richiesta), quindi il valore ORIENTA il ragionamento, non lo
// tronca. Prima di cambiarlo ancora, rimisurare con `npm run sonda-fase-e -- <budget>` ripetuto
// ALMENO sei volte: su questa fase una singola esecuzione non dimostra niente, in nessuna delle due
// direzioni, ed è una lezione già pagata tre volte.
export const BUDGET_RAGIONAMENTO_VERIFICA = 1024;

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

// --- Quanto tempo concedere a una chiamata prima di rinunciare ---
//
// **Il difetto che questi due valori chiudono: fino a qui NESSUNA chiamata a Gemini aveva un
// limite di tempo.** Se una richiesta restava appesa — connessione che non risponde, guasto dalla
// parte di Google — l'app aspettava senza fine, e l'unica cosa che la fermava era la piattaforma,
// che a quel punto interrompe la funzione buttando via TUTTO il lavoro già fatto. `RequestOptions`
// della libreria prevede un campo `timeout` apposta (verificato nei suoi tipi), e sopra quella
// scadenza la chiamata fallisce con un errore che lib/rete.ts riconosce come "timeout".
//
// **I valori non servono a rendere l'app più veloce, ma a impedirle di restare ferma per sempre**:
// sono perciò molto larghi rispetto ai tempi misurati, per non troncare una chiamata sana che
// stesse solo andando piano.
//
// FASE A misurata 0,6-0,9 s e FASE D 1,5-2,1 s: 25 secondi sono più di dieci volte tanto.
export const TIMEOUT_GEMINI_MS = 25000;

// La FASE E è un caso a parte e il suo valore è scelto per una ragione diversa. È la fase più
// lenta dell'app (15,0-20,9 s misurati a budget 1024, e 27,6 s in una sonda isolata), quindi il
// tetto dev'essere molto più alto — ma soprattutto deve scattare PRIMA di quello della
// piattaforma. Il motivo è che la FASE E ha già un suo fallback: se fallisce, `eseguiVerificaFaseE`
// restituisce il verdetto della FASE D non verificato, che è comunque una risposta utile. Se invece
// a interromperla è la piattaforma, quel fallback non viene mai eseguito e l'utente perde anche il
// verdetto già scritto. 45 secondi stanno sopra il peggior tempo mai misurato e sotto il tetto
// della funzione (una richiesta da 54,3 s è andata a buon fine, quindi il limite è oltre il minuto).
export const TIMEOUT_GEMINI_VERIFICA_MS = 45000;
