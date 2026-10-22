import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  baixarItemEstudio, descreverItem, descreverRelatorio, excluirItemEstudio, exportarItemEstudio, listarEstudio, NOMES_TIPO, renomearItemEstudio, statusEstudio, type RelatorioItem,
} from "../notebook-estudio.js";
import { descreverUso } from "../notebook-base.js";
import { novoPrazo } from "../prazo.js";
import {
  criarProgresso, DESTRUTIVA, ESCRITA, LEITURA, META_UI, tentar, tentarComArquivos,
} from "../respostas.js";
import {
  AVISO_CONTEUDO, linkNotebook, MAX_TEXTO, notebookParam, ONDE_FICAM,
} from "./notebook-comum.js";

// NotebookLM: acompanhar, baixar, exportar, renomear e excluir itens do Estúdio.
export function registrarEstudioItens(servidor: McpServer): void {
  servidor.registerTool(
    "notebook_estudio",
    {
      title: "Listar itens do Estúdio",
      description: "Lista o que já foi gerado no Estúdio do notebook (áudios, vídeos, slides, relatórios…), com estado, duração e id, e mostra o uso da IA.",
      inputSchema: { notebook: notebookParam },
      annotations: LEITURA,
    },
    async ({ notebook }) =>
      tentar(async () => {
        const r = await listarEstudio(novoPrazo(), notebook);
        const linhas = r.itens.length ? [`${r.itens.length} item(ns) no Estúdio do notebook ${r.notebook}:`, ...r.itens.map(descreverItem)] : [`O Estúdio do notebook ${r.notebook} está vazio.`];
        if (r.uso) linhas.push("", `Uso da IA: ${descreverUso(r.uso)}`);
        return linhas.join("\n");
      }),
  );

  const descreverVarios = (rels: RelatorioItem[]) => rels.map((r) => descreverRelatorio(r, MAX_TEXTO)).join("\n\n");

  servidor.registerTool(
    "notebook_estudio_status",
    {
      title: "Acompanhar o Estúdio",
      description: `Acompanha os itens do Estúdio que ainda estavam sendo gerados, espera o que der dentro do tempo da chamada e baixa o que ficar pronto. Repita até não sobrar nada pendente. ${ONDE_FICAM}`,
      inputSchema: { lote: z.string().optional().describe("Opcional: lote, id do item ou id do notebook. Sem isso, cuida de todos os pendentes.") },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async ({ lote }, extra) =>
      tentarComArquivos(async () => {
        const rels = await statusEstudio(novoPrazo(), lote, criarProgresso(extra as never));
        if (!rels.length) return { texto: "Nada pendente no Estúdio.", arquivos: [] };
        const faltam = rels.filter((r) => r.estado === "aguardando").length;
        return { texto: descreverVarios(rels) + (faltam ? "" : "\n\nNada mais pendente."), arquivos: rels.flatMap((r) => r.arquivos) };
      }),
  );

  servidor.registerTool(
    "notebook_estudio_baixar",
    {
      title: "Baixar item do Estúdio",
      description: `Baixa (de novo) um item já gerado no Estúdio pelo título ou id: áudio .m4a, vídeo .mp4, slides (pdf/pptx/imagens + texto), infográfico, e texto de relatório, mapa mental, cartões, teste e tabela. ${ONDE_FICAM}`,
      inputSchema: {
        notebook: notebookParam,
        item: z.string().min(1).describe("Título (ou parte) ou id do item (veja notebook_estudio)."),
        baixar: z.enum(["pdf", "pptx", "pdf_pptx", "imagens"]).optional().describe("Só para slides. Padrão: pdf."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async ({ notebook, item, baixar }) =>
      tentarComArquivos(async () => {
        const r = await baixarItemEstudio(novoPrazo(), notebook, item, baixar);
        return { texto: descreverRelatorio(r, MAX_TEXTO) + (r.texto ? `\n\n${AVISO_CONTEUDO}` : ""), arquivos: r.arquivos, link: linkNotebook(r.lote.notebook) };
      }),
  );

  servidor.registerTool(
    "notebook_exportar",
    {
      title: "Exportar item do Estúdio para o Google Drive",
      description: [
        "Exporta um item já gerado no Estúdio para o Google Drive da conta e devolve o link: relatório (formato documento) → Google Docs ou Planilhas; tabela de dados → Planilhas (os dois pelo próprio NotebookLM, ~5-15 s);",
        "slides → Google Apresentações (o NotebookLM não oferece: o MCP baixa o .pptx, envia ao Drive, converte com 'Salvar como apresentação Google' e manda o .pptx enviado para a lixeira do Drive; ~40-60 s).",
        "No Claude Desktop os slides podem voltar 'em andamento': chame de novo com os MESMOS dados, que continua de onde parou (não envia de novo o que já foi).",
        "Relatório interativo, áudio, vídeo, mapa, cartões e teste não têm exportação para o Google.",
        "Cada exportação concluída cria um arquivo NOVO no Drive (pasta Meu Drive): não repita para o mesmo item sem o usuário pedir.",
      ].join(" "),
      inputSchema: {
        notebook: notebookParam,
        item: z.string().min(1).describe("Título (ou parte) ou id do item (veja notebook_estudio)."),
        destino: z
          .enum(["docs", "planilhas", "apresentacoes"])
          .optional()
          .describe("docs (Google Docs), planilhas (Google Planilhas) ou apresentacoes (Google Apresentações, só slides). Padrão: planilhas para tabela, apresentacoes para slides, docs para relatório."),
      },
      annotations: ESCRITA,
    },
    async ({ notebook, item, destino }, extra) =>
      tentar(async () => {
        const r = await exportarItemEstudio(novoPrazo(), notebook, item, destino, criarProgresso(extra as never));
        const nome = `[${NOMES_TIPO[r.item.tipo]}] "${r.item.titulo}"`;
        if (r.andamento) {
          return [
            `Exportação para o Google Apresentações em andamento: ${nome}.`,
            `Falta: ${r.andamento}. O tempo desta chamada acabou; o que já foi feito está guardado.`,
            ...(r.pptx ? [`.pptx salvo neste PC: ${r.pptx}`] : []),
            `Chame notebook_exportar de novo com os mesmos dados (notebook "${r.notebook}", item "${r.item.id}") para continuar.`,
          ].join("\n");
        }
        const app = { docs: "Google Docs", planilhas: "Google Planilhas", apresentacoes: "Google Apresentações" }[r.destino];
        return [
          `Exportado para o ${app}: ${nome}`,
          `Link: ${r.link}`,
          "O arquivo ficou no Google Drive da conta (Meu Drive), só para você até ser compartilhado.",
          ...(r.pptx ? [`.pptx também salvo neste PC: ${r.pptx}`] : []),
          ...(r.destino === "apresentacoes"
            ? [r.pptxNaLixeira ? "A cópia .pptx enviada ao Drive foi para a lixeira (recuperável por 30 dias)." : "Aviso: a cópia .pptx enviada ao Drive continua em Meu Drive (não consegui mandar para a lixeira)."]
            : []),
        ].join("\n");
      }),
  );

  servidor.registerTool(
    "notebook_estudio_renomear",
    {
      title: "Renomear item do Estúdio",
      description: "Muda o título de um item do Estúdio.",
      inputSchema: { notebook: notebookParam, item: z.string().min(1).describe("Título (ou parte) ou id."), novo_titulo: z.string().min(1).max(300) },
      annotations: ESCRITA,
    },
    async ({ notebook, item, novo_titulo }) => tentar(() => renomearItemEstudio(novoPrazo(), notebook, item, novo_titulo)),
  );

  servidor.registerTool(
    "notebook_estudio_excluir",
    {
      title: "Excluir item do Estúdio",
      description: `Exclui um item do Estúdio (${Object.values(NOMES_TIPO).slice(0, 9).join(", ")}) PERMANENTEMENTE. Só use quando o usuário pedir. Arquivos já baixados no PC não são apagados.`,
      inputSchema: { notebook: notebookParam, item: z.string().min(1).describe("Título (ou parte) ou id."), confirmar: z.literal(true) },
      annotations: DESTRUTIVA,
    },
    async ({ notebook, item }) => tentar(() => excluirItemEstudio(novoPrazo(), notebook, item)),
  );
}
