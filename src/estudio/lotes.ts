import path from "node:path";
import { PASTA_SAIDAS } from "../config.js";
import type { LoteEstudio, RelatorioItem } from "./tipos.js";
import { existsSync, readFileSync } from "node:fs";
import { comTravaDeArquivo, gravarJsonAtomico } from "../trava-arquivo.js";

// Lotes: gerações que passaram do tempo da chamada, guardadas em disco para a próxima chamada continuar.

export const ARQUIVO_LOTES = () => path.join(PASTA_SAIDAS, "pendentes-notebook.json");
export const VALIDADE_LOTE_MS = 6 * 60 * 60 * 1000;

export function lerLotes(): LoteEstudio[] {
  if (!existsSync(ARQUIVO_LOTES())) return [];
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO_LOTES(), "utf8"));
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

export function salvarLotes(lotes: LoteEstudio[]): void {
  gravarJsonAtomico(ARQUIVO_LOTES(), lotes);
}

/** Lê, altera e grava a lista de lotes sob a trava do arquivo. */
export function alterarLotesEstudio(mudar: (lotes: LoteEstudio[]) => LoteEstudio[]): void {
  comTravaDeArquivo(ARQUIVO_LOTES(), () => salvarLotes(mudar(lerLotes())));
}

export function atualizarLotes(relatorios: RelatorioItem[]): void {
  const resolvidos = new Set(relatorios.filter((r) => r.estado !== "aguardando").map((r) => r.lote.lote));
  const novos = relatorios.filter((r) => r.estado === "aguardando").map((r) => r.lote);
  alterarLotesEstudio((atuais) => [...atuais.filter((l) => !resolvidos.has(l.lote) && !novos.some((n) => n.lote === l.lote)), ...novos]);
}


export function pendentesEstudio(): number {
  return lerLotes().length;
}
