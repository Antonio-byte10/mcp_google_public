import type { Page } from "playwright";
import { abrirNotebook, chamarRpc, comNotebook, CTX, esperaAte, limitarTexto, type Progresso } from "./notebook-base.js";
import { NOTEBOOK as S } from "./seletores.js";
import { nomeArquivo, salvarNotebook } from "./arquivos.js";
import { descreverFonte, esperarFontesNovas, fontesDoNotebook } from "./notebook-fontes.js";
import type { Prazo } from "./prazo.js";

// Pesquisa de fontes na web do notebook (Pesquisa rápida e Deep Research): pesquisar e importar.

export interface ResultadoPesquisa {
  url: string;
  titulo: string;
  descricao: string;
  /** Só no relatório que a Deep Research escreve (vem como resultado sem link). */
  relatorio?: string;
}

interface Pesquisa {
  id: string;
  consulta: string;
  modo: "rapida" | "profunda";
  concluida: boolean;
  resultados: ResultadoPesquisa[];
  resumo: string;
}

/**
 * Pesquisa de fontes do notebook (e3bVqc) com os resultados, se já terminou: a da consulta pedida
 * ou, sem consulta, a mais recente (a lista não vem em ordem fixa).
 */
async function pesquisasDoNotebook(pagina: Page, id: string): Promise<unknown[][]> {
  const dados = await chamarRpc<unknown[]>(pagina, S.rpc.pesquisa, [CTX, null, id]);
  const quando = (e: unknown[]) => Number((e[2] as unknown[])?.[0] ?? 0);
  return ((dados?.[0] ?? []) as unknown[][]).sort((a, b) => quando(b) - quando(a));
}

/** Uma pesquisa pelo id dela ou, sem id, a mais recente do notebook. */
async function ultimaPesquisa(pagina: Page, id: string, idPesquisa?: string): Promise<Pesquisa | null> {
  const lista = await pesquisasDoNotebook(pagina, id);
  const entrada = idPesquisa ? lista.find((e) => e[0] === idPesquisa) : lista[0];
  if (!entrada) return null;
  const p = (entrada[1] ?? []) as unknown[];
  const pedida = (p[1] ?? []) as unknown[];
  const corpo = (p[3] ?? []) as unknown[];
  return {
    id: String(entrada[0]),
    consulta: String(pedida[0] ?? ""),
    // p[2]: 1 = Pesquisa rápida, 5 = Deep Research (mapeado em 06/10/2026)
    modo: p[2] === 1 ? "rapida" : "profunda",
    concluida: p[4] === 2,
    resultados: ((corpo[0] ?? []) as unknown[][]).map((r) => {
      const relatorio = !r[0] && typeof (r[6] as unknown[])?.[0] === "string" ? ((r[6] as unknown[])[0] as string) : undefined;
      return { url: String(r[0] ?? ""), titulo: String(r[1] ?? ""), descricao: String(r[2] ?? ""), relatorio };
    }),
    resumo: typeof corpo[1] === "string" ? corpo[1] : "",
  };
}

export interface PedidoPesquisa {
  notebook: string;
  consulta?: string;
  modo: "rapida" | "profunda";
  /** "todas", "nenhuma" ou os números dos resultados (1, 2, 3…). */
  importar: "todas" | "nenhuma" | number[];
}

