import type { Page } from "playwright";
import { comPagina, irPara } from "./navegador.js";
import { NOTEBOOK as S } from "./seletores.js";
import type { Prazo } from "./prazo.js";

// Peças comuns do NotebookLM: abrir a página certa, achar o notebook pelo nome e ler dados
// pelas mesmas chamadas internas que a própria tela faz (mais rápido e exato que ler a tela).

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export type Progresso = (mensagem: string) => void;

export interface Notebook {
  id: string;
  titulo: string;
  detalhes: string;
}

/** Fecha avisos de novidades e o convite de notificações, que aparecem com atraso e tapam botões. */
export async function fecharAvisos(pagina: Page): Promise<void> {
  const fechar = pagina.getByRole("button", { name: S.fecharAviso }).first();
  // Os avisos aparecem com atraso e animação, então espera um pouco e
  // nunca deixa um clique travado derrubar a tarefa.
  await fechar.waitFor({ timeout: 1500 }).catch(() => {});
  for (let i = 0; i < 5 && (await fechar.isVisible()); i++) {
    await fechar.click({ timeout: 3000 }).catch(() => {});
    await pagina.waitForTimeout(700);
  }
  const agoraNao = pagina.getByRole("button", { name: S.avisoAgoraNao, exact: true });
  if (await agoraNao.isVisible().catch(() => false)) await agoraNao.click({ timeout: 3000 }).catch(() => {});
}

export async function abrir(pagina: Page, url: string): Promise<void> {
  await irPara(pagina, url);
  await fecharAvisos(pagina);
}

export function comNotebook<T>(prazo: Prazo, tarefa: (pagina: Page) => Promise<T>): Promise<T> {
  return comPagina(tarefa, prazo);
}

export async function lerLista(pagina: Page): Promise<Notebook[]> {
  await abrir(pagina, S.url);
  await pagina.locator(S.carregado).first().waitFor();
  if (!(await pagina.locator(S.linha).count())) {
    await pagina.getByRole("button", { name: S.botaoModoLista }).click();
    await pagina.locator(S.linha).first().waitFor();
  }
  const verMais = pagina.getByRole("button", { name: S.botaoVerMais });
  for (let i = 0; i < 20 && (await verMais.count()); i++) {
    await verMais.first().click();
    await pagina.waitForTimeout(1500);
  }
  return pagina.locator(S.linha).evaluateAll(
    (linhas, s) => {
      const txt = (l: Element, sel: string) => (l.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
      return linhas
        .filter((l) => !(txt(l, s.linhaPublico).includes("public") && txt(l, s.linhaPapel) === "Leitor"))
        .map((l) => {
          const link = l.querySelector(s.linhaLink);
          return {
            id: (link?.getAttribute("href") ?? "").split("/").pop() ?? "",
            titulo: link?.getAttribute("title") ?? txt(l, s.linhaLink),
            detalhes: [txt(l, s.linhaData), txt(l, s.linhaFontes), txt(l, s.linhaPapel)].join(" · "),
          };
        });
    },
    { linhaLink: S.linhaLink, linhaFontes: S.linhaFontes, linhaData: S.linhaData, linhaPapel: S.linhaPapel, linhaPublico: S.linhaPublico },
  );
}

/** Escolhe um item pelo id, pelo título exato ou por um trecho do título (sem diferenciar maiúsculas). */
export function acharPorNome<T>(itens: T[], busca: string, id: (t: T) => string, titulo: (t: T) => string, oQue: string): T {
  const alvo = busca.trim().toLowerCase();
  // Busca vazia casaria com tudo ("".includes) — numa remoção, isso apagaria a fonte errada.
  if (!alvo) throw new Error(`Informe o nome ou o id (${oQue.toLowerCase()}).`);
  const porId = itens.find((i) => id(i).toLowerCase() === alvo);
  if (porId) return porId;
  const exatos = itens.filter((i) => titulo(i).trim().toLowerCase() === alvo);
  if (exatos.length === 1) return exatos[0];
  const parciais = exatos.length ? exatos : itens.filter((i) => titulo(i).toLowerCase().includes(alvo));
  if (parciais.length === 1) return parciais[0];
  if (!parciais.length) throw new Error(`${oQue} "${busca}" não encontrado(a).`);
  throw new Error(`Mais de um(a) ${oQue.toLowerCase()} combina com "${busca}": ${parciais.slice(0, 8).map((i) => `"${titulo(i)}"`).join(", ")}. Use o nome completo ou o id.`);
}

/** Aceita id, URL ou título do notebook e devolve o id. */
export async function resolverId(pagina: Page, notebook: string): Promise<string> {
  const id = notebook.match(UUID)?.[0];
  if (id) return id;
  const lista = await lerLista(pagina);
  try {
    return acharPorNome(lista, notebook, (n) => n.id, (n) => n.titulo, "Notebook").id;
  } catch (e) {
    throw new Error(`${(e as Error).message} Use notebook_listar.`);
  }
}

/** Resolve o notebook, abre a página dele e espera a tela carregar. Devolve o id. */
export async function abrirNotebook(pagina: Page, notebook: string): Promise<string> {
  const id = await resolverId(pagina, notebook);
  await abrir(pagina, S.urlNotebook(id));
  await pagina.getByRole("textbox", { name: S.caixaPergunta }).waitFor({ timeout: 30000 });
  return id;
}

// ---------- Leitura pelas chamadas internas da página ----------

// Contextos que a tela manda junto com cada leitura (copiados das chamadas da própria página).
export const CTX = [2, null, [1], [1, null, null, null, null, null, null, null, null, null, [1, 3]]];
export const CTX_ESTUDIO = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8, 10, 14, 2, 3, 6]]];
export const CTX_ITEM = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8, 10, 14, 2, 3, 6, 7]]];

