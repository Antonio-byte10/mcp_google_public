import type { Page } from "playwright";
import type { Prazo } from "../prazo.js";
import { baixarComRedirecionamentoSeguro, saltoDoContexto } from "../download-seguro.js";
import { linkDoNotebookPermitido } from "../seguranca.js";
import { CTX_ITEM, chamarRpc, esperaAte } from "../notebook-base.js";
import { NOTEBOOK as S } from "../seletores.js";

// Download do conteúdo no Google e conversão dos dados internos de cada tipo em Markdown/CSV.

export async function baixarDoGoogle(p: Page, url: unknown, prazo: Prazo): Promise<Buffer> {
  if (url === undefined || url === null || url === "") throw new Error("O Google ainda não forneceu o link deste arquivo; tente de novo em instantes.");
  if (typeof url !== "string") throw new Error("Link de download fora dos servidores do Google; recusado.");
  return baixarComRedirecionamentoSeguro(saltoDoContexto(p.context()), url, linkDoNotebookPermitido, { rotulo: "dos servidores do Google", timeoutMs: esperaAte(prazo, 180000) });
}

/** Escolhe o link de um tipo na lista [[url, tipo, mime], …] (4 = download, 1 = arquivo direto). */
export function linkDaLista(lista: unknown, ...tipos: number[]): string | undefined {
  if (!Array.isArray(lista)) return undefined;
  for (const t of tipos) {
    const achado = (lista as unknown[][]).find((l) => Array.isArray(l) && l[1] === t && typeof l[0] === "string");
    if (achado) return achado[0] as string;
  }
  return undefined;
}

export function decodificarHtml(t: string): string {
  return t
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Dados dos mini-apps (mapa mental, cartões, teste): JSON no atributo data-app-data do HTML do item. */
export async function dadosDoApp(p: Page, itemId: string): Promise<{ dados: unknown; html: string }> {
  const resp = await chamarRpc<unknown[]>(p, S.rpc.item, [itemId, CTX_ITEM]);
  const html = ((resp?.[0] as unknown[])?.[9] as unknown[])?.[0];
  if (typeof html !== "string") throw new Error("O conteúdo deste item não veio no formato esperado.");
  const m = html.match(/data-app-data="([^"]*)"/);
  const dados = m ? JSON.parse(decodificarHtml(m[1])) : null;
  if (!dados) throw new Error("O conteúdo deste item veio vazio (o NotebookLM pode ter mudado o formato); abra-o no NotebookLM.");
  return { dados, html };
}

