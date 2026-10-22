import { z } from "zod";
import { formatarTamanho } from "../arquivos.js";
import { MODELOS_FLOW, MODELOS_IMAGEM } from "../seletores.js";
import { PASTA_FLOW } from "../config.js";
import type { Arquivo, RelatorioLote, ResultadoGeracao } from "../flow.js";

// Parâmetros e textos que as ferramentas do Flow compartilham.
export const projetoParam = z
  .string()
  .max(300)
  .optional()
  .describe("Projeto do Flow: id, link ou nome exato (veja flow_projetos). Se omitido, usa o projeto padrão (flow_projeto_padrao; de início 'Claude MCP').");

export function descreverArquivo(a: Arquivo): string {
  const partes: string[] = [];
  if (a.duracao) partes.push(`${a.duracao}s`);
  if (a.largura) partes.push(`${a.largura}x${a.altura}`);
  if (a.audio !== undefined && a.tipo !== "imagem") partes.push(a.audio ? "com áudio" : "sem áudio");
  partes.push(formatarTamanho(a.tamanhoMB), `id ${a.id}`, a.via);
  return `- ${a.caminho}\n  (${partes.join(", ")})`;
}

export function descreverLote(r: RelatorioLote): string {
  const linhas: string[] = [];
  if (r.arquivos.length) linhas.push(`Arquivos salvos:\n${r.arquivos.map(descreverArquivo).join("\n")}`);
  if (r.estado === "aguardando") {
    linhas.push(
      `Ainda em andamento no Flow (lote ${r.lote}${r.custo > 0 ? "; os créditos já foram usados e nada se perde" : ""}):` +
        (r.andamento.length ? `\n- ${r.andamento.join("\n- ")}` : "") +
        `\nChame flow_status para acompanhar e baixar${r.tipo === "imagem" ? "" : " (vídeos levam ~1-3 min; repita se ainda não terminou)"}.`,
    );
  }
  if (r.estado === "falhou") linhas.push(`O lote ${r.lote} terminou sem arquivo: a geração falhou ou não apareceu no Flow. Não adianta repetir flow_status para ele. Confira o saldo com flow_creditos.`);
  if (r.estado === "expirado") linhas.push(`O lote ${r.lote} passou de 2 h sem terminar. Confira no Flow com flow_listar; se aparecer pronto, baixe com flow_baixar.`);
  if (r.avisos.length) linhas.push(`Avisos:\n- ${r.avisos.join("\n- ")}`);
  return linhas.join("\n\n");
}

/** Linha curta para o visualizador quando ainda há coisa gerando. */
export function andamentoDe(rels: RelatorioLote[]): string | undefined {
  const aguardando = rels.filter((r) => r.estado === "aguardando");
  if (!aguardando.length) return undefined;
  return `Ainda gerando no Flow (${aguardando.map((r) => `lote ${r.lote}`).join(", ")}). Peça ao Claude para conferir com flow_status.`;
}

export function descreverGeracao(r: ResultadoGeracao): string {
  const gasto = r.saldoAntes !== null && r.saldoDepois !== null && r.saldoDepois !== r.saldoAntes ? ` (saldo caiu ${r.saldoAntes - r.saldoDepois})` : "";
  const linhas = [
    `Configuração: ${r.configuracao}`,
    `Custo exibido pelo Flow: ${r.custoEstimado} créditos${gasto}`,
  ];
  if (r.saldoAntes !== null) {
    linhas.push(r.saldoDepois !== null ? `Saldo: ${r.saldoAntes} → ${r.saldoDepois}` : `Saldo antes: ${r.saldoAntes} (o desconto aparece em flow_creditos)`);
  }
  if (r.quadros.length) linhas.push(`Referências: ${r.quadros.join(" · ")}`);
  linhas.push(`Projeto no Flow: ${r.projeto}`);
  if (r.avisos.length) linhas.push(`Avisos: ${r.avisos.join(" ")}`);
  return linhas.join("\n") + "\n\n" + descreverLote(r.relatorio);
}

export const ONDE_FICAM = `Os arquivos vão SEMPRE para ${PASTA_FLOW} neste PC, venha o pedido do Claude Code ou do Claude Desktop.`;

export const modeloVideoParam = z
  .enum(Object.keys(MODELOS_FLOW) as [keyof typeof MODELOS_FLOW, ...(keyof typeof MODELOS_FLOW)[]])
  .default("veo-3.1-fast")
  .describe(
    "Modelo. Custo por vídeo (x1): veo-3.1-lite = 10 créditos, veo-3.1-fast = 20, veo-3.1-quality = 100 (todos 8s, 720p, com áudio); omni-1.1-flash = 4 a 15 conforme resolução e duração (4-10s).",
  );

export const modeloImagemParam = z
  .enum(Object.keys(MODELOS_IMAGEM) as [keyof typeof MODELOS_IMAGEM, ...(keyof typeof MODELOS_IMAGEM)[]])
  .default("nano-banana-2")
  .describe("Modelo de imagem: nano-banana-2 (padrão, equilibrado), nano-banana-pro (mais detalhe e texto legível, mais lento), nano-banana-2-lite (mais rápido). Em out/2026 os três custavam 0 créditos.");

export const formatoVideo = {
  modelo: modeloVideoParam,
  proporcao: z
    .enum(["16:9", "9:16"])
    .optional()
    .describe("Proporção. Se omitida, é deduzida do prompt: 'vertical', 'reels', 'tiktok', 'shorts', '9:16' → 9:16; senão 16:9."),
  quantidade: z.number().int().min(1).max(4).default(1).describe("Quantos vídeos gerar com o mesmo prompt (multiplica o custo)."),
  duracao: z
    .number()
    .int()
    .optional()
    .describe("Segundos. Só vale para omni-1.1-flash (4, 6, 8 ou 10). Se omitida, é lida do prompt ('10 segundos'). Os Veo 3.1 são sempre 8s (para mais, use flow_estender_video)."),
  resolucao: z.enum(["360p", "720p"]).optional().describe("Só para omni-1.1-flash. Padrão 720p."),
  projeto: projetoParam,
};

export const personagensParam = z
  .array(z.string().min(1).max(100))
  .max(3)
  .optional()
  .describe(
    "Nomes de personagens do Flow (criados com flow_personagem_criar; veja flow_personagens) para aparecer com a mesma aparência. Cite o nome no prompt (ex.: 'Tatuzinho acena para a câmera'). Para manter roupa/acessórios, crie o corpo inteiro do personagem e prefira veo-3.1-fast ou quality (no Lite detalhes como chapéu podem sumir).",
  );

export const referenciasParam = z
  .array(z.string().min(3).max(1000))
  .max(3)
  .optional()
  .describe(
    "Imagens de referência (até 3): id de uma imagem do projeto (flow_listar) OU caminho completo de PNG/JPG/WebP do PC. O Flow usa como base: editar uma imagem ('a mesma cena à noite'), combinar elementos, manter o estilo ou o produto.",
  );

export const quadroParam = (qual: string) =>
  z
    .string()
    .max(1000)
    .optional()
    .describe(`${qual}: id de uma imagem do projeto (de flow_gerar_imagem ou flow_listar) OU caminho completo de um PNG/JPG/WebP do PC (até 20 MB).`);

