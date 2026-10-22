// Sessão do navegador no Flow com o rastreador de rede ligado, e o erro de envio que não aconteceu.
import { type Page } from "playwright";
import { comPagina } from "../navegador.js";
import { type Prazo } from "../prazo.js";
import { Rastreador } from "./rastreador.js";

/** Roda a tarefa com o rastreador de rede ligado desde o primeiro carregamento. */
export function comFlow<T>(prazo: Prazo, tarefa: (p: Page, r: Rastreador) => Promise<T>): Promise<T> {
  return comPagina(
    async (p) => {
      // Esperou a vez (outra chamada estava com o navegador) e o tempo acabou: não começa.
      if (!prazo.sobra(20000)) throw new Error("O navegador estava ocupado com outra tarefa e o tempo desta chamada acabou; nada foi feito. Tente de novo.");
      const r = new Rastreador(p);
      try {
        return await tarefa(p, r);
      } finally {
        r.parar();
      }
    },
    prazo,
  );
}

/**
 * Último ponto antes de gastar: se não sobra tempo para confirmar o pedido, não envia. No Claude
 * Desktop a chamada seria cortada logo depois do clique, o usuário veria um erro e pediria de novo
 * (pagando duas vezes).
 */
export function exigirTempoParaEnviar(prazo: Prazo): void {
  if (!prazo.sobra(15000)) throw new EnvioNaoAconteceu("O tempo desta chamada acabou antes do envio: nada foi gerado nem gasto. Peça de novo.");
}

/** Erro de um envio que com certeza não aconteceu (nada foi gasto): quem reservou pode desfazer. */
export class EnvioNaoAconteceu extends Error {}
