import type { Locator, Page } from "playwright";
import { abrirNotebook, chamarRpc, comNotebook, CTX, lerLista, lerUso } from "./notebook-base.js";
import { fontesDoNotebook } from "./notebook-fontes.js";
import { itensDoEstudio } from "./notebook-estudio.js";
import { lerConversa } from "./notebook-conversa.js";
import { comPagina, irPara } from "./navegador.js";
import { DRIVE as D, ESTUDIO, NOTEBOOK as S } from "./seletores.js";
import { mensagemDeErro } from "./seguranca.js";
import type { Prazo } from "./prazo.js";

// Auto-diagnóstico das telas: confere, sem gerar nem mudar nada, cada botão, menu e leitura interna
// que o MCP usa. Quando o Google muda a tela, diz QUAL item mudou e onde ele está em src/seletores.ts.

export class Checagens {
  linhas: string[] = [];
  falhas: string[] = [];

  constructor(private parte: string) {}

  marcar(ok: boolean, nome: string, onde: string, detalhe = ""): void {
    this.linhas.push(`${ok ? "OK" : "FALHA"} - ${this.parte}: ${nome}${detalhe ? ` (${detalhe})` : ""}${ok ? "" : ` → ${onde}`}`);
    if (!ok) this.falhas.push(`${this.parte}: ${nome} (${onde})`);
  }

  /** Roda um teste; erro ou false = FALHA. Um texto devolvido vira o detalhe da linha. */
  async conferir(nome: string, onde: string, teste: () => Promise<boolean | string>): Promise<boolean> {
    try {
      const r = await teste();
      this.marcar(r !== false, nome, onde, typeof r === "string" ? r : "");
      return r !== false;
    } catch (erro) {
      this.marcar(false, nome, onde, mensagemDeErro(erro).split("\n")[0].slice(0, 160));
      return false;
    }
  }
}

const visivel = (l: Locator, ms = 5000) => l.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);

async function fecharTudo(p: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await p.keyboard.press("Escape").catch(() => {});
    await p.waitForTimeout(300);
  }
}

