// Saldo de créditos do Flow.
import { type Page } from "playwright";
import { irPara } from "../navegador.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F } from "../seletores.js";
import { fecharFlutuantes } from "./tela.js";
import { comFlow } from "./sessao.js";

/** Lê o saldo no painel da conta. Devolve null se não conseguir (não é fatal). */
export async function lerCreditos(p: Page): Promise<number | null> {
  try {
    await fecharFlutuantes(p);
    await p.getByRole("button", { name: F.contaDetalhes }).click({ timeout: 10000 });
    const alvo = p.getByText(F.textoCreditos).first();
    await alvo.waitFor({ timeout: 8000 });
    const m = (await alvo.innerText()).match(F.textoCreditos);
    return m ? Number(m[1].replace(/\./g, "")) : null;
  } catch {
    return null;
  } finally {
    await p.getByRole("button", { name: F.fecharPainelConta }).click({ timeout: 2000 }).catch(() => {});
    await fecharFlutuantes(p);
  }
}

export function creditosFlow(prazo: Prazo): Promise<number | null> {
  return comFlow(prazo, async (p) => {
    await irPara(p, F.url);
    await p.getByRole("button", { name: F.contaDetalhes }).waitFor({ timeout: 30000 });
    return lerCreditos(p);
  });
}
