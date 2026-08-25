import { NextRequest, NextResponse } from "next/server";
import { richiestaConsentita } from "@/lib/limite";

// Endpoint delle segnalazioni: l'utente dice che una risposta è sbagliata, incompleta o mancata, e
// il caso viene registrato per lo sviluppo futuro.
//
// Non serve solo a raccogliere lamentele: serve a raccogliere CASI RIPRODUCIBILI. Una segnalazione
// che dicesse soltanto "ha sbagliato" sarebbe inutilizzabile, perché il difetto quasi sempre non sta
// nella scrittura del verdetto ma nel RECUPERO delle regole, e per rifarlo servono le parole chiave
// prodotte dalla FASE A in quell'esecuzione — che nessuno può ricostruire a posteriori, visto che
// cambiano da un'esecuzione all'altra. Per questo /api/judge restituisce ora una `diagnostica`
// compatta insieme al verdetto, il client se la tiene, e la rimanda qui con la segnalazione: da
// quei campi si scrive direttamente una riga di scripts/casi-di-prova.mjs.
//
// Non viene MAI registrata la foto eventualmente allegata: pesa, e per riprodurre il caso basta
// sapere che c'era.

// Le voci fra cui l'utente sceglie. La lista è chiusa e validata: un tipo arbitrario finirebbe nel
// titolo di una issue pubblica su GitHub.
const TIPI_AMMESSI = [
  "Risposta sbagliata",
  "Risposta incompleta o poco chiara",
  "Non ha risposto / troppi chiarimenti",
  "Altro",
];

// Tetti di lunghezza. Il testo eccedente viene TRONCATO invece di far fallire la segnalazione:
// perdere il caso perché la conversazione era lunga sarebbe il peggiore dei due esiti.
const MASSIMO_COMMENTO = 1000;
const MASSIMO_DOMANDA = 2000;
const MASSIMO_RISPOSTA = 8000;
const MASSIMO_CRONOLOGIA = 8000;
const MASSIMO_VOCI_ELENCO = 40;

// Il repository su cui aprire le issue. Sta in una variabile d'ambiente con un valore di ripiego,
// così l'app funziona anche senza configurarla.
const REPOSITORY_PREDEFINITO = "augustoceracchini-alt/virtual-judge-mtg";

// Oltre questo tempo si rinuncia a GitHub e si risponde comunque all'utente: la segnalazione è già
// salvata nei log, e non ha senso far aspettare una persona per un servizio esterno lento.
const TIMEOUT_GITHUB_MS = 8000;

function testoLimitato(valore: unknown, massimo: number): string {
  return typeof valore === "string" ? valore.trim().slice(0, massimo) : "";
}

function elencoDiTesti(valore: unknown): string[] {
  if (!Array.isArray(valore)) {
    return [];
  }
  return valore
    .filter((voce): voce is string => typeof voce === "string")
    .slice(0, MASSIMO_VOCI_ELENCO)
    .map((voce) => voce.trim().slice(0, 120));
}

// Vercel popola questo header con l'IP del client in testa alla lista (stessa logica di
// /api/judge, che condivide anche il contatore: una segnalazione consuma una richiesta del limite
// per IP, ed è voluto — è la sola difesa contro chi volesse riempire le issue di spam).
function ipClient(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "ip-sconosciuto";
}

type Diagnostica = {
  paroleChiave: string[];
  regoleCitate: string[];
  carte: string[];
  capitoliCR: string[];
  capitoliMTR: string[];
  faseE: boolean;
  citazioniSenzaFonte: string[];
  conFoto: boolean;
};

// La diagnostica torna dal client, quindi è tanto poco affidabile quanto la cronologia: va
// ricostruita campo per campo invece di essere inoltrata così com'è, altrimenti finirebbe dentro
// una issue pubblica qualunque cosa il client abbia messo dentro l'oggetto.
function normalizzaDiagnostica(valore: unknown): Diagnostica | null {
  if (valore === null || typeof valore !== "object") {
    return null;
  }
  const grezza = valore as Record<string, unknown>;
  return {
    paroleChiave: elencoDiTesti(grezza.paroleChiave),
    regoleCitate: elencoDiTesti(grezza.regoleCitate),
    carte: elencoDiTesti(grezza.carte),
    capitoliCR: elencoDiTesti(grezza.capitoliCR),
    capitoliMTR: elencoDiTesti(grezza.capitoliMTR),
    faseE: grezza.faseE === true,
    citazioniSenzaFonte: elencoDiTesti(grezza.citazioniSenzaFonte),
    conFoto: grezza.conFoto === true,
  };
}

function elencoLeggibile(voci: string[]): string {
  return voci.length > 0 ? voci.join(", ") : "(nessuna)";
}

