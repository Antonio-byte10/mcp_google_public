// Teto diário de créditos do Flow gastos por este MCP (desde a 0.16.0). Protege quem instala o
// projeto de gastar créditos sem perceber; quem quiser outro valor (ou nenhum) define
// MCP_GOOGLE_TETO_DIARIO. Regras puras (test/pastas-teto.test.mjs).

/** Créditos por dia quando a variável não está definida (~10 vídeos Fast ou 4 vídeos longos de TikTok). */
export const TETO_DIARIO_PADRAO = 200;

/** Lê MCP_GOOGLE_TETO_DIARIO: número inteiro ≥ 0, ou "sem" para nenhum teto (null). Valor inválido = erro na partida. */
export function lerTetoDiario(texto: string | undefined): number | null {
  const valor = texto?.trim().toLowerCase();
  if (!valor) return TETO_DIARIO_PADRAO;
  if (valor === "sem") return null;
  if (!/^\d+$/.test(valor)) throw new Error(`MCP_GOOGLE_TETO_DIARIO inválido: "${texto}". Use um número de créditos por dia (ex.: 200) ou "sem".`);
  return Number(valor);
}

/** Barra a geração (antes de enviar) se ela passaria do teto do dia. Custo 0 sempre passa. */
export function conferirTetoDiario(custo: number, gastoHoje: number, teto: number | null): void {
  if (teto === null || custo <= 0 || gastoHoje + custo <= teto) return;
  throw new Error(
    `Teto diário do mcp-google: hoje já foram ${gastoHoje} créditos e esta geração custa ${custo}, passando do teto de ${teto}. Nada foi gerado. Para mudar o teto, defina MCP_GOOGLE_TETO_DIARIO no registro do MCP (número de créditos ou "sem").`,
  );
}

/** Linha para as instruções e relatórios. */
export function descreverTeto(teto: number | null): string {
  return teto === null ? "sem teto diário (MCP_GOOGLE_TETO_DIARIO=sem)" : `teto diário de ${teto} créditos (MCP_GOOGLE_TETO_DIARIO)`;
}
