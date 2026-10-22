import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  criarNota, excluirNota, listarNotas, perguntar, ultimaResposta,
} from "../notebooklm.js";
import path from "node:path";
import { limitarTexto } from "../notebook-base.js";
import { nomeArquivo, salvar, tamanhoMB } from "../arquivos.js";
import { PASTA_CONVERSAS, PASTA_ROTEIROS } from "../config.js";
import { escreverRoteiro } from "../notebook-roteiro.js";
import { conversaDoNotebook, conversaEmMarkdown, descreverCitacoes } from "../notebook-conversa.js";
import { novoPrazo } from "../prazo.js";
import {
  DESTRUTIVA, ESCRITA, LEITURA, META_UI, tentar, tentarComArquivos,
} from "../respostas.js";
import {
  AVISO_CONTEUDO, descreverResposta, linkNotebook, MAX_TEXTO, notebookParam,
} from "./notebook-comum.js";

// NotebookLM: chat com as fontes, roteiro (pesquisa para vídeo) e notas.
export function registrarConversaRoteiroNotas(servidor: McpServer): void {
  // ---------- Chat ----------

  servidor.registerTool(
    "notebook_perguntar",
    {
      title: "Perguntar ao notebook",
      description: [
        "Faz uma pergunta ao notebook e devolve a resposta com as citações [n] e, para cada uma, o trecho exato da fonte (citação completa).",
        "O chat do notebook guarda o histórico, então perguntas de acompanhamento mantêm o contexto.",
        "Opcional: perguntar só a algumas fontes e salvar a resposta como nota.",
        "Se a resposta demorar mais que o tempo da chamada, volta 'ainda escrevendo': aí chame notebook_resposta.",
        AVISO_CONTEUDO,
      ].join(" "),
      inputSchema: {
        notebook: notebookParam,
        pergunta: z.string().min(1).max(10000).describe("Pergunta em português."),
        fontes: z.array(z.string().min(1)).min(1).max(50).optional().describe("Só estas fontes (títulos ou ids). Padrão: todas."),
        salvar_nota: z.boolean().default(false).describe("Salvar a resposta como nota do notebook."),
      },
      annotations: ESCRITA,
    },
    async ({ notebook, pergunta, fontes, salvar_nota }) =>
      tentar(async () => descreverResposta(await perguntar(novoPrazo(), notebook, pergunta, { fontes, salvarNota: salvar_nota }))),
  );

  servidor.registerTool(
    "notebook_resposta",
    {
      title: "Ler a última resposta",
      description: `Lê a última resposta do chat de um notebook, esperando terminar se ainda estiver sendo escrita. Use depois de notebook_perguntar responder 'ainda escrevendo'. ${AVISO_CONTEUDO}`,
      inputSchema: { notebook: notebookParam, salvar_nota: z.boolean().default(false).describe("Salvar a resposta como nota do notebook.") },
      annotations: ESCRITA, // com salvar_nota cria uma nota
    },
    async ({ notebook, salvar_nota }) => tentar(async () => descreverResposta(await ultimaResposta(novoPrazo(), notebook, salvar_nota))),
  );

  servidor.registerTool(
    "notebook_conversa",
    {
      title: "Salvar a conversa do chat",
      description: [
        "Lê o histórico INTEIRO do chat de um notebook (todas as perguntas e respostas, com o trecho exato da fonte de cada citação [n]) e salva num arquivo Markdown.",
        `Arquivo em ${PASTA_CONVERSAS} (um por chamada, com data e hora). Não pergunta nada ao NotebookLM e não gasta o limite de uso.`,
        AVISO_CONTEUDO,
      ].join(" "),
      inputSchema: { notebook: notebookParam },
      annotations: LEITURA, // no Google só lê; o arquivo fica neste PC
      _meta: META_UI,
    },
    async ({ notebook }) =>
      tentarComArquivos(async () => {
        const c = await conversaDoNotebook(novoPrazo(), notebook);
        if (!c.trocas.length) return { texto: `O chat do notebook "${c.titulo}" está vazio: nada para salvar.`, arquivos: [], link: linkNotebook(c.notebook) };
        const md = conversaEmMarkdown(c);
        const caminho = salvar(nomeArquivo(`conversa ${c.titulo}`, "md"), md, PASTA_CONVERSAS);
        const citacoes = c.trocas.reduce((s, t) => s + t.citacoes.length, 0);
        return {
          texto: [
            `Conversa salva em ${caminho}`,
            `${c.trocas.length} pergunta(s) e ${citacoes} citação(ões) com o trecho da fonte, do notebook "${c.titulo}".`,
            "",
            "Perguntas:",
            ...c.trocas.map((t, i) => `${i + 1}. ${t.pergunta.replace(/\s+/g, " ").slice(0, 120) || "(pergunta não encontrada)"}${t.resposta ? "" : " — sem resposta"}`),
            "",
            "Conteúdo:",
            limitarTexto(md, MAX_TEXTO, caminho),
            "",
            AVISO_CONTEUDO,
          ].join("\n"),
          arquivos: [{ caminho, id: path.basename(caminho, ".md"), tipo: "documento", via: "chat do NotebookLM", tamanhoMB: tamanhoMB(caminho) }],
          link: linkNotebook(c.notebook),
        };
      }),
  );

  // ---------- Roteiro (pesquisa → roteiro → vídeo) ----------

  servidor.registerTool(
    "notebook_roteiro",
    {
      title: "Roteiro de vídeo curto pelo NotebookLM",
      description: [
        "Escreve, com o NotebookLM e as fontes do notebook, o roteiro de um vídeo curto de curiosidade (~30 s) no formato do modo apresentador do flow_video_longo: fato, trecho literal da fonte (checagem), cenário, falas no tamanho certo e legenda.",
        "Fluxo completo: notebook_criar → notebook_pesquisar_fontes (pesquisa rápida sobre o tema) → notebook_roteiro → flow_video_longo com o cenario e as falas devolvidos (Veo Fast, 9:16).",
        `Salva o roteiro em ${PASTA_ROTEIROS} (01-…, 02-…). Não gera vídeo nem gasta créditos do Flow; usa o chat do NotebookLM.`,
        "ANTES de gerar o vídeo, compare as falas com o TRECHO da fonte: o NotebookLM às vezes exagera (ex.: 'o maior', ou tira condições como 'em cativeiro'). Se precisar, corrija as falas ao chamar o flow_video_longo.",
        "Se a resposta demorar mais que a chamada, volta 'ainda escrevendo': chame de novo com continuar=true e os mesmos dados (não pergunte de novo).",
        AVISO_CONTEUDO,
      ].join(" "),
      inputSchema: {
        notebook: notebookParam,
        personagem: z.string().min(3).max(300).describe("Quem apresenta, com aparência (ex.: 'Seu Jabuti, um jabuti de animação 3D fofo e sábio, de óculos redondos')."),
        tema: z.string().max(500).optional().describe("Assunto ou curiosidade. Sem isso, o NotebookLM escolhe a mais surpreendente das fontes."),
        lugar: z.string().max(300).optional().describe("Onde o personagem está (ex.: 'jardim tropical ensolarado')."),
        falas: z.number().int().min(2).max(8).default(4).describe("Número de falas = trechos do vídeo (4 ≈ 29 s, 5 ≈ 36 s)."),
        voz: z.string().max(40).optional().describe("Voz do Flow sugerida para o vídeo (veja flow_vozes); vai no arquivo do roteiro."),
        titulo: z.string().max(80).optional().describe("Nome do roteiro (vira o nome do arquivo)."),
        fontes: z.array(z.string().min(1)).min(1).max(50).optional().describe("Usar só estas fontes (títulos ou ids). Padrão: todas."),
        continuar: z.boolean().default(false).describe("true = lê a resposta que ficou sendo escrita (depois de 'ainda escrevendo')."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a) =>
      tentarComArquivos(async () => {
        const r = await escreverRoteiro(
          novoPrazo(),
          { notebook: a.notebook, personagem: a.personagem, tema: a.tema, lugar: a.lugar, falas: a.falas, voz: a.voz, titulo: a.titulo, fontes: a.fontes },
          a.continuar,
        );
        if (r.pendente || !r.roteiro || !r.arquivo) {
          return {
            texto: `O NotebookLM ainda está escrevendo o roteiro (continua no Google). Chame notebook_roteiro de novo com continuar=true e os mesmos dados (notebook "${r.notebook}") em alguns segundos. Não pergunte de novo.`,
            arquivos: [],
          };
        }
        const rt = r.roteiro;
        const pedido = { titulo: r.titulo, cenario: rt.cenario, falas: rt.falas, modelo: "veo-3.1-fast", proporcao: "9:16", ...(a.voz ? { voz: a.voz } : {}) };
        return {
          texto: [
            `Roteiro salvo em ${r.arquivo.caminho}`,
            "",
            `FATO: ${rt.fato}`,
            `TRECHO DA FONTE: ${rt.trecho || "(não veio — confira nas fontes)"}`,
            ...(r.trechos?.length
              ? ["", "Trechos citados (como estão nas fontes):", descreverCitacoes(r.trechos, 800)]
              : r.citacoes.length
                ? ["Fontes citadas:", ...r.citacoes]
                : []),
            "",
            `CENÁRIO: ${rt.cenario}`,
            ...rt.falas.map((f, i) => `FALA ${i + 1}: ${f}`),
            `LEGENDA: ${rt.legenda}`,
            ...(r.avisos.length ? ["", "Avisos:", ...r.avisos.map((x) => `- ${x}`)] : []),
            "",
            `Confira as falas contra o TRECHO antes de gerar. Para o vídeo (~${20 + 10 * (rt.falas.length - 1)} créditos da cota diária; sem teto, não precisa pedir aprovação de custo; se o usuário só pediu o roteiro, mostre-o antes), chame flow_video_longo com:`,
            JSON.stringify(pedido),
            "",
            AVISO_CONTEUDO,
          ].join("\n"),
          arquivos: [r.arquivo],
          link: linkNotebook(r.notebook),
        };
      }),
  );

  // ---------- Notas ----------

  servidor.registerTool(
    "notebook_notas",
    {
      title: "Listar notas",
      description: `Lista as notas do notebook com o texto de cada uma. ${AVISO_CONTEUDO}`,
      inputSchema: { notebook: notebookParam },
      annotations: LEITURA,
    },
    async ({ notebook }) =>
      tentar(async () => {
        const { id, notas } = await listarNotas(novoPrazo(), notebook);
        if (!notas.length) return `O notebook ${id} não tem notas.`;
        return [`${notas.length} nota(s) no notebook ${id}:`, ...notas.map((n) => `\n## ${n.titulo} (id ${n.id})\n${n.texto.slice(0, 5000)}${n.texto.length > 5000 ? "\n[…]" : ""}`)].join("\n");
      }),
  );

  servidor.registerTool(
    "notebook_nota_criar",
    {
      title: "Criar nota",
      description: "Cria uma nota no notebook (título e texto). Opcional: converter a nota em fonte, para o chat e o Estúdio usarem o conteúdo.",
      inputSchema: {
        notebook: notebookParam,
        titulo: z.string().min(1).max(200),
        texto: z.string().min(1).max(100000),
        converter_em_fonte: z.boolean().default(false),
      },
      annotations: ESCRITA,
    },
    async ({ notebook, titulo, texto, converter_em_fonte }) => tentar(() => criarNota(novoPrazo(), notebook, titulo, texto, converter_em_fonte)),
  );

  servidor.registerTool(
    "notebook_nota_excluir",
    {
      title: "Excluir nota",
      description: "Exclui uma nota do notebook PERMANENTEMENTE. Só use quando o usuário pedir.",
      inputSchema: { notebook: notebookParam, nota: z.string().min(1).describe("Título (ou parte) ou id da nota."), confirmar: z.literal(true) },
      annotations: DESTRUTIVA,
    },
    async ({ notebook, nota }) => tentar(() => excluirNota(novoPrazo(), notebook, nota)),
  );
}
