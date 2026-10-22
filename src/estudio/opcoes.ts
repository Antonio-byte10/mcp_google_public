import { ESTUDIO, GRUPOS_ESTUDIO, NOTEBOOK as S, OPCOES_ESTUDIO, type TipoEstudio } from "../seletores.js";
import type { FormatoBaixar } from "./tipos.js";
import type { Locator } from "playwright";
import { acharPorNome } from "../notebook-base.js";

// Opções dos diálogos de geração (idioma, fontes, formato, duração...) e leitura do medidor de uso.

export interface PedidoEstudio {
  notebook: string;
  tipo: TipoEstudio;
  formato?: string;
  idioma?: string;
  duracao?: keyof typeof OPCOES_ESTUDIO.duracao;
  foco?: string;
  fontes?: string[];
  estilo?: string;
  estiloPersonalizado?: string;
  orientacao?: keyof typeof OPCOES_ESTUDIO.orientacao;
  detalhe?: keyof typeof OPCOES_ESTUDIO.detalhe;
  quantidade?: keyof typeof OPCOES_ESTUDIO.quantidade;
  dificuldade?: keyof typeof OPCOES_ESTUDIO.dificuldade;
  tiposPergunta?: (keyof typeof OPCOES_ESTUDIO.tiposPergunta)[];
  modelo?: string;
  /** Trava: não gera se uso atual + estimado do item passar desta porcentagem do limite. */
  usoMaximo?: number;
  /** Só slides: o que baixar. */
  baixar?: FormatoBaixar;
}

// Nome do idioma na lista do NotebookLM para os códigos mais comuns.
export const IDIOMAS: Record<string, string> = {
  pt: "português (Brasil)", "pt-br": "português (Brasil)", "pt-pt": "português (Portugal)", portugues: "português (Brasil)",
  en: "English", ingles: "English", es: "español", espanhol: "español", "es-419": "español (Latinoamérica)", fr: "français", frances: "français",
  de: "Deutsch", alemao: "Deutsch", it: "italiano", italiano: "italiano", ja: "日本語", japones: "日本語", zh: "中文（简体）", chines: "中文（简体）",
  ko: "한국어", coreano: "한국어", ru: "русский", russo: "русский", hi: "हिन्दी", ar: "العربية", arabe: "العربية", nl: "Nederlands", pl: "polski", tr: "Türkçe",
};
export const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function escolher(d: Locator, grupo: string | RegExp, rotulo: string, nomeOpcao: string, avisos: string[]): Promise<boolean> {
  const g = d.getByRole("radiogroup", { name: grupo }).first();
  if (!(await g.count())) {
    avisos.push(`"${nomeOpcao}" não existe neste formato; ignorei.`);
    return false;
  }
  let alvo = g.getByText(rotulo, { exact: true }).first();
  if (!(await alvo.count())) alvo = g.getByText(new RegExp(`^\\s*${escaparRegex(rotulo)}`)).first();
  if (!(await alvo.count())) {
    avisos.push(`Opção "${rotulo}" não encontrada em "${nomeOpcao}"; ignorei.`);
    return false;
  }
  await alvo.click();
  await d.page().waitForTimeout(400);
  return true;
}

export async function escolherIdioma(d: Locator, idioma: string, avisos: string[]): Promise<void> {
  const p = d.page();
  const nome = IDIOMAS[semAcento(idioma)] ?? idioma;
  const combo = d.getByRole("combobox").first();
  if (!(await combo.count())) {
    avisos.push("Este item não tem escolha de idioma; ignorei.");
    return;
  }
  const atual = (await combo.innerText()).trim();
  if (semAcento(atual).startsWith(semAcento(nome))) return;
  await combo.click();
  const opcoes = p.locator(".cdk-overlay-pane").getByRole("option");
  await opcoes.first().waitFor({ timeout: 8000 });
  const textos = (await opcoes.allInnerTexts()).map((t) => semAcento(t));
  let i = textos.findIndex((t) => t === semAcento(nome));
  if (i < 0) i = textos.findIndex((t) => t.startsWith(semAcento(nome)));
  if (i < 0) {
    await p.keyboard.press("Escape");
    avisos.push(`Idioma "${idioma}" não encontrado na lista; mantive ${atual}.`);
    return;
  }
  await opcoes.nth(i).click();
  await p.waitForTimeout(400);
}

