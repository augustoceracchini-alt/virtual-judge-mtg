import { createHash } from "node:crypto";
import { cercaRegolePertinenti, cercaRegoleTorneo } from "./lib/rules.ts";
import { CASI } from "./scripts/casi-di-prova.mjs";
const LIMITE = [...CASI,
  { nome: "l1", fonte: "CR", paroleChiave: [], regoleCitate: [] },
  { nome: "l2", fonte: "CR", paroleChiave: ["zzzz","qwerty"], regoleCitate: [] },
  { nome: "l3", fonte: "CR", paroleChiave: ["land"], regoleCitate: ["999.9"] },
  { nome: "l4", fonte: "CR", paroleChiave: ["land"], regoleCitate: [""] },
  { nome: "l5", fonte: "CR", paroleChiave: ["deck"], regoleCitate: ["5.2"] },
  { nome: "l6", fonte: "MTR", paroleChiave: ["deck"], regoleCitate: ["714.4"] }];
let tutto = "";
for (const c of LIMITE) {
  const out = c.fonte === "MTR" ? cercaRegoleTorneo(c.paroleChiave, c.regoleCitate ?? [])
                                : cercaRegolePertinenti(c.paroleChiave, c.regoleCitate ?? []);
  tutto += `\n===== ${c.nome} =====\n${out}`;
}
console.log("caratteri:", tutto.length, "| SHA256:", createHash("sha256").update(tutto).digest("hex").slice(0,16));