/**
 * Faz uma leitura `batchexecute` de dentro da página (mesma origem, mesmos cookies e
 * parâmetros que a tela usa). Só usado para LER dados; ações passam sempre pela tela.
 */
export async function chamarRpc<T = unknown>(pagina: Page, rpc: string, args: unknown): Promise<T> {
  // Erros passageiros do servidor do Google (HTTP 5xx) acontecem; tenta de novo antes de desistir.
  for (let tentativa = 1; ; tentativa++) {
    const r = await lerRpc(pagina, rpc, args);
    if ("dados" in r) return JSON.parse(r.dados) as T;
    if (!r.passageiro || tentativa >= 3) throw new Error(`NotebookLM: ${r.falha}.`);
    await pagina.waitForTimeout(1500 * tentativa);
  }
}

function lerRpc(pagina: Page, rpc: string, args: unknown): Promise<{ dados: string } | { falha: string; passageiro?: boolean }> {
  return pagina.evaluate(
    async ({ rpc, args, url }) => {
      const w = (window as unknown as { WIZ_global_data?: Record<string, string> }).WIZ_global_data;
      if (!w?.SNlM0e) return { falha: "a página do NotebookLM não carregou direito" };
      const qs = new URLSearchParams({
        rpcids: rpc, "source-path": location.pathname, bl: w.cfb2h ?? "", "f.sid": w.FdrFJe ?? "",
        hl: document.documentElement.lang || "pt-BR", _reqid: String(100000 + Math.floor(Math.random() * 800000)), rt: "c",
      });
      const body = new URLSearchParams({ "f.req": JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]), at: w.SNlM0e });
      const resp = await fetch(`${url}?${qs}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "x-same-domain": "1" },
        body,
        credentials: "include",
      });
      const texto = await resp.text();
      for (const linha of texto.split("\n")) {
        if (!linha.startsWith("[")) continue;
        try {
          for (const it of JSON.parse(linha)) {
            if (it[0] === "wrb.fr" && it[1] === rpc) return it[2] ? { dados: it[2] as string } : { falha: `o Google recusou a leitura (${rpc})` };
          }
        } catch {
          // linha que não é JSON completo
        }
      }
      return { falha: `resposta inesperada do Google (HTTP ${resp.status})`, passageiro: resp.status >= 500 };
    },
    { rpc, args, url: S.urlRpc },
  );
}

export interface Uso {
  /** Limite da janela atual (renova a cada poucas horas). */
  janela?: { usado: number; renova?: Date };
  semana?: { usado: number; renova?: Date };
}

/** Uso da IA do NotebookLM (o mesmo medidor de "Uso da IA" dos diálogos do Estúdio). */
export async function lerUso(pagina: Page): Promise<Uso> {
  const dados = await chamarRpc<unknown[]>(pagina, S.rpc.uso, [CTX]);
  const uso: Uso = {};
  for (const e of ((dados?.[1] ?? []) as unknown[][])) {
    const valor = { usado: Math.round(Number(e[6] ?? 0) * 10) / 10, renova: dataDoCarimbo(e[5]) };
    if (e[4] === 1) uso.janela = valor;
    if (e[4] === 2) uso.semana = valor;
  }
  return uso;
}

export function descreverUso(u: Uso): string {
  const parte = (nome: string, v?: { usado: number; renova?: Date }) => (v ? `${nome}: ${v.usado}% usado${v.renova ? ` (renova ${dataCurta(v.renova)})` : ""}` : "");
  return [parte("Limite atual", u.janela), parte("Limite semanal", u.semana)].filter(Boolean).join(" · ") || "uso não informado";
}

/** Junta os textos dos "segmentos" que o NotebookLM usa para guardar texto ([início, fim, [texto, formato]]). */
export function textoDosSegmentos(no: unknown, partes: string[] = []): string[] {
  if (!Array.isArray(no)) return partes;
  if (no.length >= 3 && typeof no[0] === "number" && typeof no[1] === "number" && Array.isArray(no[2]) && typeof no[2][0] === "string") {
    partes.push(no[2][0]);
    return partes;
  }
  for (const filho of no) textoDosSegmentos(filho, partes);
  return partes;
}

/** Data de um carimbo [segundos, nanos] do Google. */
export function dataDoCarimbo(c: unknown): Date | undefined {
  return Array.isArray(c) && typeof c[0] === "number" ? new Date(c[0] * 1000) : undefined;
}

export function dataCurta(d?: Date): string {
  if (!d) return "";
  const z = (n: number) => String(n).padStart(2, "0");
  return `${z(d.getDate())}/${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function limitarTexto(texto: string, max: number, onde?: string): string {
  if (texto.length <= max) return texto;
  return `${texto.slice(0, max)}\n\n[… cortado: ${texto.length - max} caracteres a mais${onde ? `; texto completo em ${onde}` : ""}]`;
}

/** Espera um elemento sem estourar o prazo da chamada. */
export function esperaAte(prazo: Prazo, maximoMs: number): number {
  return Math.max(1000, Math.min(maximoMs, prazo.restante() - 3000));
}