export async function escolherFontes(d: Locator, nomes: string[], avisos: string[]): Promise<void> {
  const botao = d.getByRole("button", { name: S.botaoFontesDialogo }).first();
  if (!(await botao.count())) {
    avisos.push("Este item não deixa escolher fontes; usei as fontes marcadas no notebook.");
    return;
  }
  await botao.click();
  const todas = d.getByRole("checkbox", { name: /Selecionar tudo/ }).first();
  await todas.waitFor({ timeout: 10000 });
  if (await todas.isChecked()) await todas.click({ force: true });
  const opcoes = d.getByRole("option");
  const titulos = (await opcoes.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  const lista = titulos.map((titulo, indice) => ({ titulo, indice }));
  for (const nome of nomes) {
    const alvo = acharPorNome(lista, nome, () => "", (x) => x.titulo, "Fonte");
    const opcao = opcoes.nth(alvo.indice);
    if ((await opcao.getAttribute("aria-selected")) !== "true") await opcao.click();
  }
  await d.getByRole("button", { name: S.confirmarFontes }).click();
  await d.getByRole("button", { name: S.gerarAgora }).waitFor({ timeout: 10000 });
}

export async function escolherTiposPergunta(d: Locator, tipos: string[], avisos: string[]): Promise<void> {
  const g = d.getByRole("group", { name: GRUPOS_ESTUDIO.tiposPergunta }).first();
  if (!(await g.count())) {
    avisos.push("Este teste não deixa escolher tipos de pergunta; ignorei.");
    return;
  }
  for (const [chave, rotulo] of Object.entries(OPCOES_ESTUDIO.tiposPergunta)) {
    const b = g.getByRole("button", { name: rotulo, exact: true });
    if (!(await b.count())) continue;
    const ligado = (await b.getAttribute("aria-pressed")) === "true";
    if (ligado !== tipos.includes(chave)) {
      await b.click();
      await d.page().waitForTimeout(300);
    }
  }
}

export async function preencherFoco(d: Locator, tipo: TipoEstudio, foco: string): Promise<void> {
  const campo = d.getByRole("textbox", { name: ESTUDIO[tipo].campo, exact: true }).first();
  await (await campo.count() ? campo : d.getByRole("textbox").last()).fill(foco);
}

/** Relatório: formato, modelo e (se pedido) a tela de personalização com idioma e instruções. */
export async function prepararRelatorio(d: Locator, pedido: PedidoEstudio, avisos: string[]): Promise<string> {
  const formato = (pedido.formato ?? "documento") as keyof typeof OPCOES_ESTUDIO.formatoRelatorio;
  await escolher(d, "Formato do relatório", OPCOES_ESTUDIO.formatoRelatorio[formato], "formato", avisos);
  await d.page().waitForTimeout(800);
  const cartoes = d.locator(".option-card");
  await cartoes.first().waitFor({ timeout: 15000 });
  const nomes = (await d.locator(".option-card .option-title").allInnerTexts()).map((t) => t.trim());
  const modeloPedido = pedido.modelo ?? (formato === "documento" ? "Documento de resumo" : nomes[0]);
  const indice = nomes.findIndex((n) => semAcento(n) === semAcento(modeloPedido)) >= 0
    ? nomes.findIndex((n) => semAcento(n) === semAcento(modeloPedido))
    : nomes.findIndex((n) => semAcento(n).includes(semAcento(modeloPedido)));
  if (indice < 0) throw new Error(`Modelo de relatório "${modeloPedido}" não existe agora. Modelos disponíveis (${formato}): ${nomes.map((n) => `"${n}"`).join(", ")}.`);
  const cartao = cartoes.nth(indice);
  const doZero = /do zero/i.test(nomes[indice]);
  if (pedido.foco || pedido.idioma || doZero) {
    const editar = cartao.getByRole("button", { name: "Personalizar relatório" });
    await ((await editar.count()) ? editar : cartao.locator(".primary-action-button")).click();
    const campo = d.getByRole("textbox", { name: ESTUDIO.relatorio.campo });
    await campo.waitFor({ timeout: 10000 });
    if (pedido.idioma) await escolherIdioma(d, pedido.idioma, avisos);
    if (pedido.foco) {
      const atual = (await campo.inputValue()).trim();
      await campo.fill(doZero || !atual ? pedido.foco : `${atual}\n\n${pedido.foco}`);
    } else if (doZero) {
      throw new Error("O modelo \"Crie do zero\" precisa de 'foco' (descreva o relatório que você quer).");
    }
  } else {
    await cartao.locator(".primary-action-button").click();
  }
  return nomes[indice];
}

export async function aplicarOpcoes(d: Locator, pedido: PedidoEstudio, avisos: string[]): Promise<string[]> {
  const feito: string[] = [];
  const O = OPCOES_ESTUDIO;
  const G = GRUPOS_ESTUDIO;
  const tipo = pedido.tipo;
  const formatos: Partial<Record<TipoEstudio, Record<string, string>>> = { audio: O.formatoAudio, video: O.formatoVideo, slides: O.formatoSlides };
  if (tipo === "relatorio") {
    feito.push(`modelo "${await prepararRelatorio(d, pedido, avisos)}"`);
    if (pedido.idioma) feito.push(`idioma ${pedido.idioma}`);
    if (pedido.foco) feito.push("instruções extras");
  } else if (pedido.formato && formatos[tipo]) {
    const rotulo = formatos[tipo]![pedido.formato];
    if (rotulo && (await escolher(d, G.formato, rotulo, "formato", avisos))) feito.push(`formato ${rotulo}`);
  }
  if (pedido.duracao && (await escolher(d, G.duracao, O.duracao[pedido.duracao], "duração", avisos))) feito.push(`duração ${O.duracao[pedido.duracao]}`);
  if (pedido.quantidade) {
    const grupo = tipo === "teste" ? G.quantidadeQuestoes : G.quantidadeCartoes;
    if (await escolher(d, grupo, O.quantidade[pedido.quantidade], "quantidade", avisos)) feito.push(`quantidade ${O.quantidade[pedido.quantidade]}`);
  }
  if (pedido.dificuldade && (await escolher(d, G.dificuldade, O.dificuldade[pedido.dificuldade], "dificuldade", avisos))) feito.push(`dificuldade ${O.dificuldade[pedido.dificuldade]}`);
  if (pedido.tiposPergunta?.length) {
    await escolherTiposPergunta(d, pedido.tiposPergunta, avisos);
    feito.push(`perguntas: ${pedido.tiposPergunta.map((t) => O.tiposPergunta[t]).join(", ")}`);
  }
  if (pedido.orientacao && (await escolher(d, G.orientacao, O.orientacao[pedido.orientacao], "orientação", avisos))) feito.push(`orientação ${O.orientacao[pedido.orientacao]}`);
  if (pedido.detalhe && (await escolher(d, G.detalhe, O.detalhe[pedido.detalhe], "detalhamento", avisos))) feito.push(`detalhamento ${O.detalhe[pedido.detalhe]}`);
  const estilos: Record<string, string> = tipo === "infografico" ? O.estiloInfografico : O.estiloVideo;
  const estilo = pedido.estiloPersonalizado ? "personalizado" : pedido.estilo;
  if (estilo) {
    if (tipo === "video" && !(await d.getByRole("radiogroup", { name: G.estilo }).count())) {
      avisos.push("Estilo visual só existe no formato \"explicativo\" do vídeo; ignorei.");
    } else if (estilos[estilo] && (await escolher(d, G.estilo, estilos[estilo], "estilo visual", avisos))) {
      feito.push(`estilo ${estilos[estilo]}`);
      if (pedido.estiloPersonalizado) await d.getByRole("textbox", { name: G.estiloPersonalizado }).fill(pedido.estiloPersonalizado);
    }
  }
  if (pedido.idioma && tipo !== "relatorio") {
    await escolherIdioma(d, pedido.idioma, avisos);
    feito.push(`idioma ${pedido.idioma}`);
  }
  if (pedido.fontes?.length) {
    await escolherFontes(d, pedido.fontes, avisos);
    feito.push(`${pedido.fontes.length} fonte(s) escolhida(s)`);
  }
  if (pedido.foco && tipo !== "relatorio") {
    await preencherFoco(d, tipo, pedido.foco);
    feito.push("foco/instruções");
  }
  return feito;
}

export async function lerMedidor(d: Locator): Promise<{ usado: number; estimado: number } | null> {
  const largura = (sel: string) => d.locator(sel).first().evaluate((e) => parseFloat((e as HTMLElement).style.width), undefined, { timeout: 1500 }).catch(() => NaN);
  const usado = await largura(S.medidorUsado);
  const estimado = await largura(S.medidorEstimado);
  return Number.isFinite(usado) && Number.isFinite(estimado) ? { usado, estimado } : null;
}

export async function fecharDialogo(d: Locator): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const f = d.getByRole("button", { name: S.fecharDialogo });
    if (!(await f.count())) break;
    await f.first().click({ timeout: 3000 }).catch(() => {});
    await d.page().waitForTimeout(600);
  }
}

export function idDoItemCriado(corpo: string): string | null {
  for (const linha of corpo.split("\n")) {
    if (!linha.startsWith("[")) continue;
    try {
      for (const it of JSON.parse(linha)) {
        if (it[0] === "wrb.fr" && it[1] === S.rpc.criarItem && it[2]) return String(JSON.parse(it[2])?.[0]?.[0] ?? "") || null;
      }
    } catch {
      // linha parcial
    }
  }
  return null;
}

