import type { Page } from "playwright";
import {
  abrir, abrirNotebook, acharPorNome, chamarRpc, comNotebook, CTX, fecharAvisos, lerLista, lerUso, UUID,
  type Notebook, type Uso,
} from "./notebook-base.js";
import { fontesDoNotebook } from "./notebook-fontes.js";
import { citacoesDaUltima, type Citacao } from "./notebook-conversa.js";
import { NOTEBOOK as S, OPCOES_ESTUDIO } from "./seletores.js";
import type { Prazo } from "./prazo.js";

export type { Notebook } from "./notebook-base.js";

// Notebooks (listar, criar, renomear, excluir, configurar o chat), perguntas, notas e uso da IA.

async function definirTitulo(pagina: Page, titulo: string): Promise<void> {
  const campo = pagina.locator(S.titulo);
  await campo.fill(titulo);
  await campo.press("Enter");
  await pagina.waitForTimeout(1500);
}

export function listarNotebooks(prazo: Prazo): Promise<Notebook[]> {
  return comNotebook(prazo, lerLista);
}

export function criarNotebook(prazo: Prazo, titulo?: string): Promise<Notebook> {
  return comNotebook(prazo, async (pagina) => {
    await abrir(pagina, S.url);
    await pagina.getByRole("button", { name: S.botaoNovo }).click();
    // A URL passa por um endereço provisório antes de ganhar o id definitivo.
    await pagina.waitForURL(new RegExp(`/notebook/${UUID.source}`, "i"), { timeout: 30000 });
    const id = pagina.url().match(UUID)?.[0] ?? "";
    await fecharAvisos(pagina);
    // O notebook novo abre com o diálogo de fontes por cima do título.
    if (await pagina.locator(S.dialogo).count()) await pagina.keyboard.press("Escape");
    if (titulo) await definirTitulo(pagina, titulo);
    return { id, titulo: titulo ?? "Notebook sem título", detalhes: S.urlNotebook(id) };
  });
}

export function renomearNotebook(prazo: Prazo, notebook: string, titulo: string): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const antigo = await pagina.locator(S.titulo).inputValue();
    await definirTitulo(pagina, titulo);
    const novo = (await fontesDoNotebook(pagina, id)).titulo;
    return novo === titulo ? `Notebook renomeado: "${antigo}" → "${titulo}".` : `Pedi para renomear "${antigo}", mas o título agora é "${novo}".`;
  });
}

export function excluirNotebook(prazo: Prazo, notebook: string): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    // Uma leitura só da lista: resolve o nome e confere se o notebook é seu.
    const lista = await lerLista(pagina);
    const id = notebook.match(UUID)?.[0] ?? acharPorNome(lista, notebook, (x) => x.id, (x) => x.titulo, "Notebook").id;
    const alvo = lista.find((x) => x.id === id);
    if (!alvo) throw new Error("Esse notebook não está na sua lista (só dá para excluir notebooks seus).");
    if (!/Proprietário|Owner/i.test(alvo.detalhes)) throw new Error(`Você não é o dono de "${alvo.titulo}" (${alvo.detalhes}); só o dono pode excluir.`);
    const linha = pagina.locator(S.linha).filter({ has: pagina.locator(`a[href$="${id}"]`) });
    await linha.getByRole("button", { name: S.menuAcoesNotebook }).click();
    await pagina.getByRole("menuitem", { name: S.menuExcluir }).click();
    await pagina.locator(S.dialogo).last().getByRole("button", { name: S.botaoExcluir, exact: true }).click();
    for (let i = 0; i < 10; i++) {
      await pagina.waitForTimeout(800);
      if (!(await pagina.locator(`a[href$="${id}"]`).count())) return `Notebook excluído: "${alvo.titulo}" (${id}).`;
    }
    return `Pedi para excluir "${alvo.titulo}", mas ele ainda aparece na lista. Confira com notebook_listar.`;
  });
}

export interface ConfigChat {
  objetivo?: keyof typeof OPCOES_ESTUDIO.objetivoChat;
  instrucoes?: string;
  tamanho?: keyof typeof OPCOES_ESTUDIO.tamanhoChat;
}

