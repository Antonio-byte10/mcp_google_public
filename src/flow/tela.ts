// Ações básicas na tela do Flow: fechar painéis, preparar a caixa de comando e digitar o prompt.
import { type Page } from "playwright";
import { FLOW as F } from "../seletores.js";
import { normalizar } from "./base.js";

/** Fecha menus e painéis flutuantes. Alguns não fecham com Esc, só clicando fora. */
export async function fecharFlutuantes(p: Page): Promise<void> {
  // No modo de extensão, um Esc sem painel aberto SAI do modo (e os elementos já colocados somem):
  // lá só aperta Esc se houver um painel flutuante visível para fechar.
  const emExtensao = await p.getByRole("button", { name: F.modoExtensao }).isVisible().catch(() => false);
  const painelAberto = async () => p.locator(F.painelFlutuante).filter({ has: p.locator("*") }).first().isVisible().catch(() => false);
  if (!emExtensao || (await painelAberto())) await p.keyboard.press("Escape").catch(() => {});
  await p.waitForTimeout(300);
  const fundo = p.locator(F.fundoFlutuante);
  for (let i = 0; i < 4 && (await fundo.count()); i++) {
    await fundo.last().click({ position: { x: 3, y: 3 }, timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(500);
  }
}

/** Garante a caixa de baixo no modo direto (Agente desligado), sem o painel do agente aberto. */
export async function prepararModoDireto(p: Page): Promise<void> {
  await p.waitForTimeout(1000);
  const chip = p.locator(F.chipAgente).first();
  if (!(await chip.isVisible().catch(() => false))) {
    // O painel lateral do agente esconde a caixa de baixo; o botão "Fechar" dele fecha.
    await p.getByRole("button", { name: "Fechar", exact: true }).first().click({ timeout: 5000 }).catch(() => {});
    await chip.waitFor({ timeout: 10000 }).catch(() => {});
  }
  if (!(await chip.isVisible().catch(() => false))) {
    throw new Error("Não encontrei a caixa de comando do Flow. A interface pode ter mudado.");
  }
  if ((await chip.getAttribute("class"))?.includes(F.chipAgenteLigado)) {
    await chip.click();
    await p.waitForTimeout(800);
    if ((await chip.getAttribute("class"))?.includes(F.chipAgenteLigado)) {
      throw new Error("Não consegui desligar o modo Agente do Flow.");
    }
  }
  // O Flow guarda o rascunho (texto, quadros e personagens) entre sessões: começa do zero
  // para nenhum elemento antigo entrar na geração sem ter sido pedido.
  await limparCaixa(p);
}

/** Digita o prompt na caixa e confere se entrou inteiro (um Enter no meio enviaria cortado). */
export async function digitarPrompt(p: Page, prompt: string, caixaSel = F.caixaPrompt, ultima = false): Promise<void> {
  const caixas = p.locator(caixaSel);
  const caixa = ultima ? caixas.last() : caixas.first();
  await caixa.click();
  await p.keyboard.press("Control+A");
  await p.keyboard.press("Delete");
  await p.keyboard.insertText(prompt);
  if (normalizar(await caixa.innerText()) !== prompt) {
    throw new Error("O texto do prompt não entrou completo na caixa do Flow. Nada foi gerado.");
  }
}

/** Limpa o rascunho da caixa de comando (texto e elementos que o Flow guardou de outra sessão). */
async function limparCaixa(p: Page): Promise<void> {
  const apagar = p.getByRole("button", { name: F.apagarComando }).first();
  for (let i = 0; i < 3 && (await apagar.isVisible().catch(() => false)); i++) {
    await apagar.click().catch(() => {});
    await p.waitForTimeout(700);
  }
}
