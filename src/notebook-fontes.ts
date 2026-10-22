import type { Page } from "playwright";
import path from "node:path";
import {
  abrirNotebook, acharPorNome, chamarRpc, comNotebook, CTX, esperaAte, limitarTexto, textoDosSegmentos, type Progresso,
} from "./notebook-base.js";
import { NOTEBOOK as S } from "./seletores.js";
import { validarArquivoFonte } from "./seguranca.js";
import type { Prazo } from "./prazo.js";

// Fontes de um notebook: listar, adicionar (link, YouTube, texto, arquivo do PC, Google Drive),
// ler, renomear e remover. A pesquisa na web fica em notebook-pesquisa.ts.

export interface Fonte {
  id: string;
  titulo: string;
  tipo: string;
  /** 2 = pronta; 1 e 5 = processando; outros valores = erro ao processar. */
  status: number;
  palavras?: number;
  url?: string;
}

// Código do tipo de fonte no registro do Google (meta[4]). Mapeado em 06/10/2026.
const TIPOS_FONTE: Record<number, string> = { 1: "Google Docs", 2: "Google Slides", 3: "PDF", 4: "arquivo", 5: "site", 8: "texto colado", 9: "YouTube", 10: "áudio", 13: "imagem", 14: "Google Sheets" };

function lerFonte(f: unknown[]): Fonte {
  const meta = (f[2] ?? []) as unknown[];
  const codigo = typeof meta[4] === "number" ? meta[4] : 0;
  const url = Array.isArray(meta[7]) && typeof meta[7][0] === "string" ? meta[7][0] : undefined;
  const mime = typeof meta[19] === "string" ? meta[19] : undefined;
  let tipo = TIPOS_FONTE[codigo] ?? `tipo ${codigo}`;
  if (url && /youtube\.com|youtu\.be/.test(url)) tipo = "YouTube";
  else if (codigo === 4) tipo = mime ? `arquivo ${mime}` : "texto colado";
  return {
    id: String((f[0] as unknown[])?.[0] ?? ""),
    titulo: String(f[1] ?? ""),
    tipo,
    status: Number((f[3] as unknown[])?.[1] ?? 0),
    palavras: typeof meta[1] === "number" ? meta[1] : undefined,
    url,
  };
}

export async function fontesDoNotebook(pagina: Page, id: string): Promise<{ titulo: string; fontes: Fonte[] }> {
  const dados = await chamarRpc<unknown[][]>(pagina, S.rpc.notebook, [id, null, CTX, null, 1, [[null, null, []]]]);
  const nb = (dados?.[0] ?? []) as unknown[];
  return { titulo: String(nb[0] ?? ""), fontes: ((nb[1] ?? []) as unknown[][]).map(lerFonte) };
}

const PROCESSANDO = new Set([1, 5]);
export const processando = (f: Fonte) => PROCESSANDO.has(f.status);
export const estadoDaFonte = (f: Fonte) => (f.status === 2 ? "pronta" : processando(f) ? "processando" : `erro (código ${f.status})`);

export function descreverFonte(f: Fonte, n?: number): string {
  const extras = [f.tipo, f.palavras ? `${f.palavras} palavras` : "", f.status === 2 ? "" : estadoDaFonte(f), f.url ?? ""].filter(Boolean);
  return `${n !== undefined ? `${n}. ` : "- "}${f.titulo} (${extras.join(" · ")})`;
}

export function listarFontes(prazo: Prazo, notebook: string): Promise<{ id: string; titulo: string; fontes: Fonte[] }> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    return { id, ...(await fontesDoNotebook(pagina, id)) };
  });
}

/**
 * Espera as fontes novas aparecerem e terminarem de ser processadas (até o prazo). Depois do
 * envio a fonte já está no Google: se o prazo acabar, o processamento continua lá.
 */
export async function esperarFontesNovas(pagina: Page, id: string, antes: Set<string>, quantas: number, prazo: Prazo, progresso: Progresso): Promise<{ novas: Fonte[]; todas: Fonte[]; completo: boolean }> {
  const limite = Date.now() + esperaAte(prazo, 180000);
  let ultimo: Fonte[] = [];
  let novas: Fonte[] = [];
  while (Date.now() < limite) {
    ultimo = (await fontesDoNotebook(pagina, id)).fontes;
    novas = ultimo.filter((f) => !antes.has(f.id));
    if (novas.length >= quantas && !novas.some(processando)) return { novas, todas: ultimo, completo: true };
    progresso(`Processando fontes (${novas.filter((f) => !processando(f)).length}/${quantas})…`);
    await pagina.waitForTimeout(2500);
  }
  return { novas, todas: ultimo, completo: false };
}

