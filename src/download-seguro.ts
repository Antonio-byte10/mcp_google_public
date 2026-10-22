import type { BrowserContext } from "playwright";

// Download com redirecionamentos tratados à mão: cada endereço (o inicial e cada Location) é conferido
// contra a lista de permitidos ANTES de qualquer requisição. O cliente HTTP do Playwright seguiria os
// redirecionamentos sozinho e só daria para conferir resp.url() depois que o destino já foi acessado;
// com maxRedirects: 0 ele devolve a resposta 3xx com o Location e cada salto passa pela nossa conferência.
// Mantém o cliente do contexto (cookies da sessão, Set-Cookie, user-agent, proxy e TLS do navegador).

/** Uma requisição GET sem seguir redirecionamentos. */
export interface Salto {
  status: number;
  location?: string;
  ok: boolean;
  corpo: () => Promise<Buffer>;
}
export type FazerSalto = (url: string, timeoutMs: number) => Promise<Salto>;

export interface OpcoesDownload {
  /** Descrição do destino permitido, para as mensagens ("dos servidores do Google"). */
  rotulo: string;
  timeoutMs: number;
  maxSaltos?: number;
}

const REDIRECIONAMENTOS = new Set([301, 302, 303, 307, 308]);
const MAX_SALTOS_PADRAO = 5;

export async function baixarComRedirecionamentoSeguro(
  salto: FazerSalto,
  url: string,
  permitido: (u: string) => boolean,
  op: OpcoesDownload,
): Promise<Buffer> {
  const max = op.maxSaltos ?? MAX_SALTOS_PADRAO;
  const limite = Date.now() + op.timeoutMs;
  let atual = url;
  for (let i = 0; i <= max; i++) {
    if (!permitido(atual)) {
      throw new Error(i === 0 ? `Link de download fora ${op.rotulo}; recusado.` : `O download foi redirecionado para fora ${op.rotulo}; recusado.`);
    }
    const resp = await salto(atual, Math.max(1000, limite - Date.now()));
    if (REDIRECIONAMENTOS.has(resp.status)) {
      if (!resp.location) throw new Error(`Redirecionamento sem destino (HTTP ${resp.status}).`);
      let proximo: string;
      try {
        proximo = new URL(resp.location, atual).toString();
      } catch {
        throw new Error("Redirecionamento com destino inválido; recusado.");
      }
      atual = proximo;
      continue;
    }
    if (!resp.ok) throw new Error(`Download falhou (HTTP ${resp.status}).`);
    return resp.corpo();
  }
  throw new Error("Redirecionamentos demais no download; recusado.");
}

/** Salto real: GET do contexto do Playwright sem seguir redirecionamentos (devolve o 3xx com o Location). */
export function saltoDoContexto(ctx: BrowserContext): FazerSalto {
  return async (url, timeoutMs) => {
    const r = await ctx.request.get(url, { maxRedirects: 0, timeout: timeoutMs });
    return {
      status: r.status(),
      location: r.headers()["location"],
      ok: r.ok(),
      corpo: () => r.body(),
    };
  };
}
