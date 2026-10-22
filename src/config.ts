import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PASTA_DADOS } from "./navegador.js";
import { lerTetoDiario } from "./teto.js";
import { comTravaDeArquivo, gravarJsonAtomico } from "./trava-arquivo.js";

// Os vídeos sempre vão para esta pasta, não importa se o MCP foi chamado pelo
// Claude Code ou pelo Claude Desktop: o servidor roda neste PC e o caminho é
// calculado a partir da pasta de dados (%LOCALAPPDATA%\mcp-google), não do diretório de quem chamou.
// Para mudar, defina a variável de ambiente MCP_GOOGLE_SAIDAS no registro do MCP.
export const PASTA_SAIDAS = process.env.MCP_GOOGLE_SAIDAS || path.join(PASTA_DADOS, "saidas");
// Desde a 0.10.0 cada ferramenta tem a sua subpasta; os arquivos de controle (.json/.jsonl) e
// _erros\ continuam na raiz de saidas\.
export const PASTA_FLOW = path.join(PASTA_SAIDAS, "flow");
export const PASTA_NOTEBOOK = path.join(PASTA_SAIDAS, "notebooklm");
export const PASTA_ROTEIROS = path.join(PASTA_NOTEBOOK, "roteiros");
export const PASTA_CONVERSAS = path.join(PASTA_NOTEBOOK, "conversas");
/** Onde o visualizador procura um arquivo pelo nome (a raiz fica por último: arquivos antigos). */
export const PASTAS_DE_ARQUIVOS = [PASTA_FLOW, PASTA_NOTEBOOK, PASTA_ROTEIROS, PASTA_CONVERSAS, PASTA_SAIDAS];

// Preferências locais (na pasta de dados): projeto padrão do Flow.
const ARQUIVO = path.join(PASTA_DADOS, "config.json");

/** Teto diário de créditos do Flow (null = sem teto). Lido uma vez: valor inválido impede a partida. */
export const TETO_DIARIO = lerTetoDiario(process.env.MCP_GOOGLE_TETO_DIARIO);

export interface Config {
  flowProjeto?: string;
}

export function lerConfig(): Config {
  if (!existsSync(ARQUIVO)) return {};
  try {
    return JSON.parse(readFileSync(ARQUIVO, "utf8")) as Config;
  } catch {
    return {};
  }
}

export function salvarConfig(config: Config): void {
  comTravaDeArquivo(ARQUIVO, () => gravarJsonAtomico(ARQUIVO, config));
}
