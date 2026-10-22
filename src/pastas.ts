import path from "node:path";

// Onde ficam os dados deste PC: a sessão do Google (perfil do navegador), os arquivos gerados
// (saidas) e as preferências (config.json). Desde a 0.16.0 eles ficam FORA da pasta do código,
// para nada pessoal ir junto quando o projeto é copiado ou publicado. Regras puras: quem consulta
// o disco passa `existe` (test/pastas-teto.test.mjs).

/** O que ficava na pasta do código até a 0.15.0. */
export const DADOS_ANTIGOS = ["perfil", "perfil-edge", "perfil-chrome", "saidas", "config.json"];

/** Pasta de dados: MCP_GOOGLE_DADOS manda; senão %LOCALAPPDATA%\mcp-google (fora do Windows, ~/.mcp-google). */
export function escolherPastaDados(opcoes: { dadosEnv?: string; localAppData?: string; home: string }): string {
  const { dadosEnv, localAppData, home } = opcoes;
  if (dadosEnv?.trim()) return path.resolve(dadosEnv.trim());
  if (localAppData) return path.join(localAppData, "mcp-google");
  return path.join(home, ".mcp-google");
}

/**
 * Aviso para quem atualizou de uma versão antiga e ainda tem dados na pasta do código (eles não
 * são usados nem movidos sozinhos). undefined quando não há nada lá ou a pasta de dados é a do código.
 */
export function avisoDadosAntigos(opcoes: { raiz: string; dados: string; existe: (caminho: string) => boolean }): string | undefined {
  const { raiz, dados, existe } = opcoes;
  if (path.resolve(raiz).toLowerCase() === path.resolve(dados).toLowerCase()) return undefined;
  const achados = DADOS_ANTIGOS.filter((nome) => existe(path.join(raiz, nome)));
  if (!achados.length) return undefined;
  return `Há dados de uma versão antiga na pasta do código (${achados.join(", ")}) que não são mais usados. Desde a 0.16.0 eles ficam em ${dados}: mova-os para lá (com o app fechado) para manter o login e os arquivos.`;
}
