import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acharExecutavel, escolherNavegador, escolherPastaPerfil, type DefinicaoNavegador } from "./navegador-tipos.js";
import { avisoDadosAntigos, escolherPastaDados } from "./pastas.js";

// O navegador, a pasta de dados e o perfil em uso, decididos uma vez ao carregar. Os cookies do
// Google ficam só no perfil, dentro da pasta de dados (%LOCALAPPDATA%\mcp-google), fora da pasta
// do código. Para guardar em outro lugar: MCP_GOOGLE_DADOS (tudo) ou MCP_GOOGLE_PERFIL (só o perfil).
/** Pasta do código (package.json, dist). Não guarda dados pessoais. */
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Pasta dos dados deste PC: perfil do navegador, saidas e config.json. */
export const PASTA_DADOS = escolherPastaDados({ dadosEnv: process.env.MCP_GOOGLE_DADOS, localAppData: process.env.LOCALAPPDATA, home: os.homedir() });
mkdirSync(PASTA_DADOS, { recursive: true });
/** Aviso para quem atualizou e deixou dados na pasta do código. */
export const AVISO_DADOS: string | undefined = avisoDadosAntigos({ raiz: RAIZ, dados: PASTA_DADOS, existe: existsSync });

const escolha = escolherNavegador(process.env.MCP_GOOGLE_NAVEGADOR, (id) => acharExecutavel(id, existsSync) !== undefined);

export const NAVEGADOR: DefinicaoNavegador = escolha.navegador;
/** Aviso de que caiu no outro navegador (para mensagens de login/diagnóstico). */
export const AVISO_NAVEGADOR: string | undefined = escolha.aviso;
export const PASTA_PERFIL = escolherPastaPerfil({ perfilEnv: process.env.MCP_GOOGLE_PERFIL, raiz: PASTA_DADOS, navegador: NAVEGADOR, existe: existsSync });

/** Nome do navegador ativo para mensagens ("Google Chrome" / "Microsoft Edge"). */
export function rotuloNavegador(): string {
  return NAVEGADOR.rotulo;
}

/** Caminho do executável do navegador ativo. */
export function caminhoNavegador(): string {
  const caminho = acharExecutavel(NAVEGADOR.id, existsSync);
  if (!caminho) throw new Error(`${NAVEGADOR.rotulo} não encontrado.`);
  return caminho;
}