// Il corpo della issue. È scritto per essere LETTO da chi sviluppa: in cima la riga che permette di
// riprodurre il caso in `npm run prova-ricerca`, che è la ragione per cui questo endpoint esiste.
function corpoSegnalazione(
  tipo: string,
  commento: string,
  domanda: string,
  risposta: string,
  cronologia: string,
  diagnostica: Diagnostica | null
): string {
  const parti = [`**Tipo:** ${tipo}`, "", `**Domanda dell'utente**\n\n> ${domanda.replace(/\n/g, "\n> ")}`];

  if (commento !== "") {
    parti.push("", `**Cosa dice chi segnala**\n\n> ${commento.replace(/\n/g, "\n> ")}`);
  }

  if (diagnostica !== null) {
    parti.push(
      "",
      "**Diagnostica del recupero**",
      "",
      `- parole chiave (FASE A + tipi Scryfall): ${elencoLeggibile(diagnostica.paroleChiave)}`,
      `- regole citate dall'utente: ${elencoLeggibile(diagnostica.regoleCitate)}`,
      `- carte trovate su Scryfall: ${elencoLeggibile(diagnostica.carte)}`,
      `- capitoli CR negli estratti: ${elencoLeggibile(diagnostica.capitoliCR)}`,
      `- capitoli MTR negli estratti: ${elencoLeggibile(diagnostica.capitoliMTR)}`,
      `- FASE E (doppio controllo): ${diagnostica.faseE ? "scattata" : "non scattata"}`,
      `- citazioni senza fonte: ${elencoLeggibile(diagnostica.citazioniSenzaFonte)}`,
      `- foto allegata: ${diagnostica.conFoto ? "sì" : "no"}`,
      "",
      "Caso da incollare in `scripts/casi-di-prova.mjs` per riprodurre il recupero:",
      "",
      "```js",
      "{",
      `  nome: ${JSON.stringify(domanda.slice(0, 70))},`,
      "  fonte: \"CR\",",
      `  paroleChiave: ${JSON.stringify(diagnostica.paroleChiave)},`,
      `  regoleCitate: ${JSON.stringify(diagnostica.regoleCitate)},`,
      "  attesi: [],",
      "  nonVoluti: [],",
      "  statoIniziale: \"FALLISCE\",",
      "},",
      "```"
    );
  }

  if (cronologia !== "") {
    parti.push("", "<details><summary>Conversazione precedente</summary>", "", "```", cronologia, "```", "</details>");
  }

  parti.push(
    "",
    "<details><summary>Risposta del giudice</summary>",
    "",
    "```",
    risposta,
    "```",
    "</details>",
    "",
    "_Segnalazione inviata dall'app._"
  );

  return parti.join("\n");
}

// Apre la issue su GitHub, se il token è configurato. Restituisce il numero della issue, oppure
// null: NON lancia mai: una segnalazione già registrata nei log non deve trasformarsi in un errore
// per l'utente solo perché GitHub è irraggiungibile o il token è scaduto.
async function apriIssueGitHub(titolo: string, corpo: string): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN_SEGNALAZIONI;
  if (!token) {
    return null;
  }

  const repository = process.env.GITHUB_REPO_SEGNALAZIONI || REPOSITORY_PREDEFINITO;

  try {
    const risposta = await fetch(`https://api.github.com/repos/${repository}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: titolo, body: corpo }),
      signal: AbortSignal.timeout(TIMEOUT_GITHUB_MS),
    });

    if (!risposta.ok) {
      console.error(
        "Segnalazione: GitHub ha rifiutato la creazione della issue (la segnalazione resta nei log):",
        risposta.status,
        (await risposta.text()).slice(0, 300)
      );
      return null;
    }

    const dati = await risposta.json();
    return typeof dati.number === "number" ? dati.number : null;
  } catch (errore) {
    console.error("Segnalazione: chiamata a GitHub fallita (la segnalazione resta nei log):", errore);
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!richiestaConsentita(ipClient(request))) {
    return NextResponse.json(
      { errore: "Troppe richieste da questo indirizzo IP. Riprova tra qualche minuto." },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();

    const tipo = typeof body.tipo === "string" && TIPI_AMMESSI.includes(body.tipo) ? body.tipo : "";
    if (tipo === "") {
      return NextResponse.json({ errore: "Tipo di segnalazione non valido." }, { status: 400 });
    }

    const domanda = testoLimitato(body.domanda, MASSIMO_DOMANDA);
    const risposta = testoLimitato(body.risposta, MASSIMO_RISPOSTA);
    if (domanda === "" && risposta === "") {
      return NextResponse.json(
        { errore: "La segnalazione non contiene né la domanda né la risposta da segnalare." },
        { status: 400 }
      );
    }

    const commento = testoLimitato(body.commento, MASSIMO_COMMENTO);
    // La cronologia arriva già appiattita in testo dal client: qui interessa solo registrarla, non
    // reinviarla a Gemini, quindi non serve la validazione per messaggio di /api/judge.
    const cronologia = testoLimitato(body.cronologia, MASSIMO_CRONOLOGIA);
    const diagnostica = normalizzaDiagnostica(body.diagnostica);

    // Una riga sola, con un prefisso cercabile: è il registro che funziona sempre, anche senza
    // token di GitHub configurato.
    console.error(
      "[SEGNALAZIONE]",
      JSON.stringify({ tipo, domanda, commento, diagnostica, risposta: risposta.slice(0, 2000) })
    );

    const titolo = `[Segnalazione] ${tipo}: ${domanda.replace(/\s+/g, " ").slice(0, 80) || "(senza domanda)"}`;
    const numeroIssue = await apriIssueGitHub(
      titolo,
      corpoSegnalazione(tipo, commento, domanda, risposta, cronologia, diagnostica)
    );

    return NextResponse.json({ salvata: true, issue: numeroIssue });
  } catch (errore) {
    console.error("Errore nella registrazione di una segnalazione:", errore);
    return NextResponse.json(
      { errore: "Non sono riuscito a registrare la segnalazione. Riprova fra qualche istante." },
      { status: 500 }
    );
  }
}
