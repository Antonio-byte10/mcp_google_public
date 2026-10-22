import type { Page } from "playwright";
import { chamarRpc, comNotebook, abrirNotebook, CTX, dataCurta, dataDoCarimbo, textoDosSegmentos } from "./notebook-base.js";
import { fontesDoNotebook } from "./notebook-fontes.js";
import { NOTEBOOK as S } from "./seletores.js";
import type { Prazo } from "./prazo.js";

// Histórico do chat e o trecho exato de cada citação, lidos pelas mesmas chamadas que a tela faz
// ao abrir o notebook (mapeado em 07/10/2026):
// - conversas (hPTbtc) [CTX, null, notebook, 20] → [[[conversaId, [criada], [alterada]]]]
// - mensagens (khqZz) [CTX, null, null, conversaId, limite] → [[mensagem…]], da mais nova para a mais antiga.
//   Mensagem: [id, [seg, nanos], papel (1 = pergunta, 2 = resposta), textoDaPergunta, [resposta]].
//   resposta[0] = [Markdown com os [n], null, [conversa…], null, [estrutura, …, citações, 1]].
//   Citações (resposta[0][4][3]) na ordem dos números [1], [2]…:
//   [[id], [null, null, relevância, [[null, início, fim]], parágrafos com o texto da fonte, [[[fonteId], …]], [id]]].

export interface Citacao {
  n: number;
  fonteId: string;
  fonte: string;
  /** O trecho da fonte que o [n] cita, como está na fonte (pode estar em outro idioma). */
  trecho: string;
}

export interface Troca {
  quando?: Date;
  pergunta: string;
  /** Resposta em Markdown, com os marcadores [n]. Vazia se ainda não terminou. */
  resposta: string;
  citacoes: Citacao[];
}

export interface Conversa {
  notebook: string;
  titulo: string;
  trocas: Troca[];
}

/** Maior número de mensagens pedidas de uma vez (perguntas + respostas). */
const LIMITE_MENSAGENS = 500;

/** Parágrafo = [início, fim, [trechos de texto…], …]; um trecho de texto é [início, fim, [texto, formato]]. */
function paragrafos(no: unknown): unknown[] {
  if (!Array.isArray(no)) return [];
  if (typeof no[0] === "number" && Array.isArray(no[2]) && Array.isArray(no[2][0])) return [no];
  return no.flatMap(paragrafos);
}

