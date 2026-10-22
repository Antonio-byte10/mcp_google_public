import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { comTravaDeArquivo, gravarJsonAtomico } from "./trava-arquivo.js";
import { PASTA_SAIDAS } from "./config.js";

// Gerações que ainda não terminaram de baixar. Ficam em disco porque a chamada que gerou
// (ex.: no Claude Desktop, que corta em ~60 s) não é a mesma que vai baixar (flow_status),
// e pode até ser outro processo (Claude Code). Só é lido e escrito com o navegador travado.

export type TipoLote = "video" | "imagem" | "extensao";
export type Qualidade = "original" | "1080p" | "2k" | "gif";

export interface Lote {
  lote: string;
  tipo: TipoLote;
  projeto: string;
  prompt: string;
  quantidade: number;
  modelo: string;
  custo: number;
  qualidade: Qualidade;
  criadoEm: string;
  /** Ids de mídia que já existiam no projeto antes do envio (não são deste pedido). */
  existentes: string[];
  /** Ids reconhecidos como deste pedido. */
  ids: string[];
  /** id → caminho do arquivo salvo. */
  baixados: Record<string, string>;
  /** Extensão: cena que junta o vídeo original e o clipe novo. */
  cena?: string;
  cenaBaixada?: string;
  /** Personagens usados no comando (o prompt guardado pelo Flow pode vir marcado). */
  personagens?: string[];
  /** Quantos elementos (personagens, imagens de referência, voz) foram no comando. */
  elementos?: number;
  historico?: Record<string, number[]>;
  /** id → código de status de falha (a mídia não vai ficar pronta). */
  falhas?: Record<string, number>;
  /** Quantas mídias pedidas nunca apareceram no projeto (perdidas). */
  perdidas?: number;
  /** id → quando um status desconhecido foi visto pela primeira vez. */
  estranhos?: Record<string, number>;
  /** Extensão que é um passo do vídeo longo: termina quando o clipe fica pronto (sem exportar a cena). */
  apenasClipe?: boolean;
  /** Id do clipe novo, quando apenasClipe e ele ficou pronto. */
  clipePronto?: string;
}

/** Como um lote terminou (para quem precisa continuar a partir dele, como o vídeo longo). */
export interface ResultadoLote {
  lote: string;
  estado: string;
  ids: string[];
  cena?: string;
  clipe?: string;
  quando: string;
}

const ARQUIVO_RESULTADOS = () => path.join(PASTA_SAIDAS, "lotes-concluidos.json");
const MAX_RESULTADOS = 300;

export function lerResultados(): ResultadoLote[] {
  if (!existsSync(ARQUIVO_RESULTADOS())) return [];
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO_RESULTADOS(), "utf8"));
    return Array.isArray(dados) ? (dados as ResultadoLote[]) : [];
  } catch {
    return [];
  }
}

export function guardarResultados(novos: ResultadoLote[]): void {
  if (!novos.length) return;
  const ids = new Set(novos.map((r) => r.lote));
  comTravaDeArquivo(ARQUIVO_RESULTADOS(), () => {
    const lista = [...lerResultados().filter((r) => !ids.has(r.lote)), ...novos].slice(-MAX_RESULTADOS);
    gravarJsonAtomico(ARQUIVO_RESULTADOS(), lista);
  });
}

const ARQUIVO = () => path.join(PASTA_SAIDAS, "pendentes.json");
// Depois disso sem terminar, o lote é dado como perdido (o vídeo ainda pode estar no Flow).
export const VALIDADE_LOTE_MS = 2 * 60 * 60 * 1000;

export function lerLotes(): Lote[] {
  if (!existsSync(ARQUIVO())) return [];
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO(), "utf8"));
    return Array.isArray(dados) ? (dados as Lote[]) : [];
  } catch {
    return [];
  }
}

export function salvarLotes(lotes: Lote[]): void {
  gravarJsonAtomico(ARQUIVO(), lotes);
}

/** Lê, altera e grava a lista de lotes sob a trava do arquivo (outra janela pode gravar a qualquer momento). */
export function alterarLotes(mudar: (lotes: Lote[]) => Lote[]): void {
  comTravaDeArquivo(ARQUIVO(), () => salvarLotes(mudar(lerLotes())));
}

export function novoIdLote(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
