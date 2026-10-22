import type { Page } from "playwright";
import { NOMES_TIPO, gerando, itensDoEstudio, pronto, type LoteEstudio, type RelatorioItem } from "./tipos.js";
import type { Prazo } from "../prazo.js";
import { abrirNotebook, comNotebook, type Progresso } from "../notebook-base.js";
import { salvarItem } from "./salvar-item.js";
import { registrar } from "../arquivos.js";
import { VALIDADE_LOTE_MS, atualizarLotes, lerLotes } from "./lotes.js";

// Acompanhar as gerações em andamento e baixar o que ficou pronto.

export async function acompanhar(p: Page, notebook: string, lotes: LoteEstudio[], prazo: Prazo, progresso: Progresso): Promise<RelatorioItem[]> {
  const relatorios = new Map<string, RelatorioItem>();
  const faltas = new Map<string, number>();
  const abertos = () => lotes.filter((l) => !relatorios.has(l.lote));
  for (;;) {
    const itens = await itensDoEstudio(p, notebook);
    for (const l of abertos()) {
      const item = itens.find((i) => i.id === l.item);
      if (!item) {
        faltas.set(l.lote, (faltas.get(l.lote) ?? 0) + 1);
        // Recém-criado pode demorar a aparecer na lista: só desiste depois de 2 leituras e 60 s.
        if (faltas.get(l.lote)! >= 2 && Date.now() - Date.parse(l.criadoEm) > 60000) {
          relatorios.set(l.lote, { lote: l, estado: "sumiu", arquivos: [], avisos: ["O item não existe mais no notebook (foi excluído?)."] });
        }
      }
      else if (pronto(item)) {
        if (!prazo.sobra(10000)) continue; // fica para a próxima chamada
        progresso(`Baixando ${NOMES_TIPO[item.tipo]} "${item.titulo}"…`);
        try {
          relatorios.set(l.lote, { lote: l, estado: "pronto", item, ...(await salvarItem(p, item, l.baixar, prazo)) });
          registrar({ servico: "notebooklm", acao: "baixado", tipo: item.tipo, notebook, item: item.id, titulo: item.titulo });
        } catch (e) {
          const semTempo = !prazo.sobra(8000);
          if (!semTempo) relatorios.set(l.lote, { lote: l, estado: "falhou", item, arquivos: [], avisos: [`Ficou pronto, mas o download falhou: ${(e as Error).message} Tente notebook_estudio_baixar.`] });
        }
      } else if (!gerando(item)) {
        relatorios.set(l.lote, { lote: l, estado: "falhou", item, arquivos: [], avisos: [`O NotebookLM não conseguiu gerar (código ${item.status}).`] });
      } else if (Date.now() - Date.parse(l.criadoEm) > VALIDADE_LOTE_MS) {
        relatorios.set(l.lote, { lote: l, estado: "expirado", item, arquivos: [], avisos: ["Passou de 6 h gerando; confira no NotebookLM com notebook_estudio."] });
      }
    }
    if (!abertos().length || !prazo.sobra(12000)) break;
    const faltam = abertos().map((l) => NOMES_TIPO[l.tipo]).join(", ");
    progresso(`Gerando no NotebookLM: ${faltam} (${Math.round(prazo.decorrido())}s)…`);
    await p.waitForTimeout(Math.max(1000, Math.min(10000, prazo.restante() - 10000)));
  }
  for (const l of abertos()) relatorios.set(l.lote, { lote: l, estado: "aguardando", arquivos: [], avisos: [] });
  return lotes.map((l) => relatorios.get(l.lote)!);
}


/** Retoma as gerações que passaram do tempo (todas ou só as de um notebook/lote/item). */
export function statusEstudio(prazo: Prazo, filtro: string | undefined, progresso: Progresso = () => {}): Promise<RelatorioItem[]> {
  const filtrar = () => lerLotes().filter((l) => !filtro || [l.lote, l.notebook, l.item].includes(filtro));
  if (!filtrar().length) return Promise.resolve([]);
  return comNotebook(prazo, async (p) => {
    // Lido de novo já com o navegador travado: o outro app (Code/Desktop) pode ter resolvido algum.
    const lotes = filtrar();
    const relatorios: RelatorioItem[] = [];
    for (const notebook of [...new Set(lotes.map((l) => l.notebook))]) {
      let doNotebook = lotes.filter((l) => l.notebook === notebook);
      // Vencidos saem sem abrir nada (o notebook pode nem existir mais).
      for (const l of doNotebook.filter((x) => Date.now() - Date.parse(x.criadoEm) > VALIDADE_LOTE_MS)) {
        relatorios.push({ lote: l, estado: "expirado", arquivos: [], avisos: ["Passou de 6 h sem terminar; confira no NotebookLM com notebook_estudio."] });
      }
      doNotebook = doNotebook.filter((x) => Date.now() - Date.parse(x.criadoEm) <= VALIDADE_LOTE_MS);
      if (!doNotebook.length) continue;
      if (!prazo.sobra(20000)) {
        relatorios.push(...doNotebook.map((l) => ({ lote: l, estado: "aguardando" as const, arquivos: [], avisos: ["Não verificado nesta chamada (faltou tempo)."] })));
        continue;
      }
      try {
        await abrirNotebook(p, notebook);
        relatorios.push(...(await acompanhar(p, notebook, doNotebook, prazo, progresso)));
      } catch (erro) {
        // Um notebook com problema (excluído, sem acesso) não trava o acompanhamento dos outros.
        relatorios.push(...doNotebook.map((l) => ({ lote: l, estado: "aguardando" as const, arquivos: [], avisos: [`Não consegui abrir o notebook agora: ${(erro as Error).message.split("\n")[0]}`] })));
      }
    }
    atualizarLotes(relatorios);
    return relatorios;
  });
}
