import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PASTA_SAIDAS, TETO_DIARIO } from "./config.js";
import { conferirTetoDiario, descreverTeto } from "./teto.js";

// Gastos de créditos do Flow, a partir do registro saidas/geracoes.jsonl, e o teto diário
// (src/teto.ts; padrão 200 créditos, MCP_GOOGLE_TETO_DIARIO muda ou desliga).
//
// Desde a 0.7.0 cada envio grava uma linha { acao: "enviado", lote, custo, … } no momento em que os
// créditos são gastos. Linhas antigas (sem "acao") só registravam o lote quando terminava; elas
// contam para o histórico apenas se não houver "enviado" do mesmo lote.

export interface Gasto {
  quando: Date;
  lote: string;
  tipo: string;
  modelo: string;
  custo: number;
  prompt: string;
}

function lerRegistro(): Record<string, unknown>[] {
  const arquivo = path.join(PASTA_SAIDAS, "geracoes.jsonl");
  if (!existsSync(arquivo)) return [];
  return readFileSync(arquivo, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((linha) => {
      try {
        return [JSON.parse(linha) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

export function lerGastos(): Gasto[] {
  const linhas = lerRegistro().filter((e) => e.servico !== "notebooklm" && typeof e.lote === "string" && typeof e.custo === "number");
  const enviados = new Set(linhas.filter((e) => e.acao === "enviado").map((e) => e.lote as string));
  // Pedido que o Flow não aceitou (sem resposta ou recusado): os créditos não foram gastos.
  const naoGastos = new Set(lerRegistro().filter((e) => e.estado === "sem-resposta" || e.estado === "recusada").map((e) => String(e.lote)));
  return linhas
    .filter((e) => !naoGastos.has(e.lote as string))
    .filter((e) => e.acao === "enviado" || (!e.acao && !enviados.has(e.lote as string)))
    .map((e) => ({
      quando: new Date(String(e.quando)),
      lote: String(e.lote),
      tipo: String(e.tipo ?? ""),
      modelo: String(e.modelo ?? ""),
      custo: Number(e.custo),
      prompt: String(e.prompt ?? ""),
    }));
}

/** Dia local "AAAA-MM-DD" (o dia vira à meia-noite do horário do PC). */
export function diaLocal(d: Date): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function gastoDeHoje(): number {
  const hoje = diaLocal(new Date());
  return lerGastos().filter((g) => diaLocal(g.quando) === hoje).reduce((s, g) => s + g.custo, 0);
}

/** Barra, antes de enviar, o que passaria do teto diário (custo estimado do pedido inteiro). */
export function conferirTetoDeHoje(custo: number): void {
  conferirTetoDiario(custo, gastoDeHoje(), TETO_DIARIO);
}

/** Linha curta do gasto de hoje e do teto. */
export function descreverGastoDeHoje(): string {
  return `Gasto de hoje (por este MCP): ${gastoDeHoje()} créditos; ${descreverTeto(TETO_DIARIO)}.`;
}

export function relatorioDeGastos(dias: number): string {
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - (dias - 1));
  const gastos = lerGastos().filter((g) => g.quando >= desde);
  const linhas = [`Gastos de créditos do Flow nos últimos ${dias} dia(s) (pelo registro deste PC):`];
  if (!gastos.length) {
    linhas.push("- nenhuma geração paga registrada.");
  } else {
    const total = gastos.reduce((s, g) => s + g.custo, 0);
    const porDia = new Map<string, { custo: number; n: number }>();
    const porModelo = new Map<string, { custo: number; n: number }>();
    for (const g of gastos) {
      const d = porDia.get(diaLocal(g.quando)) ?? { custo: 0, n: 0 };
      porDia.set(diaLocal(g.quando), { custo: d.custo + g.custo, n: d.n + 1 });
      const chave = `${g.tipo} · ${g.modelo}`;
      const m = porModelo.get(chave) ?? { custo: 0, n: 0 };
      porModelo.set(chave, { custo: m.custo + g.custo, n: m.n + 1 });
    }
    linhas.push(`Total: ${total} créditos em ${gastos.length} geração(ões).`, "", "Por dia:");
    for (const [dia, v] of [...porDia].sort()) linhas.push(`- ${dia.split("-").reverse().join("/")}: ${v.custo} créditos (${v.n})`);
    linhas.push("", "Por tipo e modelo:");
    for (const [chave, v] of [...porModelo].sort((a, b) => b[1].custo - a[1].custo)) linhas.push(`- ${chave}: ${v.custo} créditos (${v.n})`);
    const caras = gastos.filter((g) => g.custo > 0).sort((a, b) => b.custo - a.custo).slice(0, 5);
    if (caras.length) {
      linhas.push("", "Mais caras:");
      for (const g of caras) linhas.push(`- ${g.custo} · ${g.modelo} · ${diaLocal(g.quando).split("-").reverse().join("/")} · "${g.prompt.slice(0, 70)}"`);
    }
  }
  linhas.push("", descreverGastoDeHoje(), "Saldo atual na conta: use flow_creditos (gerações feitas fora deste MCP não aparecem aqui).");
  return linhas.join("\n");
}