async function abrirDialogoFontes(pagina: Page): Promise<ReturnType<Page["locator"]>> {
  const dialogo = pagina.locator(S.dialogo).last();
  if (!(await dialogo.getByRole("button", { name: S.botaoSites }).isVisible().catch(() => false))) {
    await pagina.getByRole("button", { name: S.botaoAdicionarFonte }).click();
    await dialogo.getByRole("button", { name: S.botaoSites }).waitFor({ timeout: 10000 });
  }
  return dialogo;
}

/** Escolhe arquivos no seletor do Google Drive (busca pelo nome ou pelo link colado). */
async function escolherNoDrive(pagina: Page, busca: string): Promise<string> {
  const picker = await (async () => {
    for (let i = 0; i < 30; i++) {
      const f = pagina.frames().find((fr) => fr.url().startsWith("https://docs.google.com/picker"));
      if (f) return f;
      await pagina.waitForTimeout(500);
    }
    throw new Error("O seletor do Google Drive não abriu.");
  })();
  const campo = picker.getByRole("combobox", { name: S.driveBusca }).or(picker.getByRole("textbox", { name: S.driveBusca })).first();
  await campo.waitFor({ timeout: 20000 });
  await campo.fill(busca);
  await campo.press("Enter");
  const opcoes = picker.getByRole("option");
  await opcoes.first().waitFor({ timeout: 20000 }).catch(() => {});
  const nomes = (await opcoes.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const fechar = async () => picker.getByRole("button", { name: S.driveFechar }).first().click({ timeout: 5000 }).catch(() => {});
  if (!nomes.length) {
    await fechar();
    throw new Error(`Nada encontrado no Google Drive para "${busca}".`);
  }
  const alvo = busca.trim().toLowerCase();
  let indice = nomes.findIndex((n) => n.toLowerCase() === alvo || n.toLowerCase().replace(/\.[a-z0-9]+$/, "") === alvo);
  if (indice < 0 && nomes.length === 1) indice = 0;
  if (indice < 0) {
    await fechar();
    throw new Error(`Vários arquivos no Drive combinam com "${busca}": ${nomes.slice(0, 10).map((n) => `"${n}"`).join(", ")}. Use o nome exato do arquivo ou o link dele.`);
  }
  await opcoes.nth(indice).click();
  await picker.getByRole("button", { name: S.driveInserir }).click({ timeout: 10000 });
  return nomes[indice];
}

export interface NovaFonte {
  urls?: string[];
  texto?: string;
  arquivos?: string[];
  drive?: string;
}

export function adicionarFonte(prazo: Prazo, notebook: string, fonte: NovaFonte, progresso: Progresso = () => {}): Promise<string> {
  const urls = (fonte.urls ?? []).map((u) => u.trim()).filter(Boolean);
  for (const u of urls) if (!/^https?:\/\//i.test(u)) throw new Error(`O link precisa começar com http:// ou https:// (recebi "${u}").`);
  const arquivos = (fonte.arquivos ?? []).map(validarArquivoFonte);
  const tipos = [urls.length > 0, !!fonte.texto, arquivos.length > 0, !!fonte.drive].filter(Boolean).length;
  if (tipos !== 1) throw new Error("Informe um tipo de fonte por vez: url, texto, arquivos ou drive.");

  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const antes = new Set((await fontesDoNotebook(pagina, id)).fontes.map((f) => f.id));
    const dialogo = await abrirDialogoFontes(pagina);
    let esperadas = 1;
    let descricao = "";

    if (urls.length) {
      await dialogo.getByRole("button", { name: S.botaoSites }).click();
      await pagina.getByRole("textbox", { name: S.campoUrls }).fill(urls.join("\n"));
      await pagina.locator(S.dialogo).last().getByRole("button", { name: S.botaoInserir }).click();
      esperadas = urls.length;
      descricao = urls.length === 1 ? "o link" : `${urls.length} links`;
    } else if (fonte.texto) {
      await dialogo.getByRole("button", { name: S.botaoTextoCopiado }).click();
      await pagina.getByRole("textbox", { name: S.campoTexto }).fill(fonte.texto);
      await pagina.locator(S.dialogo).last().getByRole("button", { name: S.botaoInserir }).click();
      descricao = "o texto";
    } else if (arquivos.length) {
      progresso(`Enviando ${arquivos.length} arquivo(s)…`);
      const [seletor] = await Promise.all([
        pagina.waitForEvent("filechooser", { timeout: 15000 }),
        dialogo.getByRole("button", { name: S.botaoEnviarArquivos }).click(),
      ]);
      await seletor.setFiles(arquivos);
      esperadas = arquivos.length;
      descricao = arquivos.map((a) => path.basename(a)).join(", ");
    } else if (fonte.drive) {
      await dialogo.getByRole("button", { name: S.botaoDrive }).click();
      descricao = `"${await escolherNoDrive(pagina, fonte.drive)}" do Google Drive`;
    }

    progresso("Fonte enviada; esperando o NotebookLM processar…");
    const r = await esperarFontesNovas(pagina, id, antes, esperadas, prazo, progresso);
    const linhas: string[] = [];
    if (!r.novas.length) {
      linhas.push(`Enviei ${descricao} ao notebook ${id}, mas ela ainda não apareceu. O NotebookLM pode estar processando; confira em instantes com notebook_fontes.`);
    } else {
      linhas.push(`Fontes novas no notebook ${id}:`, ...r.novas.map((f) => descreverFonte(f)));
      if (!r.completo) linhas.push("Algumas ainda estão sendo processadas no Google; confira com notebook_fontes.");
      const erros = r.novas.filter((f) => f.status !== 2 && !processando(f));
      if (erros.length) linhas.push(`Atenção: ${erros.length} fonte(s) com erro no processamento (o Google não conseguiu ler o conteúdo).`);
    }
    linhas.push(`Total de fontes: ${r.todas.length}.`);
    return linhas.join("\n");
  });
}