export function configurarChat(prazo: Prazo, notebook: string, config: ConfigChat): Promise<string> {
  if (config.instrucoes && config.objetivo && config.objetivo !== "personalizado") throw new Error("Instruções só valem com objetivo = personalizado.");
  const objetivo = config.instrucoes ? "personalizado" : config.objetivo;
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    await pagina.getByRole("button", { name: S.configNotebook }).click();
    await pagina.getByRole("menuitem", { name: S.menuConfigurarConversas }).click();
    const d = pagina.locator(S.dialogo).last();
    await d.getByRole("radiogroup", { name: S.grupoObjetivo }).waitFor({ timeout: 10000 });
    const feito: string[] = [];
    if (objetivo) {
      await d.getByRole("radiogroup", { name: S.grupoObjetivo }).getByText(OPCOES_ESTUDIO.objetivoChat[objetivo], { exact: true }).click();
      feito.push(`objetivo: ${OPCOES_ESTUDIO.objetivoChat[objetivo]}`);
    }
    if (config.instrucoes) {
      await d.getByRole("textbox", { name: S.campoComandoPersonalizado }).fill(config.instrucoes);
      feito.push("instruções personalizadas");
    }
    if (config.tamanho) {
      await d.getByRole("radiogroup", { name: S.grupoTamanho }).getByText(OPCOES_ESTUDIO.tamanhoChat[config.tamanho], { exact: true }).click();
      feito.push(`respostas: ${OPCOES_ESTUDIO.tamanhoChat[config.tamanho]}`);
    }
    const salvar = d.getByRole("button", { name: S.salvarConfigConversa });
    if (await salvar.isDisabled()) {
      await d.getByRole("button", { name: S.fecharConfigConversa }).click();
      if (objetivo === "personalizado" && !config.instrucoes) throw new Error("O objetivo personalizado precisa de instruções (parâmetro instrucoes).");
      return `Nada mudou: o chat do notebook ${id} já estava assim.`;
    }
    await salvar.click();
    await pagina.waitForTimeout(1500);
    return `Chat do notebook ${id} configurado (${feito.join(", ")}). Vale para as próximas perguntas.`;
  });
}

// ---------- Perguntas ----------

export interface Resposta {
  texto: string;
  citacoes: string[];
  /** true quando o prazo acabou antes de a resposta terminar (ela continua sendo gerada no Google). */
  pendente: boolean;
  id: string;
  nota?: boolean;
  /** A pergunta a que a resposta se refere (em notebook_resposta). */
  pergunta?: string;
  /** O trecho exato da fonte de cada [n] (lido do histórico do chat). */
  trechos?: Citacao[];
}

/** Trechos das citações da resposta que acabou de ser lida (sem tempo ou sem histórico: fica sem). */
async function trechosDaResposta(pagina: Page, id: string, pergunta: string, prazo: Prazo): Promise<Citacao[] | undefined> {
  if (!pergunta || !prazo.sobra(6000)) return undefined;
  return citacoesDaUltima(pagina, id, pergunta).catch(() => undefined);
}

/** Lê a última resposta do chat, sem o "pensamento", trocando os marcadores por [n]. */
async function lerUltimaResposta(pagina: Page): Promise<Omit<Resposta, "pendente" | "id">> {
  return pagina.locator(S.resposta).last().evaluate((el, s) => {
    const copia = el.cloneNode(true) as HTMLElement;
    copia.querySelectorAll(s.pensamento).forEach((e) => e.remove());
    const citacoes = new Map<string, string>();
    copia.querySelectorAll(s.citacao).forEach((marcador) => {
      // aria-label tem o formato "1: Título da fonte"
      const rotulo = marcador.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "";
      const [num, ...resto] = rotulo.split(":");
      const n = num.trim() || (marcador.textContent ?? "").trim();
      if (resto.length) citacoes.set(n, resto.join(":").trim());
      marcador.replaceWith(` [${n}]`);
    });
    // innerText só respeita quebras de linha em elementos que estão na página.
    copia.style.cssText = "position:fixed;left:-99999px;top:0;width:800px";
    document.body.appendChild(copia);
    const texto = copia.innerText.replace(/\n{3,}/g, "\n\n").trim();
    copia.remove();
    return {
      texto,
      citacoes: [...citacoes].map(([n, titulo]) => `[${n}] ${titulo}`),
    };
  }, { pensamento: S.pensamento, citacao: S.citacao });
}

