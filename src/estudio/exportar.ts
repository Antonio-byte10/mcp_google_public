import { NOTEBOOK as S } from "../seletores.js";
import { NOMES_TIPO, pronto, type ItemEstudio } from "./tipos.js";
import path from "node:path";
import { PASTA_SAIDAS } from "../config.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Page, Response } from "playwright";
import type { Prazo } from "../prazo.js";
import { abrirNotebook, comNotebook, type Progresso } from "../notebook-base.js";
import { baixarDoGoogle } from "./conversores.js";
import { nomeArquivo, registrar, salvarNotebook } from "../arquivos.js";
import { converterEmApresentacao, enviarPptxAoDrive } from "../google-drive.js";
import { acharItem, menuDoItem } from "./itens.js";

// Exportar itens do Estúdio (Planilhas, Documentos e slides para Google Apresentações).

export type DestinoExportar = keyof typeof S.menuExportar | "apresentacoes";

export interface Exportacao {
  notebook: string;
  item: ItemEstudio;
  destino: DestinoExportar;
  /** Link do arquivo novo no Drive (vazio enquanto a exportação de slides está em andamento). */
  link: string;
  /** Slides: o que falta, quando a chamada acabou antes de terminar (chamar de novo continua). */
  andamento?: string;
  /** Slides: o .pptx salvo neste PC e se a cópia enviada ao Drive foi para a lixeira. */
  pptx?: string;
  pptxNaLixeira?: boolean;
}

// ---------- Slides → Google Apresentações (o NotebookLM não exporta) ----------

/** Exportação de slides em andamento, por item: cada passo fica salvo para a próxima chamada continuar. */
export interface PassosSlides {
  notebook: string;
  titulo: string;
  pptx: string;
  /** Id do .pptx já enviado ao Drive. */
  drive?: string;
  criadoEm: string;
}

export const ARQUIVO_SLIDES = () => path.join(PASTA_SAIDAS, "exportacoes-slides.json");

export function lerPassosSlides(): Record<string, PassosSlides> {
  if (!existsSync(ARQUIVO_SLIDES())) return {};
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO_SLIDES(), "utf8"));
    return dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {};
  } catch {
    return {};
  }
}

export function gravarPassosSlides(item: string, passos: PassosSlides | undefined): void {
  const todos = lerPassosSlides();
  if (passos) todos[item] = passos;
  else delete todos[item];
  mkdirSync(PASTA_SAIDAS, { recursive: true });
  writeFileSync(ARQUIVO_SLIDES() + ".tmp", JSON.stringify(todos, null, 2));
  renameSync(ARQUIVO_SLIDES() + ".tmp", ARQUIVO_SLIDES());
}

// Tempos medidos em 07/10/2026 (slides de 15 MB, 35 s no total): baixar o .pptx ~2 s; abrir o
// Drive e enviar ~13 s; abrir no Apresentações, converter e mandar o .pptx para a lixeira ~14 s.
export const TEMPO_BAIXAR_MS = 10000;
export const TEMPO_ENVIAR_MS = 22000;
export const TEMPO_CONVERTER_MS = 18000;

export async function exportarSlides(p: Page, notebook: string, item: ItemEstudio, prazo: Prazo, progresso: Progresso): Promise<Exportacao> {
  const titulo = item.titulo || NOMES_TIPO.slides;
  const parcial = (falta: string, passos?: PassosSlides): Exportacao => ({ notebook, item, destino: "apresentacoes", link: "", andamento: falta, pptx: passos?.pptx });
  let passos = lerPassosSlides()[item.id];
  if (!passos || !existsSync(passos.pptx)) {
    if (!prazo.sobra(TEMPO_BAIXAR_MS)) return parcial("baixar o .pptx do NotebookLM");
    progresso("Baixando o .pptx dos slides...");
    const b = await baixarDoGoogle(p, ((item.registro[16] ?? []) as unknown[])[4], prazo);
    if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error("O PPTX baixado não é válido. Nada foi enviado ao Drive.");
    passos = { notebook, titulo, pptx: salvarNotebook(nomeArquivo(titulo, "pptx"), b), criadoEm: new Date().toISOString() };
    gravarPassosSlides(item.id, passos);
  }
  if (!passos.drive) {
    if (!prazo.sobra(TEMPO_ENVIAR_MS)) return parcial("enviar o .pptx ao Google Drive", passos);
    // Nome do arquivo no Drive = título dos slides (vira o nome da apresentação convertida).
    const nome = `${titulo.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120)}.pptx`;
    passos = { ...passos, drive: await enviarPptxAoDrive(p, nome, readFileSync(passos.pptx), prazo, progresso) };
    gravarPassosSlides(item.id, passos);
  }
  if (!prazo.sobra(TEMPO_CONVERTER_MS)) return parcial("converter em Apresentações Google", passos);
  const c = await converterEmApresentacao(p, passos.drive!, prazo, progresso);
  gravarPassosSlides(item.id, undefined);
  registrar({ servico: "notebooklm", acao: "exportar", tipo: item.tipo, notebook, item: item.id, destino: "apresentacoes", link: c.link });
  return { notebook, item, destino: "apresentacoes", link: c.link, pptx: passos.pptx, pptxNaLixeira: c.pptxNaLixeira };
}

