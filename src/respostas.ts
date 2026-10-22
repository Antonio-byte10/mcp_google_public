import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { tipoMime, type Arquivo } from "./arquivos.js";
import { PASTA_SAIDAS } from "./config.js";
import { infoCliente } from "./prazo.js";
import { entregavelAoVisualizador, mensagemDeErro } from "./seguranca.js";
import { URI_VISUALIZADOR } from "./visualizador.js";

// Formato das respostas das ferramentas (texto, miniaturas, dados do visualizador) e anotações.

export function texto(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/**
 * Erro com cara de tela mudada (um botão ou campo que o Playwright esperou e não apareceu): a
 * resposta já sugere o auto-diagnóstico, que diz qual item mudou.
 */
const PARECE_TELA_MUDADA = /Timeout \d+ms exceeded|waiting for (locator|getBy)|strict mode violation|element is not (visible|attached)/i;

export function erroParaOClaude(erro: unknown): string {
  const msg = mensagemDeErro(erro);
  return PARECE_TELA_MUDADA.test(msg)
    ? `Erro: ${msg}\n\nIsso costuma acontecer quando o Google muda a tela. Rode diagnostico com completo=true para ver exatamente o que mudou.`
    : `Erro: ${msg}`;
}

// Erros viram resposta legível para o Claude, em vez de derrubar a chamada.
export async function tentar(acao: () => Promise<string>) {
  try {
    return texto(await acao());
  } catch (erro) {
    return { ...texto(erroParaOClaude(erro)), isError: true };
  }
}

// Prévia de texto dos documentos (.md, .csv) no visualizador: o começo do arquivo, sem ler tudo.
const PREVIA_TEXTO = 6000;
function previaDeTexto(caminho: string): string | undefined {
  if (!/\.(md|csv)$/i.test(caminho)) return undefined;
  try {
    const fd = openSync(caminho, "r");
    try {
      const b = Buffer.alloc(PREVIA_TEXTO + 4);
      const n = readSync(fd, b, 0, b.length, 0);
      // Corta num fim de linha para não partir um caractere UTF-8 no meio.
      const t = b.subarray(0, n).toString("utf8");
      if (n <= PREVIA_TEXTO) return t;
      const corte = t.lastIndexOf("\n");
      return t.slice(0, corte > 0 ? corte : PREVIA_TEXTO) + "\n…";
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

export interface RespostaComArquivos {
  texto: string;
  arquivos: Arquivo[];
  projeto?: string;
  /** Botão do visualizador para abrir a página de origem (ex.: o notebook). */
  link?: { url: string; rotulo: string };
  andamento?: string;
}

/**
 * Resposta das ferramentas que salvam arquivos:
 * - texto (caminhos e detalhes), como antes;
 * - uma miniatura de cada arquivo (bloco de imagem): o Claude vê o resultado, e o Claude Code
 *   a exibe;
 * - structuredContent para o visualizador do Claude Desktop (prévia + Baixar/Assistir).
 */
export async function tentarComArquivos(acao: () => Promise<RespostaComArquivos>) {
  try {
    const r = await acao();
    const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text: r.texto }];
    // .json/.html ficam só no texto: o visualizador não os entrega (botão Baixar falharia).
    const arquivos = r.arquivos.filter((a) => entregavelAoVisualizador(path.basename(a.caminho))).map((a) => {
      let previa: number | undefined;
      if (a.previa) {
        content.push({ type: "image", data: a.previa, mimeType: "image/jpeg" });
        previa = content.length - 1;
      }
      return {
        nome: path.basename(a.caminho), caminho: a.caminho, tipo: a.tipo, mime: tipoMime(a.caminho),
        largura: a.largura, altura: a.altura, duracao: a.duracao, audio: a.audio, tamanhoMB: a.tamanhoMB, previa,
        texto: previaDeTexto(a.caminho),
      };
    });
    // O Claude Code mostra só o structuredContent quando ele existe (some o texto e as miniaturas);
    // esses dados só servem para o visualizador do Claude Desktop.
    if (infoCliente().cliente === "claude-code") return { content };
    return { content, structuredContent: { arquivos, projeto: r.projeto, link: r.link, andamento: r.andamento, pasta: r.arquivos.length ? path.dirname(r.arquivos[0].caminho) : PASTA_SAIDAS } };
  } catch (erro) {
    return { ...texto(erroParaOClaude(erro)), isError: true };
  }
}

// O Claude Desktop mostra o visualizador (ui://) junto com o resultado destas ferramentas.
export const META_UI = { ui: { resourceUri: URI_VISUALIZADOR }, "ui/resourceUri": URI_VISUALIZADOR };

// Todas as ferramentas usam a conta Google do usuário em sites externos.
export const LEITURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
export const ESCRITA = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTRUTIVA = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

/** Avisos de progresso (o Claude Code mostra; o Desktop ignora, mas não atrapalha). */
export function criarProgresso(extra: { _meta?: { progressToken?: string | number }; sendNotification: (n: never) => Promise<void> }) {
  const token = extra._meta?.progressToken;
  let passo = 0;
  return (mensagem: string) => {
    if (token === undefined) return;
    void extra
      .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++passo, message: mensagem } } as never)
      .catch(() => {});
  };
}