/** Espera a última resposta do chat ficar pronta (até o prazo). */
/**
 * Espera a resposta à ÚLTIMA pergunta do usuário ficar pronta (até o prazo). A resposta precisa vir
 * depois da última mensagem do usuário no chat: assim uma resposta antiga nunca é confundida com a
 * nova, mesmo que o histórico demore a carregar.
 */
async function esperarResposta(pagina: Page, prazo: Prazo): Promise<boolean> {
  return pagina
    .waitForFunction(
      ([chat, usuario, resposta, pronta]) => {
        const msgs = [...document.querySelectorAll(chat as string)];
        let ultimaPergunta = -1;
        msgs.forEach((m, i) => {
          if (m.querySelector(usuario as string)) ultimaPergunta = i;
        });
        const depois = msgs.slice(ultimaPergunta + 1).filter((m) => m.querySelector(resposta as string));
        const r = depois[depois.length - 1];
        return !!r && !!r.querySelector(pronta as string);
      },
      [S.mensagemChat, S.mensagemUsuario, S.resposta, S.respostaPronta] as const,
      { timeout: Math.min(180000, Math.max(3000, prazo.restante() - 3000)) },
    )
    .then(() => true, () => false);
}

/** Texto da última pergunta do usuário no chat (para conferir que a resposta é dela). */
async function ultimaPergunta(pagina: Page): Promise<string> {
  const msgs = pagina.locator(`${S.mensagemChat} ${S.mensagemUsuario}`);
  return (await msgs.count()) ? (await msgs.last().innerText()).replace(/\s+/g, " ").trim() : "";
}

async function salvarUltimaComoNota(pagina: Page): Promise<boolean> {
  const botao = pagina.locator("chat-message").last().getByRole("button", { name: S.salvarRespostaNota });
  if (!(await botao.count())) return false;
  await botao.click();
  await pagina.waitForTimeout(1500);
  return true;
}

/**
 * Marca só as fontes pedidas no painel (as caixinhas valem para o chat). Devolve o estado
 * original (título → marcada) para restaurar depois.
 */
async function marcarFontes(pagina: Page, id: string, nomes: string[]): Promise<Map<string, boolean>> {
  const { fontes } = await fontesDoNotebook(pagina, id);
  const escolhidas = nomes.map((n) => acharPorNome(fontes, n, (f) => f.id, (f) => f.titulo, "Fonte"));
  const repetidos = fontes.filter((f, i) => fontes.findIndex((x) => x.titulo === f.titulo) !== i).map((f) => f.titulo);
  if (repetidos.length) throw new Error(`Há fontes com o mesmo nome (${[...new Set(repetidos)].map((t) => `"${t}"`).join(", ")}); renomeie com notebook_fonte_renomear antes de escolher fontes. Nada foi perguntado.`);
  const original = new Map<string, boolean>();
  for (const f of fontes) {
    const caixa = pagina.getByRole("checkbox", { name: `${S.marcarFonte}${f.titulo}`, exact: true });
    if (!(await caixa.count())) continue;
    const marcada = await caixa.isChecked();
    original.set(f.titulo, marcada);
    const quer = escolhidas.some((e) => e.id === f.id);
    if (marcada !== quer) await caixa.click({ force: true });
  }
  return original;
}

/** Volta as caixinhas das fontes ao estado de antes (nunca deixa o notebook com outra seleção). */
async function restaurarFontes(pagina: Page, original: Map<string, boolean>): Promise<void> {
  for (const [titulo, marcada] of original) {
    const caixa = pagina.getByRole("checkbox", { name: `${S.marcarFonte}${titulo}`, exact: true });
    if ((await caixa.count()) && (await caixa.isChecked()) !== marcada) await caixa.click({ force: true }).catch(() => {});
  }
}