/**
 * Exporta um item do Estúdio para o Google Drive pelo próprio NotebookLM (relatório → Google Docs,
 * tabela → Planilhas). Cria um arquivo novo no Drive da conta a cada chamada.
 */
export function exportarItemEstudio(prazo: Prazo, notebook: string, busca: string, destino?: DestinoExportar, progresso: Progresso = () => {}): Promise<Exportacao> {
  return comNotebook(prazo, async (p) => {
    const id = await abrirNotebook(p, notebook);
    const item = await acharItem(p, id, busca);
    const alvo: DestinoExportar = destino ?? (item.tipo === "tabela" ? "planilhas" : item.tipo === "slides" ? "apresentacoes" : "docs");
    if (alvo === "apresentacoes" || item.tipo === "slides") {
      if (item.tipo !== "slides") throw new Error(`Só slides vão para o Google Apresentações; "${item.titulo}" é ${NOMES_TIPO[item.tipo]}. Nada foi exportado.`);
      if (alvo !== "apresentacoes") throw new Error("Slides só vão para o Google Apresentações (destino apresentacoes). Nada foi exportado.");
      if (!pronto(item)) throw new Error(`Os slides "${item.titulo}" ainda não estão prontos. Nada foi exportado.`);
      return exportarSlides(p, id, item, prazo, progresso);
    }
    // O link vem na resposta do Krh3pd; a aba que o NotebookLM abre com o arquivo é fechada.
    const abas = (aba: Page) => void aba.close().catch(() => {});
    p.context().on("page", abas);
    let entregar!: (link: string) => void;
    const link = new Promise<string>((ok) => (entregar = ok));
    const ouvir = async (r: Response) => {
      if (!S.rpcExportar.test(r.url())) return;
      const m = /https:\/\/docs\.google\.com\/(?:document|spreadsheets)\/d\/[\w-]+/.exec(await r.text().catch(() => ""));
      if (m) entregar(m[0]);
    };
    p.on("response", ouvir);
    try {
      await menuDoItem(p, item);
      const opcao = p.getByRole("menuitem", { name: S.menuExportar[alvo] });
      if (!(await opcao.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
        const tem = (await p.getByRole("menuitem").allInnerTexts()).filter((t) => /Exportar/.test(t)).map((t) => t.replace(/^\S+\s/, "").trim());
        await p.keyboard.press("Escape");
        throw new Error(
          tem.length
            ? `O item "${item.titulo}" não tem "${S.menuExportar[alvo]}". Ele oferece: ${tem.join(", ")}. Nada foi exportado.`
            : `O NotebookLM não oferece exportar "${item.titulo}" (${NOMES_TIPO[item.tipo]}) para o Google: só relatórios em formato documento (Docs/Planilhas), tabelas (Planilhas) e, pelo MCP, slides (Apresentações). Nada foi exportado.`,
        );
      }
      await opcao.click();
      let espera: ReturnType<typeof setTimeout> | undefined;
      const url = await Promise.race([
        link,
        new Promise<never>((_, falha) => {
          espera = setTimeout(() => falha(new Error("A exportação não confirmou a tempo. Confira o Google Drive (pasta Meu Drive) antes de tentar de novo, para não criar uma cópia.")), Math.max(5000, Math.min(30000, prazo.restante() - 3000)));
        }),
      ]).finally(() => clearTimeout(espera));
      registrar({ servico: "notebooklm", acao: "exportar", tipo: item.tipo, notebook: id, item: item.id, destino: alvo, link: url });
      return { notebook: id, item, destino: alvo, link: url };
    } finally {
      p.off("response", ouvir);
      p.context().off("page", abas);
    }
  });
}

