import type { Prazo } from "../prazo.js";
import { NOMES_TIPO, gerando, itensDoEstudio, minutos, pronto, type FormatoBaixar, type ItemEstudio, type LoteEstudio, type RelatorioItem } from "./tipos.js";
import { abrirNotebook, acharPorNome, comNotebook, lerUso, limitarTexto, type Uso } from "../notebook-base.js";
import type { Page } from "playwright";
import { NOTEBOOK as S, type TipoEstudio } from "../seletores.js";
import { salvarItem } from "./salvar-item.js";
import { formatarTamanho } from "../arquivos.js";

// Listar, baixar, renomear e excluir itens do Estúdio; texto do relatório.

export function listarEstudio(prazo: Prazo, notebook: string): Promise<{ notebook: string; itens: ItemEstudio[]; uso: Uso | null }> {
  return comNotebook(prazo, async (p) => {
    const id = await abrirNotebook(p, notebook);
    return { notebook: id, itens: await itensDoEstudio(p, id), uso: await lerUso(p).catch(() => null) };
  });
}

export async function acharItem(p: Page, notebook: string, busca: string): Promise<ItemEstudio> {
  const itens = await itensDoEstudio(p, notebook);
  if (!itens.length) throw new Error("Este notebook não tem itens no Estúdio.");
  return acharPorNome(itens, busca, (i) => i.id, (i) => i.titulo, "Item do Estúdio");
}

export function baixarItemEstudio(prazo: Prazo, notebook: string, busca: string, baixar?: FormatoBaixar): Promise<RelatorioItem> {
  return comNotebook(prazo, async (p) => {
    const id = await abrirNotebook(p, notebook);
    const item = await acharItem(p, id, busca);
    const lote: LoteEstudio = { lote: "manual", notebook: id, item: item.id, tipo: item.tipo as TipoEstudio, baixar, criadoEm: new Date().toISOString() };
    if (!pronto(item)) {
      return { lote, estado: gerando(item) ? "aguardando" : "falhou", item, arquivos: [], avisos: [gerando(item) ? "Ainda está sendo gerado." : `Falhou no NotebookLM (código ${item.status}).`] };
    }
    if (item.tipo === "desconhecido") throw new Error("O MCP ainda não sabe baixar este tipo de item.");
    return { lote, estado: "pronto", item, ...(await salvarItem(p, item, baixar, prazo)) };
  });
}

/** Abre o menu "⋮" de um item da lista do Estúdio. */
export async function menuDoItem(p: Page, item: ItemEstudio): Promise<void> {
  const linha = p.locator(S.itemEstudio(item.id));
  await linha.waitFor({ timeout: 15000 });
  await linha.hover();
  await linha.getByRole("button", { name: "Mais", exact: true }).click({ force: true });
}

export function renomearItemEstudio(prazo: Prazo, notebook: string, busca: string, novoTitulo: string): Promise<string> {
  return comNotebook(prazo, async (p) => {
    const id = await abrirNotebook(p, notebook);
    const item = await acharItem(p, id, busca);
    await menuDoItem(p, item);
    await p.getByRole("menuitem", { name: S.menuRenomear, exact: true }).click();
    const campo = p.locator(S.tituloEstudioEditavel).first();
    await campo.fill(novoTitulo);
    await campo.press("Enter");
    for (let i = 0; i < 10; i++) {
      await p.waitForTimeout(800);
      if ((await itensDoEstudio(p, id)).find((x) => x.id === item.id)?.titulo === novoTitulo) return `Renomeado: "${item.titulo}" → "${novoTitulo}".`;
    }
    return `Pedi para renomear "${item.titulo}", mas o novo nome ainda não apareceu. Confira com notebook_estudio.`;
  });
}


export function excluirItemEstudio(prazo: Prazo, notebook: string, busca: string): Promise<string> {
  return comNotebook(prazo, async (p) => {
    const id = await abrirNotebook(p, notebook);
    const item = await acharItem(p, id, busca);
    await menuDoItem(p, item);
    await p.getByRole("menuitem", { name: S.menuExcluir }).click();
    await p.locator(S.dialogo).last().getByRole("button", { name: S.botaoExcluir, exact: true }).click();
    for (let i = 0; i < 10; i++) {
      await p.waitForTimeout(800);
      if (!(await itensDoEstudio(p, id)).some((x) => x.id === item.id)) return `Excluído do Estúdio: [${NOMES_TIPO[item.tipo]}] "${item.titulo}".`;
    }
    return `Pedi para excluir "${item.titulo}", mas ele ainda aparece. Confira com notebook_estudio.`;
  });
}

export function descreverRelatorio(r: RelatorioItem, maxTexto: number): string {
  const nome = r.item ? `${NOMES_TIPO[r.item.tipo]} "${r.item.titulo}"` : NOMES_TIPO[r.lote.tipo];
  const linhas: string[] = [];
  if (r.estado === "pronto") {
    linhas.push(`${nome}: pronto${r.item?.duracao ? ` (${minutos(r.item.duracao)})` : ""}.`);
    if (r.arquivos.length) {
      linhas.push("Arquivos salvos:", ...r.arquivos.map((a) => `- ${a.caminho}\n  (${[a.duracao ? minutos(Math.round(a.duracao)) : "", a.largura ? `${a.largura}x${a.altura}` : "", formatarTamanho(a.tamanhoMB)].filter(Boolean).join(", ")})`));
    }
    if (r.texto) linhas.push("", "Conteúdo:", limitarTexto(r.texto, maxTexto, r.arquivos.find((a) => /\.(md|html)$/.test(a.caminho))?.caminho));
  } else if (r.estado === "aguardando") {
    linhas.push(`${nome}: ainda gerando no NotebookLM (item ${r.lote.item}, lote ${r.lote.lote}). Nada se perde: chame notebook_estudio_status para acompanhar e baixar.`);
  } else {
    linhas.push(`${nome}: ${r.estado === "sumiu" ? "não existe mais" : r.estado === "expirado" ? "demorou demais" : "falhou"}.`);
  }
  if (r.avisos.length) linhas.push(`Avisos: ${r.avisos.join(" ")}`);
  return linhas.join("\n");
}

