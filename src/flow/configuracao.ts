// Menu de configuração da caixa de comando: modelo, modo, proporção, quantidade e custo.
import { type Page } from "playwright";
import { FLOW as F, MODELOS_FLOW, MODELOS_IMAGEM } from "../seletores.js";
import { type ModeloVideo, type ModeloImagem, type ProporcaoVideo, type ProporcaoImagem, normalizar, nomeExato } from "./base.js";
import { fecharFlutuantes } from "./tela.js";

export function numeroDeCreditos(texto: string): number | null {
  const m = texto.match(/(\d[\d.]*)\s*créditos?/);
  return m ? Number(m[1].replace(/\./g, "")) : null;
}

async function lerCusto(p: Page): Promise<number> {
  const texto = p.locator(F.overlay).getByText(F.textoCusto).first();
  let anterior = "";
  // O valor atualiza depois de cada clique: espera ficar estável.
  for (let i = 0; i < 10; i++) {
    await p.waitForTimeout(500);
    const atual = await texto.locator("..").innerText().catch(() => "");
    if (atual && atual === anterior) break;
    anterior = atual;
  }
  const n = numeroDeCreditos(anterior);
  if (n === null) throw new Error(`Não consegui ler o custo da geração ("${normalizar(anterior)}").`);
  return n;
}

/** Abre o menu de configuração da caixa de comando (se ainda não estiver aberto). */
export async function abrirConfig(p: Page): Promise<void> {
  const ov = p.locator(F.overlay);
  const aberto = () => ov.getByRole("radio", { name: F.abaVideo }).isVisible().catch(() => false);
  if (await aberto()) return;
  await fecharFlutuantes(p);
  // Depois de escolher um quadro, o primeiro clique no botão é ignorado pela página; tenta de novo.
  for (let i = 0; i < 3 && !(await aberto()); i++) {
    await p.locator(F.gatilhoConfig).first().click();
    await ov.getByRole("radio", { name: F.abaVideo }).waitFor({ timeout: 2500 }).catch(() => {});
  }
  if (!(await aberto())) throw new Error("O menu de configuração do Flow não abriu. A interface pode ter mudado (rode diagnostico).");
}

/** Escolhe o modelo e devolve o nome que o Flow mostra (pode ser uma versão nova, ex.: "Nano Banana 2.1"). */
async function escolherModelo(p: Page, rotulo: string): Promise<string> {
  const ov = p.locator(F.overlay);
  const botao = ov.getByRole("button", { name: F.menuModelo });
  await botao.click();
  await ov.getByRole("menuitem", { name: nomeExato(rotulo) }).click();
  await p.waitForTimeout(600);
  const atual = normalizar((await botao.innerText()).replace(/arrow_drop_down|expand_more/g, ""));
  if (!nomeExato(rotulo).test(atual)) throw new Error(`O Flow não aceitou o modelo ${rotulo} (mostra "${atual}").`);
  return atual.replace(/^[^A-Za-z]+/, "");
}

export type ModoVideo = "elementos" | "frames";

export interface FormatoVideo {
  modo: ModoVideo;
  modelo: ModeloVideo;
  proporcao: ProporcaoVideo;
  quantidade: number;
  duracao?: number;
  resolucao?: "360p" | "720p";
}

/** Só troca para Vídeo e o modo (Frames ou Elementos); usado antes de escolher os quadros. */
export async function escolherModoVideo(p: Page, modo: ModoVideo): Promise<void> {
  const ov = p.locator(F.overlay);
  await abrirConfig(p);
  await ov.getByRole("radio", { name: F.abaVideo }).click();
  await ov.getByRole("radio", { name: modo === "frames" ? F.modoFrames : F.modoElementos }).click();
  await p.waitForTimeout(500);
  await fecharFlutuantes(p);
}

/** Escolhe tipo, modo, proporção, modelo, resolução, duração e quantidade no menu. Devolve o custo exibido. */
export async function configurarVideo(p: Page, f: FormatoVideo): Promise<{ custo: number; resumo: string }> {
  const ov = p.locator(F.overlay);
  await abrirConfig(p);
  await ov.getByRole("radio", { name: F.abaVideo }).click();
  await ov.getByRole("radio", { name: f.modo === "frames" ? F.modoFrames : F.modoElementos }).click();
  await ov.getByRole("radio", { name: f.proporcao, exact: true }).click();

  const rotulo = MODELOS_FLOW[f.modelo];
  const nomeReal = await escolherModelo(p, rotulo);
  if (f.modelo === "omni-1.1-flash") {
    await ov.getByRole("radio", { name: new RegExp(`^${f.resolucao ?? "720p"}`) }).click();
    await ov.getByRole("radio", { name: `${f.duracao ?? 8}s`, exact: true }).click();
  }
  await ov.getByRole("radio", { name: `x${f.quantidade}`, exact: true }).click();

  const custo = await lerCusto(p);
  await fecharFlutuantes(p);
  const resumo = normalizar((await p.locator(F.gatilhoConfig).first().innerText()).replace(/crop_\w+/g, f.proporcao));
  if (!resumo.includes(`x${f.quantidade}`) || !/Vídeo/i.test(resumo)) {
    throw new Error(`A configuração não ficou como pedido (Flow mostra: "${resumo}").`);
  }
  return { custo, resumo: `${nomeReal || rotulo} · ${f.modo === "frames" ? "Frames · " : ""}${resumo}` };
}

export interface FormatoImagem {
  modelo: ModeloImagem;
  proporcao: ProporcaoImagem;
  quantidade: number;
}

export async function configurarImagem(p: Page, f: FormatoImagem): Promise<{ custo: number; resumo: string }> {
  const ov = p.locator(F.overlay);
  await abrirConfig(p);
  await ov.getByRole("radio", { name: F.abaImagem }).click();
  await ov.getByRole("radio", { name: f.proporcao, exact: true }).click();
  const rotulo = MODELOS_IMAGEM[f.modelo];
  const nomeReal = await escolherModelo(p, rotulo);
  await ov.getByRole("radio", { name: `x${f.quantidade}`, exact: true }).click();
  const custo = await lerCusto(p);
  await fecharFlutuantes(p);
  const resumo = normalizar(await p.locator(F.gatilhoConfig).first().innerText());
  if (!resumo.includes(`x${f.quantidade}`) || !resumo.includes(rotulo)) {
    throw new Error(`A configuração não ficou como pedido (Flow mostra: "${resumo}").`);
  }
  return { custo, resumo: `${nomeReal || rotulo} · imagem ${f.proporcao} · x${f.quantidade}` };
}