export function perguntar(prazo: Prazo, notebook: string, pergunta: string, opcoes: { fontes?: string[]; salvarNota?: boolean } = {}): Promise<Resposta> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const caixa = pagina.getByRole("textbox", { name: S.caixaPergunta });
    const perguntasNaTela = pagina.locator(`${S.mensagemChat} ${S.mensagemUsuario}`);
    // Dá um instante para o histórico do chat aparecer antes de contar as perguntas antigas.
    await pagina.locator(S.mensagemChat).first().waitFor({ timeout: 2500 }).catch(() => {});
    const antes = await perguntasNaTela.count();
    const original = opcoes.fontes?.length ? await marcarFontes(pagina, id, opcoes.fontes) : undefined;
    try {
      await caixa.fill(pergunta);
      await caixa.press("Enter");
      // Confere que a pergunta saiu (caixa desativada ou nenhuma fonte marcada fariam ela não sair).
      const inicio = pergunta.replace(/\s+/g, " ").trim().slice(0, 40);
      const saiu = await pagina
        .waitForFunction(
          ([sel, n, txt]) => {
            const m = document.querySelectorAll(sel as string);
            return m.length > (n as number) || (m.length > 0 && (m[m.length - 1].textContent ?? "").replace(/\s+/g, " ").includes(txt as string));
          },
          [`${S.mensagemChat} ${S.mensagemUsuario}`, antes, inicio] as const,
          { timeout: 10000 },
        )
        .then(() => true, () => false);
      if (!saiu) {
        throw new Error("A pergunta não foi enviada ao NotebookLM (confira se há fontes marcadas e se alguma ainda está sendo processada). Nada foi perguntado.");
      }
    } finally {
      // A pergunta já saiu com as fontes escolhidas; devolve a seleção do notebook como estava.
      if (original) await restaurarFontes(pagina, original);
    }

    // Se o prazo acabar, a resposta continua sendo gerada no Google (testado em 06/10/2026)
    // e pode ser lida depois com notebook_resposta.
    if (!(await esperarResposta(pagina, prazo))) return { texto: "", citacoes: [], pendente: true, id };
    const r = await lerUltimaResposta(pagina);
    const trechos = r.citacoes.length ? await trechosDaResposta(pagina, id, pergunta, prazo) : undefined;
    const nota = opcoes.salvarNota ? await salvarUltimaComoNota(pagina) : undefined;
    return { ...r, pendente: false, id, nota, trechos };
  });
}

/** Lê a última resposta do chat do notebook, esperando terminar se ainda estiver sendo gerada. */
export function ultimaResposta(prazo: Prazo, notebook: string, salvarNota = false): Promise<Resposta> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    // O histórico do chat carrega um pouco depois da página.
    const temChat = await pagina.locator(`${S.mensagemChat} ${S.mensagemUsuario}`).first().waitFor({ timeout: 6000 }).then(() => true, () => false);
    if (!temChat) throw new Error("O chat deste notebook não tem perguntas.");
    const pergunta = await ultimaPergunta(pagina);
    if (!(await esperarResposta(pagina, prazo))) return { texto: "", citacoes: [], pendente: true, id, pergunta };
    const r = await lerUltimaResposta(pagina);
    const trechos = r.citacoes.length ? await trechosDaResposta(pagina, id, pergunta, prazo) : undefined;
    const nota = salvarNota ? await salvarUltimaComoNota(pagina) : undefined;
    return { ...r, pendente: false, id, nota, pergunta, trechos };
  });
}

// ---------- Notas ----------

export interface Nota {
  id: string;
  titulo: string;
  texto: string;
}

async function notasDoNotebook(pagina: Page, id: string): Promise<Nota[]> {
  const dados = await chamarRpc<unknown[]>(pagina, S.rpc.notas, [id, null, null, CTX]);
  return ((dados?.[0] ?? []) as unknown[][])
    .map((n) => (n[1] ?? []) as unknown[])
    .filter((n) => typeof n[0] === "string")
    .map((n) => ({ id: String(n[0]), titulo: String(n[4] ?? ""), texto: String(n[1] ?? "") }));
}

export function listarNotas(prazo: Prazo, notebook: string): Promise<{ id: string; notas: Nota[] }> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    return { id, notas: await notasDoNotebook(pagina, id) };
  });
}