// ---------- Ler, renomear e remover ----------

async function acharFonte(pagina: Page, id: string, busca: string): Promise<Fonte> {
  const { fontes } = await fontesDoNotebook(pagina, id);
  if (!fontes.length) throw new Error("Este notebook não tem fontes.");
  const f = acharPorNome(fontes, busca, (x) => x.id, (x) => x.titulo, "Fonte");
  // Na tela as fontes só se distinguem pelo nome: com nome repetido, uma ação poderia cair na errada.
  if (fontes.filter((x) => x.titulo === f.titulo).length > 1) {
    throw new Error(`Há mais de uma fonte chamada "${f.titulo}". Renomeie uma delas no NotebookLM antes (pela tela não dá para saber qual é qual). Nada foi feito.`);
  }
  return f;
}

/** Linha da fonte no painel, pelo nome exato (abre grupos recolhidos, como "Conversas do Gemini"). */
async function linhaDaFonte(pagina: Page, f: Fonte) {
  const grupos = pagina.locator(S.grupoFontesFechado);
  for (let i = 0; i < 10 && (await grupos.count()); i++) {
    await grupos.first().click().catch(() => {});
    await pagina.waitForTimeout(500);
  }
  const linha = pagina.locator(S.fonte).filter({ has: pagina.getByLabel(f.titulo, { exact: true }) }).first();
  if (!(await linha.waitFor({ timeout: 8000 }).then(() => true, () => false))) throw new Error(`A fonte "${f.titulo}" não apareceu no painel do notebook.`);
  return linha;
}

/** Abre o menu "⋮" de uma fonte no painel (os botões só aparecem com o mouse em cima). */
async function menuDaFonte(pagina: Page, f: Fonte): Promise<void> {
  const linha = await linhaDaFonte(pagina, f);
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await linha.hover({ timeout: 5000 }).catch(() => {});
    await linha.getByRole("button", { name: S.fonteMais, exact: true }).click({ force: true });
    if (await pagina.getByRole("menu").first().waitFor({ timeout: 3000 }).then(() => true, () => false)) return;
    await pagina.keyboard.press("Escape");
  }
  throw new Error(`Não consegui abrir o menu da fonte "${f.titulo}".`);
}

export interface LeituraFonte {
  notebook: string;
  fonte: Fonte;
  guia?: string;
  topicos: string[];
  texto: string;
}

