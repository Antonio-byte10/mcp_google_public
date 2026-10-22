import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gerarItemEstudio, type PedidoEstudio } from "../notebook-estudio.js";
import { OPCOES_ESTUDIO, type TipoEstudio } from "../seletores.js";
import { novoPrazo } from "../prazo.js";
import {
  criarProgresso, ESCRITA, META_UI, tentarComArquivos,
} from "../respostas.js";
import {
  chaves, linkNotebook, lista, notebookParam, ONDE_FICAM,
} from "./notebook-comum.js";
import { descreverGeracaoEstudio } from "./notebook-comum-estudio.js";

// NotebookLM: geração dos itens do Estúdio (áudio, vídeo, slides, relatório...).
export function registrarEstudioGerar(servidor: McpServer): void {
  // ---------- Estúdio ----------

  const comuns = {
    notebook: notebookParam,
    idioma: z.string().max(40).optional().describe("Idioma do resultado (ex.: pt-BR, en, es, fr, ou o nome como aparece no NotebookLM). Padrão: o do notebook (português)."),
    fontes: z.array(z.string().min(1)).min(1).max(50).optional().describe("Usar só estas fontes (títulos ou ids). Padrão: todas."),
    uso_maximo: z.number().min(1).max(100).optional().describe("Trava: não gera se o uso da IA (limite atual) passar desta % somando o estimado do item. Veja notebook_uso."),
  };
  const quantidade = z.enum(chaves(OPCOES_ESTUDIO.quantidade)).optional();
  const dificuldade = z.enum(chaves(OPCOES_ESTUDIO.dificuldade)).optional().describe(lista(OPCOES_ESTUDIO.dificuldade));
  const DEMORA = "No Claude Desktop (limite de ~50 s por chamada) a resposta costuma vir 'ainda gerando': chame notebook_estudio_status até baixar. No Claude Code a chamada já espera.";

  const gerar = (tipo: TipoEstudio) => async (a: Record<string, unknown>, extra: unknown) =>
    tentarComArquivos(async () => {
      const pedido: PedidoEstudio = {
        notebook: a.notebook as string, tipo, idioma: a.idioma as string | undefined, fontes: a.fontes as string[] | undefined, foco: a.foco as string | undefined,
        usoMaximo: a.uso_maximo as number | undefined, formato: a.formato as string | undefined, duracao: a.duracao as PedidoEstudio["duracao"],
        estilo: a.estilo as string | undefined, estiloPersonalizado: a.estilo_personalizado as string | undefined, orientacao: a.orientacao as PedidoEstudio["orientacao"],
        detalhe: a.detalhe as PedidoEstudio["detalhe"], quantidade: a.quantidade as PedidoEstudio["quantidade"], dificuldade: a.dificuldade as PedidoEstudio["dificuldade"],
        tiposPergunta: a.tipos_pergunta as PedidoEstudio["tiposPergunta"], modelo: a.modelo as string | undefined, baixar: a.baixar as PedidoEstudio["baixar"],
      };
      const r = await gerarItemEstudio(pedido, novoPrazo(), criarProgresso(extra as never));
      return { texto: descreverGeracaoEstudio(r), arquivos: r.relatorio.arquivos, link: linkNotebook(r.notebook), andamento: r.relatorio.estado === "aguardando" ? "Ainda gerando no NotebookLM. Peça ao Claude para conferir com notebook_estudio_status." : undefined };
    });

  servidor.registerTool(
    "notebook_gerar_audio",
    {
      title: "Gerar Resumo em Áudio",
      description: `Gera um Resumo em Áudio (podcast com apresentadores de IA) a partir das fontes e salva o .m4a. Leva ~3-6 min. ${DEMORA} ${ONDE_FICAM}`,
      inputSchema: {
        ...comuns,
        formato: z.enum(chaves(OPCOES_ESTUDIO.formatoAudio)).optional().describe(`${lista(OPCOES_ESTUDIO.formatoAudio)}. Padrão: análise detalhada.`),
        duracao: z.enum(chaves(OPCOES_ESTUDIO.duracao)).optional().describe("curto ou padrao (não existe no formato 'resumo')."),
        foco: z.string().max(5000).optional().describe("Em que os apresentadores devem se concentrar."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    gerar("audio"),
  );

  servidor.registerTool(
    "notebook_gerar_video",
    {
      title: "Gerar Resumo em Vídeo",
      description: `Gera um Resumo em Vídeo (vídeo narrado com slides/ilustrações) e salva o .mp4. Leva de ~5 a 20 min (no Google) e gasta ~9-11% do limite de uso. ${DEMORA} ${ONDE_FICAM}`,
      inputSchema: {
        ...comuns,
        formato: z.enum(chaves(OPCOES_ESTUDIO.formatoVideo)).optional().describe(`${lista(OPCOES_ESTUDIO.formatoVideo)}. Padrão: curto.`),
        estilo: z.enum(chaves(OPCOES_ESTUDIO.estiloVideo)).optional().describe(`Só no explicativo: ${lista(OPCOES_ESTUDIO.estiloVideo)}.`),
        estilo_personalizado: z.string().max(2000).optional().describe("Só no explicativo: descreva o estilo visual (ex.: 'ilustração de livro infantil')."),
        foco: z.string().max(5000).optional().describe("Assunto/foco do vídeo."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    gerar("video"),
  );

  servidor.registerTool(
    "notebook_gerar_slides",
    {
      title: "Gerar apresentação de slides",
      description: `Gera uma apresentação de slides a partir das fontes e salva o PDF (ou PPTX, ou as imagens), além do texto de cada slide em .md. Leva ~4-7 min. ${DEMORA} ${ONDE_FICAM}`,
      inputSchema: {
        ...comuns,
        formato: z.enum(chaves(OPCOES_ESTUDIO.formatoSlides)).optional().describe(`${lista(OPCOES_ESTUDIO.formatoSlides)}. Padrão: detalhada.`),
        duracao: z.enum(chaves(OPCOES_ESTUDIO.duracao)).optional().describe("curto ou padrao (número de slides)."),
        foco: z.string().max(5000).optional().describe("Público, estilo e foco (ex.: 'para iniciantes, estilo divertido')."),
        baixar: z.enum(["pdf", "pptx", "pdf_pptx", "imagens"]).default("pdf").describe("O que salvar: pdf, pptx (PowerPoint), pdf_pptx ou imagens (PNG de cada slide)."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    gerar("slides"),
  );

  servidor.registerTool(
    "notebook_gerar_mapa_mental",
    {
      title: "Gerar mapa mental",
      description: `Gera um mapa mental das fontes (~10-30 s) e devolve a árvore em texto; salva .md e .json. ${ONDE_FICAM}`,
      inputSchema: { ...comuns, foco: z.string().max(5000).optional().describe("Tema ou recorte do mapa.") },
      annotations: ESCRITA,
    },
    gerar("mapa_mental"),
  );

  servidor.registerTool(
    "notebook_gerar_relatorio",
    {
      title: "Gerar relatório",
      description: [
        "Gera um relatório (~30-90 s) e devolve o texto; salva .md (documento) ou .html (interativo).",
        "Modelos do formato documento: \"Documento de resumo\" (padrão), \"Guia de estudo\", \"Post de blog\", \"Crie do zero\" (exige foco) e outros sugeridos pelo NotebookLM para as fontes (o erro lista os disponíveis).",
        ONDE_FICAM,
      ].join(" "),
      inputSchema: {
        ...comuns,
        formato: z.enum(chaves(OPCOES_ESTUDIO.formatoRelatorio)).default("documento").describe("documento (texto) ou interativo (com conteúdo do Estúdio incorporado)."),
        modelo: z.string().max(200).optional().describe("Nome do modelo (ver descrição)."),
        foco: z.string().max(10000).optional().describe("Instruções extras: estrutura, estilo, tom, público. Obrigatório no 'Crie do zero'."),
      },
      annotations: ESCRITA,
    },
    gerar("relatorio"),
  );

  servidor.registerTool(
    "notebook_gerar_cartoes",
    {
      title: "Gerar cartões didáticos",
      description: `Gera cartões didáticos (flashcards, ~30 s) e devolve frente/verso; salva .md e .csv (importável no Anki). ${ONDE_FICAM}`,
      inputSchema: {
        ...comuns,
        quantidade: quantidade.describe("menos, padrao ou mais cartões."),
        dificuldade,
        foco: z.string().max(5000).optional().describe("Tema dos cartões (ex.: 'termos técnicos na frente, definição atrás')."),
      },
      annotations: ESCRITA,
    },
    gerar("cartoes"),
  );

  servidor.registerTool(
    "notebook_gerar_teste",
    {
      title: "Gerar teste (quiz)",
      description: `Gera um teste (~30 s) e devolve as questões com alternativas, resposta certa, explicação, dica e gabarito; salva .md e .json. ${ONDE_FICAM}`,
      inputSchema: {
        ...comuns,
        quantidade: quantidade.describe("menos, padrao ou mais questões."),
        dificuldade,
        tipos_pergunta: z.array(z.enum(chaves(OPCOES_ESTUDIO.tiposPergunta))).min(1).optional().describe(lista(OPCOES_ESTUDIO.tiposPergunta)),
        foco: z.string().max(5000).optional().describe("Tema das questões."),
      },
      annotations: ESCRITA,
    },
    gerar("teste"),
  );

  servidor.registerTool(
    "notebook_gerar_infografico",
    {
      title: "Gerar infográfico",
      description: `Gera um infográfico (imagem, ~1-2 min) e salva o PNG, com a descrição do conteúdo. ${ONDE_FICAM}`,
      inputSchema: {
        ...comuns,
        orientacao: z.enum(chaves(OPCOES_ESTUDIO.orientacao)).optional().describe(lista(OPCOES_ESTUDIO.orientacao)),
        estilo: z.enum(chaves(OPCOES_ESTUDIO.estiloInfografico)).optional().describe(lista(OPCOES_ESTUDIO.estiloInfografico)),
        detalhe: z.enum(chaves(OPCOES_ESTUDIO.detalhe)).optional().describe(lista(OPCOES_ESTUDIO.detalhe)),
        foco: z.string().max(5000).optional().describe("Estilo, cores e foco (ex.: 'tema azul, destaque 3 estatísticas')."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    gerar("infografico"),
  );

  servidor.registerTool(
    "notebook_gerar_tabela",
    {
      title: "Gerar tabela de dados",
      description: `Gera uma tabela de dados a partir das fontes (~30 s) e devolve em Markdown; salva .csv e .md. ${ONDE_FICAM}`,
      inputSchema: { ...comuns, foco: z.string().max(5000).optional().describe("Que tabela criar (colunas, agrupamento). Ex.: 'descobertas: título, autor, resultado'.") },
      annotations: ESCRITA,
    },
    gerar("tabela"),
  );
}