export function pesquisarFontes(prazo: Prazo, pedido: PedidoPesquisa, progresso: Progresso = () => {}): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, pedido.notebook);
    let pesquisa = await ultimaPesquisa(pagina, id);
    let profunda = pesquisa?.modo === "profunda";

    if (pedido.consulta) {
      const campo = pagina.getByRole("textbox", { name: S.campoPesquisa }).first();
      if (await campo.isDisabled()) throw new Error("Já há uma pesquisa de fontes em andamento neste notebook. Espere terminar (chame de novo sem consulta).");
      await campo.fill(pedido.consulta);
      const modoAtual = pagina.getByRole("button", { name: S.botaoModoPesquisa }).first();
      profunda = pedido.modo === "profunda";
      if ((await modoAtual.innerText()).includes("Deep") !== profunda) {
        await modoAtual.click();
        await pagina.getByRole("menuitem", { name: S.opcaoModo[pedido.modo] }).click();
      }
      // A pesquisa nova é a que aparece com um id que não existia antes (o texto pode repetir uma antiga).
      const idsAntes = new Set((await pesquisasDoNotebook(pagina, id)).map((e) => String(e[0])));
      await campo.press("Enter");
      progresso(profunda ? "Deep Research iniciada (pode levar alguns minutos)…" : "Pesquisando fontes na web…");
      let nova: string | undefined;
      for (let i = 0; i < 15 && !nova; i++) {
        await pagina.waitForTimeout(1000);
        nova = (await pesquisasDoNotebook(pagina, id)).map((e) => String(e[0])).find((x) => !idsAntes.has(x));
      }
      if (!nova) throw new Error("O NotebookLM não começou a pesquisa (o campo pode ter recusado a consulta). Nada foi importado.");
      pesquisa = await ultimaPesquisa(pagina, id, nova);
    }
    if (!pesquisa) throw new Error("Este notebook não tem pesquisa de fontes. Informe consulta.");

    // Espera terminar (a pesquisa nova ou a que já estava em andamento) até o prazo da chamada.
    const limite = Date.now() + esperaAte(prazo, profunda ? 600000 : 120000);
    while (!pesquisa.concluida) {
      if (Date.now() > limite) {
        return `Pesquisa "${pesquisa.consulta}" ainda em andamento no Google (notebook ${id}${profunda ? "; a Deep Research leva alguns minutos" : ""}). Chame notebook_pesquisar_fontes de novo SEM 'consulta' para ver os resultados e importar.`;
      }
      progresso(`Pesquisa em andamento (${Math.round(prazo.decorrido())}s)…`);
      await pagina.waitForTimeout(4000);
      pesquisa = (await ultimaPesquisa(pagina, id, pesquisa.id)) ?? pesquisa;
    }
    const lista = pesquisa.resultados.map((r, i) =>
      r.relatorio ? `${i + 1}. [Relatório da Deep Research] ${r.titulo}` : `${i + 1}. ${r.titulo}\n   ${r.url}${r.descricao ? `\n   ${r.descricao}` : ""}`,
    );
    const relatorio = pesquisa.resultados.find((r) => r.relatorio);
    if (relatorio?.relatorio) {
      const caminho = salvarNotebook(nomeArquivo(relatorio.titulo, "md", "_deep-research"), relatorio.relatorio);
      lista.push("", `Relatório da Deep Research salvo em ${caminho}. Começo:`, limitarTexto(relatorio.relatorio, 3000, caminho));
    }
    const cabecalho = [`Pesquisa "${pesquisa.consulta}" (${pesquisa.modo === "rapida" ? "rápida" : "Deep Research"}) no notebook ${id}:`, pesquisa.resumo].filter(Boolean);

    if (pedido.importar === "nenhuma") {
      return [...cabecalho, "", ...lista, "", "Nada importado. Para importar, chame de novo sem 'consulta' com importar = \"todas\" ou a lista de números."].join("\n");
    }

    const importar = pagina.getByRole("button", { name: S.botaoImportar, exact: true });
    // O RPC diz "concluída" antes da tela desenhar os resultados: numa pesquisa recém-terminada o
    // botão demora alguns segundos (em 07/10 a 1ª chamada falhou aqui e a 2ª, logo depois, importou).
    const espera = Math.max(2000, Math.min(15000, prazo.restante() - 20000));
    if (!(await importar.first().waitFor({ state: "visible", timeout: espera }).then(() => true, () => false))) {
      throw new Error("Os resultados desta pesquisa não estão mais disponíveis para importar (já foram importados ou descartados). Faça uma nova pesquisa.");
    }
    let escolhidos = pesquisa.resultados;
    if (Array.isArray(pedido.importar)) {
      const fora = pedido.importar.filter((n) => n < 1 || n > pesquisa!.resultados.length);
      if (fora.length) throw new Error(`Números fora da lista (1 a ${pesquisa.resultados.length}): ${fora.join(", ")}.`);
      escolhidos = pedido.importar.map((n) => pesquisa!.resultados[n - 1]);
      await pagina.getByRole("button", { name: S.botaoVerFontes }).click();
      await pagina.getByRole("checkbox", { name: S.selecionarTodasPesquisa }).first().waitFor({ timeout: 10000 });
      // Confere caixinha por caixinha: nem todo item obedece ao "Selecionar tudo" (o relatório da
      // Deep Research, por exemplo), então só clica onde o estado é diferente do pedido.
      const naoAchados: string[] = [];
      for (const r of pesquisa.resultados) {
        const caixa = pagina.getByRole("checkbox", { name: r.titulo, exact: true }).first();
        if (!(await caixa.count())) {
          if (escolhidos.includes(r)) naoAchados.push(r.titulo);
          continue;
        }
        if ((await caixa.isChecked()) !== escolhidos.includes(r)) {
          await caixa.click({ force: true });
          await pagina.waitForTimeout(200);
        }
      }
      if (naoAchados.length) throw new Error(`Não achei na tela os resultados: ${naoAchados.map((t) => `"${t}"`).join(", ")}.`);
      const marcados = await pagina.getByText(/\d+ fontes? selecionadas?/).first().innerText().catch(() => "");
      if (marcados && parseInt(marcados, 10) !== escolhidos.length) {
        throw new Error(`Esperava ${escolhidos.length} resultado(s) marcado(s), mas a tela diz "${marcados}". Nada foi importado.`);
      }
    }
    const antes = new Set((await fontesDoNotebook(pagina, id)).fontes.map((f) => f.id));
    await importar.first().click();
    progresso(`Importando ${escolhidos.length} fonte(s)…`);
    const r = await esperarFontesNovas(pagina, id, antes, escolhidos.length, prazo, progresso);
    return [
      ...cabecalho,
      "",
      `Importadas ${r.novas.length} de ${escolhidos.length} fonte(s):`,
      ...r.novas.map((f) => descreverFonte(f)),
      r.completo ? "" : "Algumas ainda estão sendo processadas; confira com notebook_fontes.",
      `Total de fontes: ${r.todas.length}.`,
    ].filter(Boolean).join("\n");
  });
}