export function lerConteudoFonte(prazo: Prazo, notebook: string, busca: string, comGuia: boolean): Promise<LeituraFonte> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const f = await acharFonte(pagina, id, busca);
    const conteudo = await chamarRpc<unknown>(pagina, "hizoJc", [[f.id], [2], CTX]);
    // O conteúdo vem como segmentos de texto ([início, fim, [texto]]) depois dos metadados da fonte.
    const texto = textoDosSegmentos(conteudo).join("").trim();
    const leitura: LeituraFonte = { notebook: id, fonte: f, topicos: [], texto };
    if (comGuia && prazo.sobra(15000)) {
      // O guia (resumo + tópicos) só existe na tela da fonte e é gerado na primeira vez que ela abre.
      await (await linhaDaFonte(pagina, f)).locator(S.fonteClicavel).click();
      const resumo = pagina.locator(S.guiaResumo).first();
      await resumo.waitFor({ timeout: esperaAte(prazo, 20000) }).catch(() => {});
      leitura.guia = (await resumo.innerText().catch(() => "")).trim() || undefined;
      leitura.topicos = (await pagina.locator(S.guiaTopicos).allInnerTexts().catch(() => [])).map((t) => t.trim()).filter(Boolean);
    }
    return leitura;
  });
}

export function descreverLeitura(l: LeituraFonte, max: number): string {
  const partes = [descreverFonte(l.fonte)];
  if (l.guia) partes.push("", "Guia da fonte (resumo do NotebookLM):", l.guia);
  if (l.topicos.length) partes.push(`Tópicos: ${l.topicos.join(" · ")}`);
  partes.push("", `Conteúdo (${l.texto.length} caracteres):`, limitarTexto(l.texto, max) || "(sem texto extraído)");
  return partes.join("\n");
}

export function renomearFonte(prazo: Prazo, notebook: string, busca: string, novoNome: string): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const f = await acharFonte(pagina, id, busca);
    await menuDaFonte(pagina, f);
    await pagina.getByRole("menuitem", { name: S.menuRenomearFonte }).click();
    const dialogo = pagina.locator(S.dialogo).last();
    await dialogo.getByRole("textbox", { name: S.campoNomeFonte }).fill(novoNome);
    await dialogo.getByRole("button", { name: S.botaoSalvar, exact: true }).click();
    for (let i = 0; i < 10; i++) {
      await pagina.waitForTimeout(800);
      const nova = (await fontesDoNotebook(pagina, id)).fontes.find((x) => x.id === f.id);
      if (nova?.titulo === novoNome) return `Fonte renomeada: "${f.titulo}" → "${novoNome}".`;
    }
    return `Pedi para renomear "${f.titulo}" para "${novoNome}", mas o novo nome ainda não apareceu. Confira com notebook_fontes.`;
  });
}

export function removerFontes(prazo: Prazo, notebook: string, buscas: string[]): Promise<string> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    const alvos: Fonte[] = [];
    for (const b of buscas) {
      const f = await acharFonte(pagina, id, b);
      if (!alvos.some((x) => x.id === f.id)) alvos.push(f); // nome e id da mesma fonte contam uma vez
    }
    const removidas: Fonte[] = [];
    const falhas: string[] = [];
    for (const f of alvos) {
      if (!prazo.sobra(12000)) {
        falhas.push(`"${f.titulo}" (faltou tempo nesta chamada; peça de novo)`);
        continue;
      }
      try {
        await menuDaFonte(pagina, f);
        await pagina.getByRole("menuitem", { name: S.menuRemoverFonte }).click();
        const dialogo = pagina.locator(S.dialogo).last();
        await dialogo.getByRole("button", { name: S.botaoExcluir, exact: true }).click();
        // O diálogo some com animação; antes disso ele bloqueia o menu da próxima fonte.
        await dialogo.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
        let foi = false;
        for (let i = 0; i < 10 && !foi; i++) {
          await pagina.waitForTimeout(800);
          foi = !(await fontesDoNotebook(pagina, id)).fontes.some((x) => x.id === f.id);
        }
        if (foi) removidas.push(f);
        else falhas.push(`"${f.titulo}" (não confirmei a remoção)`);
      } catch (erro) {
        // Uma falha não esconde o que já foi removido antes dela.
        await pagina.keyboard.press("Escape").catch(() => {});
        falhas.push(`"${f.titulo}" (${(erro as Error).message.split("\n")[0]})`);
      }
    }
    const restantes = (await fontesDoNotebook(pagina, id)).fontes;
    return [
      removidas.length ? `Removidas do notebook ${id}: ${removidas.map((f) => `"${f.titulo}"`).join(", ")}.` : "Nenhuma fonte foi removida.",
      falhas.length ? `Não removidas: ${falhas.join("; ")}.` : "",
      `Fontes restantes: ${restantes.length}.`,
    ].filter(Boolean).join("\n");
  });
}
