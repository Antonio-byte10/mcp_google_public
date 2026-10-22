import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

// Quanto tempo cada chamada de ferramenta pode durar.
//
// O Claude Desktop corta chamadas longas (em 05/10/2026 cortava em ~60 s; em 06/10 o log mostrou
// uma chamada de 101 s aceita e um cancelamento aos 240 s — o limite varia com a versão). Por
// segurança, fora do Claude Code toda ferramenta termina em ~50 s: o que demora mais (vídeo,
// resposta longa) continua no Google e é buscado depois por outra chamada (flow_status,
// notebook_resposta, notebook_estudio_status). MCP_GOOGLE_LIMITE_SEGUNDOS muda o valor.

const PADRAO_SEGUNDOS = 50;
const CLAUDE_CODE_SEGUNDOS = 600;
const MINIMO_SEGUNDOS = 15;
/** Reserva no fim de cada chamada para fechar o navegador e responder. */
const RESERVA_MS = 6000;

let limite = PADRAO_SEGUNDOS;
let cliente = "desconhecido";

/** Chamado depois do initialize, com o nome que o cliente MCP informou. */
export function definirCliente(nome: string | undefined): void {
  cliente = nome ?? "desconhecido";
  const forcado = Number(process.env.MCP_GOOGLE_LIMITE_SEGUNDOS);
  if (forcado > 0) limite = Math.max(MINIMO_SEGUNDOS, forcado);
  else limite = cliente === "claude-code" ? CLAUDE_CODE_SEGUNDOS : PADRAO_SEGUNDOS;
}

export function infoCliente(): { cliente: string; limiteSegundos: number } {
  return { cliente, limiteSegundos: limite };
}

/** Sinal de cancelamento da chamada atual (o app manda notifications/cancelled). */
export const contextoDaChamada = new AsyncLocalStorage<{ sinal?: AbortSignal }>();

export interface Prazo {
  /** Milissegundos que ainda restam (zera se o app cancelar a chamada). */
  restante(): number;
  /** true se ainda sobra pelo menos `ms`. */
  sobra(ms: number): boolean;
  /** Milissegundos até o fim real da chamada, sem a reserva (usado pelo vigia que fecha o navegador). */
  restanteDuro(): number;
  /** Segundos desde o começo da chamada. */
  decorrido(): number;
  /** true quando o cliente espera pouco (Claude Desktop e outros). */
  curto: boolean;
  /** Quando o app cancelou a chamada. */
  sinal?: AbortSignal;
  /** Até quando (relógio do sistema, ms) a chamada deve terminar — para avisar outros processos. */
  ate: number;
}

/** Prazo de uma chamada. Usa relógio monotônico (ajuste de hora do Windows não atrapalha). */
export function novoPrazo(segundos = limite, sinal = contextoDaChamada.getStore()?.sinal): Prazo {
  const inicio = performance.now();
  const fimDuro = inicio + segundos * 1000;
  let fim = fimDuro - RESERVA_MS;
  const cancelar = () => {
    fim = Math.min(fim, performance.now());
  };
  if (sinal?.aborted) cancelar();
  else sinal?.addEventListener("abort", cancelar, { once: true });
  return {
    restante: () => Math.max(0, fim - performance.now()),
    sobra: (ms) => fim - performance.now() >= ms,
    restanteDuro: () => Math.max(0, (sinal?.aborted ? fim : fimDuro) - performance.now()),
    decorrido: () => Math.round((performance.now() - inicio) / 1000),
    curto: segundos < 120,
    sinal,
    ate: Date.now() + segundos * 1000,
  };
}
