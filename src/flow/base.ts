// Tipos, utilitários de texto e medição de etapas compartilhados pelos módulos do Flow.
import { MODELOS_FLOW, MODELOS_IMAGEM } from "../seletores.js";

export type ModeloVideo = keyof typeof MODELOS_FLOW;
export type ModeloImagem = keyof typeof MODELOS_IMAGEM;
export type ProporcaoVideo = "16:9" | "9:16";
export type ProporcaoImagem = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type Progresso = (mensagem: string) => void;

/**
 * Repassa o progresso e registra no log do app (stderr) as etapas que passaram de 8 s: no Claude
 * Desktop uma etapa lenta faz o envio não caber nos ~50 s, e o log mostra qual foi.
 */
export function medirEtapas(progresso: Progresso, rotulo: string): Progresso {
  let etapa = "início";
  let desde = Date.now();
  return (mensagem) => {
    const s = (Date.now() - desde) / 1000;
    if (s > 8) console.error(`[mcp-google] ${rotulo}: etapa lenta "${etapa}" levou ${s.toFixed(1)} s`);
    etapa = mensagem;
    desde = Date.now();
    progresso(mensagem);
  };
}

export const normalizar = (t: string) => t.replace(/\s+/g, " ").trim();
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Item de menu pelo fim do nome: "Nano Banana 2" não pode pegar "Nano Banana 2 Lite", mas aceita
 * versões novas do mesmo modelo ("Nano Banana 2.1": o Google renomeou em 06/10/2026).
 */
export const nomeExato = (rotulo: string) => new RegExp(`(^|\\s)${escapar(rotulo)}(\\.\\d+)*$`);

export const mesmoNome = (a: string, b: string) => normalizar(a).toLowerCase() === normalizar(b).toLowerCase();