// BOM para o Excel em português reconhecer UTF-8; células que começam com = + - @ viram texto
// (senão o Excel executaria como fórmula um conteúdo que veio de páginas da web).
export const csv = (linhas: string[][]) =>
  "\uFEFF" + linhas.map((l) => l.map((c) => `"${(/^[=+\-@]/.test(c) ? "'" + c : c).replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
export const celulaMd = (t: string) => t.replace(/\|/g, "\\|").replace(/\n+/g, " ");

export interface NoMapa { name?: string; children?: NoMapa[] }
export function mapaParaMd(no: NoMapa, nivel = 0): string {
  const linha = `${"  ".repeat(nivel)}- ${no.name ?? ""}\n`;
  return linha + (no.children ?? []).map((c) => mapaParaMd(c, nivel + 1)).join("");
}

export interface Cartao { f?: string; b?: string }
export interface Questao {
  type?: string;
  question?: string;
  answerOptions?: { text?: string; isCorrect?: boolean; rationale?: string }[];
  // Lacuna e resposta curta
  bestAnswer?: string;
  acceptableAnswers?: string[];
  rationale?: string;
  hint?: string;
  [k: string]: unknown;
}

export function testeParaMd(titulo: string, questoes: Questao[]): string {
  const partes = [`# ${titulo}`, ""];
  questoes.forEach((q, i) => {
    partes.push(`## ${i + 1}. ${q.question ?? ""}`, "");
    if (q.answerOptions?.length) {
      for (const [j, o] of q.answerOptions.entries()) {
        partes.push(`${String.fromCharCode(97 + j)}) ${o.text ?? ""}${o.isCorrect ? "  ✅" : ""}`);
        if (o.rationale) partes.push(`   > ${o.rationale}`);
      }
    } else if (q.bestAnswer !== undefined) {
      const aceitas = (q.acceptableAnswers ?? []).filter((a) => a !== q.bestAnswer);
      partes.push(`**Resposta:** ${q.bestAnswer}${aceitas.length ? ` (também aceitas: ${aceitas.join("; ")})` : ""}`);
      if (q.rationale) partes.push(`> ${q.rationale}`);
    } else {
      const { type, question, hint, ...resto } = q;
      partes.push("```json", JSON.stringify(resto, null, 2), "```");
    }
    if (q.hint) partes.push("", `*Dica:* ${q.hint}`);
    partes.push("");
  });
  const gabarito = questoes.map((q, i) => {
    const certas = (q.answerOptions ?? []).map((o, j) => (o.isCorrect ? String.fromCharCode(97 + j) : "")).filter(Boolean);
    if (!certas.length && q.bestAnswer !== undefined) certas.push(q.bestAnswer);
    return `${i + 1}${certas.length ? `: ${certas.join(", ")}` : ""}`;
  });
  partes.push("## Gabarito", gabarito.join(" · "));
  return partes.join("\n");
}

/**
 * Trechos de texto com formato ([início, fim, [texto, [negrito, itálico]]]) em Markdown. As marcas
 * abrem e fecham em pilha ("**Tatu-bola (*Tolypeutes*)**") e nunca ficam coladas em espaços.
 */
export function trechosParaMd(lista: unknown): string {
  let saida = "";
  const abertas: string[] = [];
  const mudar = (quer: string[], proximo: string) => {
    // Fecha do topo da pilha até sobrar só o que continua ligado (na mesma ordem).
    let manter = 0;
    while (manter < abertas.length && quer.includes(abertas[manter])) manter++;
    if (manter < abertas.length) {
      const espacos = saida.match(/\s*$/)![0];
      saida = saida.slice(0, saida.length - espacos.length);
      while (abertas.length > manter) saida += abertas.pop();
      saida += espacos;
    }
    const novas = quer.filter((m) => !abertas.includes(m));
    if (novas.length) {
      const espacos = proximo.match(/^\s*/)![0];
      saida += espacos + novas.join("");
      abertas.push(...novas);
      return proximo.slice(espacos.length);
    }
    return proximo;
  };
  for (const t of Array.isArray(lista) ? lista : []) {
    const [txt, fmt] = ((t as unknown[])?.[2] ?? []) as [unknown, unknown[] | undefined];
    if (typeof txt !== "string" || !txt) continue;
    const quer = txt.trim() ? [...(fmt?.[0] === true ? ["**"] : []), ...(fmt?.[1] === true ? ["*"] : [])] : abertas.slice();
    const resto = mudar(quer, txt); // mudar() mexe em saida: guardar antes de somar
    saida += resto;
  }
  mudar([], "");
  return saida;
}

/**
 * Relatório interativo (tipo 11): documento em blocos — título [null, null, [[trechos], [null, 5]]],
 * parágrafo [início, fim, [[trechos]]], item de lista (com marcador em [3]) e itens do Estúdio
 * incorporados ([12] = [id, 1]). Trechos: [início, fim, [texto, [negrito, itálico]]].
 */
export function documentoParaMd(a: unknown[]): string | null {
  const blocos = a.slice(20).map((v) => (((v as unknown[])?.[0] as unknown[])?.[0] as unknown[])?.[0]).find(
    (b) => Array.isArray(b) && b.some((x) => Array.isArray((x as unknown[])?.[2]) && Array.isArray(((x as unknown[])[2] as unknown[])[0])),
  ) as unknown[][] | undefined;
  if (!blocos) return null;
  const linhas: string[] = [];
  const bloco = (...l: string[]) => {
    if (linhas.length && linhas[linhas.length - 1].startsWith("- ")) linhas.push(""); // lista termina antes do bloco
    linhas.push(...l, "");
  };
  for (const b of blocos) {
    const corpo = b[2] as unknown[] | undefined;
    if (!Array.isArray(corpo)) {
      const embutido = (b[12] as unknown[])?.[0];
      if (typeof embutido === "string") bloco(`> [conteúdo interativo do Estúdio incorporado — abra o relatório no NotebookLM para usar (id ${embutido})]`);
      continue;
    }
    const texto = trechosParaMd(corpo[0]).trim();
    if (!texto) continue;
    if ((corpo[1] as unknown[])?.[1] === 5) bloco(`## ${texto}`);
    else if (Array.isArray(corpo[3])) linhas.push(`- ${texto}`);
    else bloco(texto);
  }
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Procura a tabela [linhas, colunas, [[início, fim, [células]], …]] dentro do registro. */
export function acharTabela(no: unknown): unknown[][] | null {
  if (!Array.isArray(no)) return null;
  const [n, m, linhas] = no as [unknown, unknown, unknown];
  if (typeof n === "number" && typeof m === "number" && n > 0 && Array.isArray(linhas) && linhas.length === n &&
    linhas.every((l) => Array.isArray(l) && Array.isArray(l[2]) && l[2].length === m)) {
    return (linhas as unknown[][]).map((l) => l[2] as unknown[]);
  }
  for (const filho of no) {
    const t = acharTabela(filho);
    if (t) return t;
  }
  return null;
}