/** Texto de um trecho citado: cada parágrafo numa linha. */
function textoDoTrecho(estrutura: unknown): string {
  return paragrafos(estrutura)
    .map((p) => textoDosSegmentos(p).join(""))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function lerCitacoes(resposta: unknown[], titulos: Map<string, string>): Citacao[] {
  const lista = ((resposta[4] as unknown[] | undefined)?.[3] ?? []) as unknown[][];
  if (!Array.isArray(lista)) return [];
  return lista.map((c, i) => {
    const dados = (c?.[1] ?? []) as unknown[];
    const fonteId = String((((dados[5] as unknown[])?.[0] as unknown[])?.[0] as unknown[])?.[0] ?? "");
    return { n: i + 1, fonteId, fonte: titulos.get(fonteId) ?? "(fonte removida)", trecho: textoDoTrecho(dados[4]) };
  });
}

/** Mensagens cruas do chat (mais nova primeiro) ou [] se o notebook nunca teve conversa. */
async function mensagens(pagina: Page, notebook: string, limite: number): Promise<unknown[][]> {
  const conversas = await chamarRpc<unknown[]>(pagina, S.rpc.conversas, [CTX, null, notebook, 20]);
  const conversa = ((conversas?.[0] as unknown[] | undefined)?.[0] as unknown[] | undefined)?.[0];
  if (typeof conversa !== "string") return [];
  const dados = await chamarRpc<unknown[]>(pagina, S.rpc.mensagens, [CTX, null, null, conversa, limite]);
  const lista = dados?.[0];
  if (lista !== undefined && lista !== null && !Array.isArray(lista)) throw new Error("O histórico do chat veio num formato desconhecido (o Google pode ter mudado a tela).");
  return (lista ?? []) as unknown[][];
}

/** Lê o histórico do chat (da mais antiga para a mais nova) com o trecho de cada citação. */
export async function lerConversa(pagina: Page, notebook: string, limite = LIMITE_MENSAGENS): Promise<Conversa> {
  const [{ titulo, fontes }, crus] = await Promise.all([fontesDoNotebook(pagina, notebook), mensagens(pagina, notebook, limite)]);
  return { notebook, titulo, trocas: montarTrocas(crus, new Map(fontes.map((f) => [f.id, f.titulo]))) };
}

/** Mensagens cruas (mais nova primeiro) → perguntas e respostas na ordem da conversa. */
export function montarTrocas(crus: unknown[][], titulos: Map<string, string>): Troca[] {
  const trocas: Troca[] = [];
  for (const m of [...crus].reverse()) {
    if (!Array.isArray(m)) continue;
    if (m[2] === 1) {
      trocas.push({ quando: dataDoCarimbo(m[1]), pergunta: String(m[3] ?? ""), resposta: "", citacoes: [] });
    } else if (m[2] === 2) {
      const r = ((m[4] as unknown[] | undefined)?.[0] ?? []) as unknown[];
      // Resposta sem pergunta antes (histórico cortado pelo limite): entra com a pergunta vazia.
      if (!trocas.length || trocas[trocas.length - 1].resposta) trocas.push({ quando: dataDoCarimbo(m[1]), pergunta: "", resposta: "", citacoes: [] });
      const atual = trocas[trocas.length - 1];
      atual.resposta = String(r[0] ?? "").trim();
      atual.citacoes = lerCitacoes(r, titulos);
    }
  }
  return trocas;
}

const normalizar = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Citações completas da última resposta, se ela for mesmo a resposta da pergunta indicada.
 * Logo depois de a resposta terminar o histórico pode ainda não ter a mensagem: tenta de novo (até 3 vezes).
 */
export async function citacoesDaUltima(pagina: Page, notebook: string, pergunta: string): Promise<Citacao[] | undefined> {
  const inicio = normalizar(pergunta).slice(0, 60);
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { trocas } = await lerConversa(pagina, notebook, 4);
    const ultima = trocas[trocas.length - 1];
    if (ultima?.resposta && normalizar(ultima.pergunta).startsWith(inicio)) return ultima.citacoes;
    await pagina.waitForTimeout(1500);
  }
  return undefined;
}

// ---------- Texto para o Claude e para o arquivo ----------

export function descreverCitacoes(citacoes: Citacao[], maxTrecho = 1500): string {
  return citacoes
    .map((c) => {
      const trecho = c.trecho.length > maxTrecho ? `${c.trecho.slice(0, maxTrecho)}…` : c.trecho;
      return `[${c.n}] ${c.fonte}\n${trecho ? trecho.split("\n").map((l) => `> ${l}`).join("\n") : "> (o Google não mandou o trecho)"}`;
    })
    .join("\n\n");
}

export function conversaEmMarkdown(c: Conversa): string {
  const linhas = [
    `# Conversa do notebook "${c.titulo}"`,
    "",
    `Salva em ${new Date().toLocaleString("pt-BR")} · ${c.trocas.length} pergunta(s) · notebook \`${c.notebook}\` (https://notebook.google.com/notebook/${c.notebook})`,
    "",
    "Os trechos citados vêm das fontes do notebook como estão nelas (podem estar em outro idioma).",
    "",
  ];
  c.trocas.forEach((t, i) => {
    linhas.push("---", "", `## ${i + 1}. ${t.pergunta.split("\n")[0].slice(0, 120) || "(pergunta não encontrada)"}`, "");
    if (t.quando) linhas.push(`*${dataCurta(t.quando)}*`, "");
    if (t.pergunta.includes("\n") || t.pergunta.length > 120) linhas.push("**Pergunta completa:**", "", t.pergunta, "");
    linhas.push("**Resposta:**", "", t.resposta || "(sem resposta: ainda estava sendo escrita ou falhou)", "");
    if (t.citacoes.length) linhas.push("**Trechos citados:**", "", descreverCitacoes(t.citacoes, Infinity), "");
  });
  return linhas.join("\n");
}

/** Para o notebook_conversa: abre o notebook e lê o histórico inteiro. */
export function conversaDoNotebook(prazo: Prazo, notebook: string): Promise<Conversa> {
  return comNotebook(prazo, async (pagina) => {
    const id = await abrirNotebook(pagina, notebook);
    return lerConversa(pagina, id);
  });
}