export function criarNota(prazo: Prazo, notebook: string, titulo: string, texto: string, virarFonte: boolean): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const antes = new Set((await notasDoNotebook(pagina, id)).map((n) => n.id));
    await pagina.getByRole("button", { name: S.botaoAdicionarNota }).click();
    const campoTitulo = pagina.getByRole("textbox", { name: S.tituloNota });
    await campoTitulo.waitFor({ timeout: 10000 });
    await campoTitulo.fill(titulo);
    await campoTitulo.press("Enter");
    const editor = pagina.locator(S.editorNota).last();
    await editor.click();
    await pagina.keyboard.insertText(texto);
    // A nota salva sozinha alguns instantes depois de parar de digitar.
    let nova: Nota | undefined;
    for (let i = 0; i < 15 && !nova?.texto; i++) {
      await pagina.waitForTimeout(1000);
      nova = (await notasDoNotebook(pagina, id)).find((n) => !antes.has(n.id));
    }
    let extra = "";
    if (virarFonte) {
      const fontesAntes = (await fontesDoNotebook(pagina, id)).fontes.length;
      await pagina.getByRole("button", { name: S.converterEmFonte }).click();
      for (let i = 0; i < 20; i++) {
        await pagina.waitForTimeout(1000);
        if ((await fontesDoNotebook(pagina, id)).fontes.length > fontesAntes) {
          extra = " e convertida em fonte";
          break;
        }
      }
      if (!extra) extra = " (pedi para converter em fonte; confira com notebook_fontes)";
    }
    const fechar = pagina.getByRole("button", { name: S.fecharNota });
    if (await fechar.count()) await fechar.click().catch(() => {});
    if (!nova) return `Criei a nota "${titulo}", mas ainda não consegui confirmar que foi salva. Confira com notebook_notas.`;
    return `Nota "${titulo}" salva no notebook ${id}${extra} (id ${nova.id}).`;
  });
}

export function excluirNota(prazo: Prazo, notebook: string, busca: string): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const notas = await notasDoNotebook(pagina, id);
    if (!notas.length) throw new Error("Este notebook não tem notas.");
    const nota = acharPorNome(notas, busca, (n) => n.id, (n) => n.titulo, "Nota");
    const linha = pagina.locator(S.itemNota(nota.id));
    await linha.waitFor({ timeout: 15000 });
    await linha.hover();
    await linha.getByRole("button", { name: "Mais", exact: true }).click({ force: true });
    await pagina.getByRole("menuitem", { name: S.menuExcluir }).click();
    await pagina.locator(S.dialogo).last().getByRole("button", { name: S.botaoExcluir, exact: true }).click();
    for (let i = 0; i < 10; i++) {
      await pagina.waitForTimeout(800);
      if (!(await notasDoNotebook(pagina, id)).some((n) => n.id === nota.id)) return `Nota excluída: "${nota.titulo}".`;
    }
    return `Pedi para excluir a nota "${nota.titulo}", mas ela ainda aparece. Confira com notebook_notas.`;
  });
}

// ---------- Uso e diagnóstico ----------

export function usoNotebook(prazo: Prazo): Promise<Uso> {
  return comNotebook(prazo, async (pagina) => {
    await abrir(pagina, S.url);
    await pagina.locator(S.carregado).first().waitFor();
    return lerUso(pagina);
  });
}

/** Confere se a página inicial, a lista de notebooks e o medidor de uso funcionam. */
export function diagnosticarNotebook(prazo: Prazo): Promise<string[]> {
  return comNotebook(prazo, async (pagina) => {
    const lista = await lerLista(pagina);
    const linhas = [`OK - NotebookLM abre e lista ${lista.length} notebooks`];
    try {
      const uso = await lerUso(pagina);
      linhas.push(`OK - medidor de uso: ${uso.janela ? `${uso.janela.usado}% do limite atual` : "?"}${uso.semana ? `, ${uso.semana.usado}% do semanal` : ""}`);
    } catch (e) {
      linhas.push(`FALHA - leitura interna do NotebookLM (uso): ${(e as Error).message}`);
    }
    return linhas;
  });
}