/** NotebookLM: página inicial, um notebook (o pedido ou o primeiro seu), chat, Estúdio e leituras internas. */
export function diagnosticarTelasNotebook(prazo: Prazo, notebook?: string): Promise<Checagens> {
  return comNotebook(prazo, async (p) => {
    const c = new Checagens("NotebookLM");
    const lista = await lerLista(p).catch(() => []);
    c.marcar(lista.length > 0, "lista de notebooks na página inicial", "NOTEBOOK.linha / linhaLink / botaoModoLista", `${lista.length} notebooks`);
    await c.conferir("botão Novo notebook", "NOTEBOOK.botaoNovo", () => visivel(p.getByRole("button", { name: S.botaoNovo })));
    const alvo = notebook ?? lista.find((n) => /Proprietário|Owner/i.test(n.detalhes) && !/\b0 fontes?\b/.test(n.detalhes))?.id ?? lista[0]?.id;
    if (!alvo) return c;
    let id = "";
    if (!(await c.conferir("abrir um notebook (caixa de pergunta do chat)", "NOTEBOOK.caixaPergunta", async () => ((id = await abrirNotebook(p, alvo)), true)))) return c;

    // Leituras internas (as mesmas chamadas que a tela faz).
    let temFontes = false;
    await c.conferir("leitura do notebook e das fontes (rLM1Ne)", "NOTEBOOK.rpc.notebook", async () => {
      const f = await fontesDoNotebook(p, id);
      temFontes = f.fontes.length > 0;
      return f.titulo ? `"${f.titulo}", ${f.fontes.length} fontes` : false;
    });
    let temItens = false;
    await c.conferir("leitura do Estúdio (gArtLc)", "NOTEBOOK.rpc.estudio", async () => {
      const itens = await itensDoEstudio(p, id);
      temItens = itens.length > 0;
      return `${itens.length} itens${itens.some((i) => i.tipo === "desconhecido") ? "; há tipo desconhecido" : ""}`;
    });
    await c.conferir("leitura das notas (cFji9)", "NOTEBOOK.rpc.notas", async () => Array.isArray(await chamarRpc(p, S.rpc.notas, [id, null, null, CTX])) || "sem notas");
    await c.conferir("medidor de uso da IA (EylDcb)", "NOTEBOOK.rpc.uso", async () => {
      const u = await lerUso(p);
      return u.janela ? `${u.janela.usado}% do limite atual` : false;
    });
    let trocas = 0;
    let citacoes = 0;
    await c.conferir("histórico do chat com trechos das citações (hPTbtc/khqZz)", "NOTEBOOK.rpc.conversas / mensagens", async () => {
      const conv = await lerConversa(p, id, 6);
      trocas = conv.trocas.length;
      citacoes = conv.trocas.reduce((s, t) => s + t.citacoes.length, 0);
      const semTrecho = conv.trocas.flatMap((t) => t.citacoes).filter((x) => !x.trecho).length;
      return semTrecho ? false : `${trocas} perguntas recentes, ${citacoes} citações com trecho`;
    });

    // Tela do notebook.
    await c.conferir("título editável", "NOTEBOOK.titulo", () => visivel(p.locator(S.titulo)));
    await c.conferir("botão Adicionar fonte", "NOTEBOOK.botaoAdicionarFonte", () => visivel(p.getByRole("button", { name: S.botaoAdicionarFonte })));
    if (temFontes) await c.conferir("caixinha Selecionar todas as fontes", "NOTEBOOK.marcarTodasFontes", () => visivel(p.getByRole("checkbox", { name: S.marcarTodasFontes })));
    await c.conferir("campo de pesquisa de fontes na web", "NOTEBOOK.campoPesquisa", () => visivel(p.getByRole("textbox", { name: S.campoPesquisa })));
    await c.conferir("botão Adicionar nota", "NOTEBOOK.botaoAdicionarNota", () => visivel(p.getByRole("button", { name: S.botaoAdicionarNota })));
    const faltando: string[] = [];
    for (const e of Object.values(ESTUDIO)) if (!(await visivel(p.locator(S.botaoEstudio(e.rotulo)), 2000))) faltando.push(e.rotulo);
    c.marcar(!faltando.length, "os 9 botões do Estúdio", "ESTUDIO[tipo].rotulo / NOTEBOOK.botaoEstudio", faltando.length ? `faltam: ${faltando.join(", ")}` : "");

    if (trocas) {
      await c.conferir("mensagens do chat na tela", "NOTEBOOK.mensagemChat / mensagemUsuario / resposta", () => visivel(p.locator(`${S.mensagemChat} ${S.mensagemUsuario}`)));
      // Fica escondido até passar o mouse; o MCP só confere se ele existe (esperarResposta).
      await c.conferir("botão que marca resposta pronta (Salvar em nota)", "NOTEBOOK.respostaPronta", async () => (await p.locator(S.respostaPronta).count()) > 0);
      if (citacoes) await c.conferir("marcadores de citação [n]", "NOTEBOOK.citacao", async () => (await p.locator(S.citacao).count()) > 0);
    }

    // Menus e diálogos (abre e fecha, sem mudar nada).
    await c.conferir("menu Configuração do notebook → Configurar as conversas", "NOTEBOOK.configNotebook / menuConfigurarConversas", async () => {
      await p.getByRole("button", { name: S.configNotebook }).click({ timeout: 5000 });
      const ok = await visivel(p.getByRole("menuitem", { name: S.menuConfigurarConversas }), 4000);
      await fecharTudo(p);
      return ok;
    });
    await c.conferir("diálogo Adicionar fonte (arquivos, sites, texto, Drive)", "NOTEBOOK.botaoEnviarArquivos / botaoSites / botaoTextoCopiado / botaoDrive", async () => {
      await p.getByRole("button", { name: S.botaoAdicionarFonte }).click({ timeout: 5000 });
      const d = p.locator(S.dialogo).last();
      const faltam: string[] = [];
      if (!(await visivel(d.getByRole("button", { name: S.botaoEnviarArquivos }), 6000))) faltam.push("Enviar arquivos");
      if (!(await visivel(d.getByRole("button", { name: S.botaoSites }), 2000))) faltam.push("Sites");
      if (!(await visivel(d.getByRole("button", { name: S.botaoTextoCopiado }), 2000))) faltam.push("Texto copiado");
      if (!(await visivel(d.getByRole("button", { name: S.botaoDrive }), 2000))) faltam.push("Drive");
      await fecharTudo(p);
      if (faltam.length) throw new Error(`faltam: ${faltam.join(", ")}`);
      return true;
    });
    await c.conferir("diálogo do Estúdio (Tabela de dados: medidor de uso e botão de gerar; não gera nada)", "NOTEBOOK.gerarAgora / medidorUsado", async () => {
      await p.locator(S.botaoEstudio(ESTUDIO.tabela.rotulo)).first().click({ timeout: 5000 });
      const d = p.locator(S.dialogo).last();
      const gerar = await visivel(d.getByRole("button", { name: S.gerarAgora }), 6000);
      const medidor = await visivel(d.locator(S.medidorUsado), 3000);
      const fechar = d.getByRole("button", { name: S.fecharDialogo }).first();
      if (await fechar.isVisible().catch(() => false)) await fechar.click().catch(() => {});
      await fecharTudo(p);
      return gerar && medidor ? true : gerar ? "sem o medidor de uso" : false;
    });
    if (temItens) {
      await c.conferir("menu ⋮ de um item do Estúdio (Renomear, Excluir)", "NOTEBOOK.itemEstudio / menuRenomear / menuExcluir", async () => {
        const item = (await itensDoEstudio(p, id))[0];
        const linha = p.locator(S.itemEstudio(item.id));
        await linha.waitFor({ timeout: 8000 });
        await linha.hover();
        await linha.getByRole("button", { name: "Mais", exact: true }).click({ force: true, timeout: 5000 });
        const ok = (await visivel(p.getByRole("menuitem", { name: S.menuRenomear, exact: true }), 4000)) && (await visivel(p.getByRole("menuitem", { name: S.menuExcluir }), 2000));
        await fecharTudo(p);
        return ok;
      });
    }
    return c;
  });
}

/** Google Drive (usado para levar slides ao Apresentações): botão Novo → Upload de arquivo. */
export function diagnosticarTelasDrive(prazo: Prazo): Promise<Checagens> {
  return comPagina(async (p) => {
    const c = new Checagens("Drive");
    await irPara(p, D.url);
    const novo = p.getByRole("button", { name: D.botaoNovo });
    if (!(await c.conferir("botão Novo do Google Drive", "DRIVE.botaoNovo", () => visivel(novo, 20000)))) return c;
    await c.conferir("menu Novo → Upload de arquivo (não envia nada)", "DRIVE.menuUpload", async () => {
      await novo.first().click();
      const ok = await visivel(p.getByRole("menuitem", { name: D.menuUpload }), 5000);
      await fecharTudo(p);
      return ok;
    });
    return c;
  }, prazo);
}
