import path from "node:path";

// Definição dos navegadores suportados e as regras puras de escolha (sem tocar no disco nem
// abrir nada: quem consulta o disco passa `existe`). Assim dá para testar sem navegador.

export type IdNavegador = "chrome" | "edge";

export interface DefinicaoNavegador {
  id: IdNavegador;
  /** Nome para mensagens ao usuário. */
  rotulo: string;
  /** Valor de `channel` do Playwright. */
  channel: "chrome" | "msedge";
  /** Nome do processo no Windows (filtro da consulta de processos). */
  processo: string;
  /** Pasta de perfil padrão, dentro da pasta de dados (src/pastas.ts). */
  pastaPerfil: string;
}

export const NAVEGADORES: Record<IdNavegador, DefinicaoNavegador> = {
  chrome: { id: "chrome", rotulo: "Google Chrome", channel: "chrome", processo: "chrome.exe", pastaPerfil: "perfil-chrome" },
  edge: { id: "edge", rotulo: "Microsoft Edge", channel: "msedge", processo: "msedge.exe", pastaPerfil: "perfil-edge" },
};

export const NAVEGADOR_PADRAO: IdNavegador = "edge";
/** Pasta de perfil das versões que só tinham o Edge (quem já logou ali continua logado). */
export const PASTA_PERFIL_ANTIGA = "perfil";

type Ambiente = Record<string, string | undefined>;

/** Caminhos onde o executável costuma estar no Windows. */
export function caminhosCandidatos(id: IdNavegador, env: Ambiente = process.env): string[] {
  const arquivos = env["ProgramFiles"] || "C:\\Program Files";
  const arquivosX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = env["LOCALAPPDATA"];
  if (id === "chrome") {
    return [
      path.win32.join(arquivos, "Google", "Chrome", "Application", "chrome.exe"),
      path.win32.join(arquivosX86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(local ? [path.win32.join(local, "Google", "Chrome", "Application", "chrome.exe")] : []),
    ];
  }
  return [
    path.win32.join(arquivosX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.win32.join(arquivos, "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
}

/** Primeiro executável existente, ou undefined se o navegador não está instalado. */
export function acharExecutavel(id: IdNavegador, existe: (caminho: string) => boolean, env: Ambiente = process.env): string | undefined {
  return caminhosCandidatos(id, env).find(existe);
}

export interface Escolha {
  navegador: DefinicaoNavegador;
  /** Aviso para mostrar ao usuário (ex.: caiu no outro navegador). */
  aviso?: string;
}

/**
 * Escolhe o navegador: MCP_GOOGLE_NAVEGADOR manda; sem a variável, Edge, e se ele não estiver
 * instalado cai no Chrome (com aviso). Valor inválido é erro. Variável definida nunca cai no outro.
 */
export function escolherNavegador(valor: string | undefined, instalado: (id: IdNavegador) => boolean): Escolha {
  const texto = valor?.trim().toLowerCase();
  if (texto) {
    if (texto !== "chrome" && texto !== "edge") {
      throw new Error(`MCP_GOOGLE_NAVEGADOR inválido: "${valor}". Use "chrome" ou "edge".`);
    }
    return { navegador: NAVEGADORES[texto] };
  }
  const padrao = NAVEGADORES[NAVEGADOR_PADRAO];
  if (instalado(padrao.id)) return { navegador: padrao };
  const outro = NAVEGADORES[padrao.id === "chrome" ? "edge" : "chrome"];
  if (instalado(outro.id)) {
    return { navegador: outro, aviso: `${padrao.rotulo} não foi encontrado; usando ${outro.rotulo}. Para escolher, defina MCP_GOOGLE_NAVEGADOR (chrome ou edge).` };
  }
  return { navegador: padrao }; // nenhum instalado: o erro aparece ao tentar abrir
}

/**
 * Pasta do perfil: MCP_GOOGLE_PERFIL manda. Senão, uma pasta por navegador (cookies cifrados de
 * um não abrem no outro). Exceção: Edge reaproveita a antiga `perfil/` se `perfil-edge/` ainda
 * não existe.
 */
export function escolherPastaPerfil(opcoes: { perfilEnv?: string; raiz: string; navegador: DefinicaoNavegador; existe: (caminho: string) => boolean }): string {
  const { perfilEnv, raiz, navegador, existe } = opcoes;
  if (perfilEnv) return perfilEnv;
  const propria = path.join(raiz, navegador.pastaPerfil);
  const antiga = path.join(raiz, PASTA_PERFIL_ANTIGA);
  if (navegador.id === "edge" && !existe(propria) && existe(antiga)) return antiga;
  return propria;
}

/**
 * Opções do Playwright para abrir o perfil. Com o caminho do executável (o mesmo do login) o
 * Playwright não escolhe outra instalação; sem ele, cai no `channel`.
 */
export function opcoesDeLancamento(navegador: DefinicaoNavegador, caminho: string | undefined, headless: boolean, timeoutMs: number) {
  return {
    ...(caminho ? { executablePath: caminho } : { channel: navegador.channel }),
    headless,
    viewport: { width: 1280, height: 900 },
    locale: "pt-BR",
    timeout: timeoutMs,
    // Remove a flag que avisa "navegador controlado por software de automação".
    ignoreDefaultArgs: ["--enable-automation"],
  };
}
