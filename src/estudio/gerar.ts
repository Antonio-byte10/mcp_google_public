import { ESTUDIO, NOTEBOOK as S, type TipoEstudio } from "../seletores.js";
import { abrirNotebook, acharPorNome, comNotebook, esperaAte, lerUso, type Progresso, type Uso } from "../notebook-base.js";
import { NOMES_TIPO, itensDoEstudio, type LoteEstudio, type RelatorioItem } from "./tipos.js";
import { aplicarOpcoes, fecharDialogo, idDoItemCriado, lerMedidor, type PedidoEstudio } from "./opcoes.js";
import type { Prazo } from "../prazo.js";
import { fontesDoNotebook } from "../notebook-fontes.js";
import { capturaDeErro, registrar } from "../arquivos.js";
import { alterarLotesEstudio, atualizarLotes } from "./lotes.js";
import { acompanhar } from "./acompanhar.js";

// Criar um item do Estúdio pelo diálogo da tela.

export interface ResultadoEstudio {
  notebook: string;
  tipo: TipoEstudio;
  opcoes: string[];
  medidor: { usado: number; estimado: number } | null;
  usoDepois?: Uso;
  avisos: string[];
  relatorio: RelatorioItem;
}

export function gerarItemEstudio(pedido: PedidoEstudio, prazo: Prazo, progresso: Progresso = () => {}): Promise<ResultadoEstudio> {
  return comNotebook(prazo, async (p) => {
    const notebook = await abrirNotebook(p, pedido.notebook);
    const { fontes: doNotebook } = await fontesDoNotebook(p, notebook);
    if (!doNotebook.length) throw new Error("O notebook não tem fontes; adicione pelo menos uma antes de usar o Estúdio.");
    // Fontes pedidas por id ou trecho viram o título exato (é o que aparece no diálogo do Estúdio).
    if (pedido.fontes?.length) pedido = { ...pedido, fontes: pedido.fontes.map((n) => acharPorNome(doNotebook, n, (f) => f.id, (f) => f.titulo, "Fonte").titulo) };
    const antes = new Set((await itensDoEstudio(p, notebook)).map((i) => i.id));
    progresso(`Abrindo ${NOMES_TIPO[pedido.tipo]}…`);
    await p.mouse.move(640, 10); // as dicas dos outros botões tapam o alvo
    await p.locator(S.botaoEstudio(ESTUDIO[pedido.tipo].rotulo)).click({ timeout: 20000 });
    const d = p.locator(S.dialogo).last();
    await d.getByRole("button", { name: S.gerarAgora }).waitFor({ timeout: 15000 });
    await p.waitForTimeout(800);

    const avisos: string[] = [];
    let opcoes: string[];
    try {
      opcoes = await aplicarOpcoes(d, pedido, avisos);
    } catch (e) {
      await fecharDialogo(d);
      throw e;
    }
    const medidor = await lerMedidor(d);
    if (pedido.usoMaximo !== undefined) {
      if (medidor && medidor.usado + medidor.estimado > pedido.usoMaximo) {
        await fecharDialogo(d);
        throw new Error(`Não gerei: o uso iria para ~${Math.round(medidor.usado + medidor.estimado)}% do limite atual (agora ${medidor.usado}%, este item ~${medidor.estimado}%), acima de uso_maximo = ${pedido.usoMaximo}%.`);
      }
      if (!medidor) {
        // O medidor do diálogo não apareceu: confere ao menos o uso atual antes de gastar.
        const uso = await lerUso(p).catch(() => null);
        if (!uso?.janela || uso.janela.usado >= pedido.usoMaximo) {
          await fecharDialogo(d);
          throw new Error(`Não gerei: não consegui ler o uso estimado deste item${uso?.janela ? ` e o uso atual já é ${uso.janela.usado}%` : ""} (uso_maximo = ${pedido.usoMaximo}%).`);
        }
        avisos.push(`Não consegui ler o uso estimado deste item; o uso atual era ${uso.janela.usado}%.`);
      }
    }
    const botao = d.getByRole("button", { name: S.gerarAgora });
    if (await botao.isDisabled()) {
      await fecharDialogo(d);
      throw new Error(`O NotebookLM não deixou gerar agora (botão desativado). ${medidor ? `Uso atual ${medidor.usado}%, este item ~${medidor.estimado}%. ` : ""}Pode ser o limite de uso; veja notebook_uso.`);
    }
    // Último ponto antes de gastar: sem tempo para confirmar o pedido, não gera (no Desktop a chamada
    // seria cortada, o Claude pediria de novo e sairia um item em dobro).
    if (!prazo.sobra(20000)) {
      await fecharDialogo(d);
      throw new Error("O tempo desta chamada acabou antes de gerar: nada foi gerado nem gasto. Peça de novo.");
    }
    const criado = p.waitForResponse((r) => r.url().includes(`rpcids=${S.rpc.criarItem}`), { timeout: esperaAte(prazo, 30000) }).then((r) => r.text()).catch(() => "");
    await botao.click();
    let itemId = idDoItemCriado(await criado);
    for (let i = 0; !itemId && i < 8; i++) {
      await p.waitForTimeout(2000);
      itemId = (await itensDoEstudio(p, notebook)).find((x) => !antes.has(x.id))?.id ?? null;
    }
    if (!itemId) {
      const captura = await capturaDeErro(p, `estudio-${pedido.tipo}`);
      throw new Error(`Cliquei em gerar, mas o NotebookLM não confirmou o pedido. Captura da tela: ${captura}`);
    }
    registrar({ servico: "notebooklm", acao: "gerar", tipo: pedido.tipo, notebook, item: itemId, opcoes, medidor });
    progresso(`${NOMES_TIPO[pedido.tipo]} pedido; esperando ficar pronto…`);

    const lote: LoteEstudio = { lote: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), notebook, item: itemId, tipo: pedido.tipo, baixar: pedido.baixar, criadoEm: new Date().toISOString() };
    // Salvo já: se algo falhar daqui em diante, notebook_estudio_status ainda acha o item.
    alterarLotesEstudio((ls) => [...ls.filter((l) => l.item !== itemId), lote]);
    const [relatorio] = await acompanhar(p, notebook, [lote], prazo, progresso);
    atualizarLotes([relatorio]);
    const usoDepois = prazo.sobra(5000) ? await lerUso(p).catch(() => undefined) : undefined;
    return { notebook, tipo: pedido.tipo, opcoes, medidor, usoDepois, avisos, relatorio };
  });
}

