import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  configurarChat, criarNotebook, excluirNotebook, listarNotebooks, renomearNotebook, usoNotebook,
} from "../notebooklm.js";
import {
  adicionarFonte, descreverFonte, descreverLeitura, lerConteudoFonte, listarFontes, removerFontes, renomearFonte,
} from "../notebook-fontes.js";
import { descreverUso } from "../notebook-base.js";
import { pesquisarFontes } from "../notebook-pesquisa.js";
import { OPCOES_ESTUDIO } from "../seletores.js";
import { novoPrazo } from "../prazo.js";
import {
  criarProgresso, DESTRUTIVA, ESCRITA, LEITURA, tentar,
} from "../respostas.js";
import {
  AVISO_CONTEUDO, chaves, lista, notebookParam,
} from "./notebook-comum.js";

// NotebookLM: notebooks (criar, renomear, excluir, chat, uso) e fontes.
export function registrarNotebooksEFontes(servidor: McpServer): void {
  // ---------- Notebooks ----------

  servidor.registerTool(
    "notebook_listar",
    {
      title: "Listar notebooks",
      description: "Lista os notebooks do NotebookLM (Gemini Notebook) do usuário, com id, título, data e número de fontes.",
      annotations: LEITURA,
    },
    async () =>
      tentar(async () => {
        const nbs = await listarNotebooks(novoPrazo());
        if (!nbs.length) return "Nenhum notebook encontrado.";
        return nbs.map((n) => `- ${n.titulo} (${n.detalhes}) id: ${n.id}`).join("\n");
      }),
  );

  servidor.registerTool(
    "notebook_criar",
    {
      title: "Criar notebook",
      description: "Cria um notebook novo no NotebookLM. Sem título, o Google dá um nome automático depois da primeira fonte.",
      inputSchema: { titulo: z.string().max(200).optional().describe("Título do notebook.") },
      annotations: ESCRITA,
    },
    async ({ titulo }) =>
      tentar(async () => {
        const n = await criarNotebook(novoPrazo(), titulo);
        return `Notebook criado: ${n.titulo}\nid: ${n.id}\n${n.detalhes}`;
      }),
  );

  servidor.registerTool(
    "notebook_renomear",
    {
      title: "Renomear notebook",
      description: "Muda o título de um notebook.",
      inputSchema: { notebook: notebookParam, titulo: z.string().min(1).max(200).describe("Novo título.") },
      annotations: ESCRITA,
    },
    async ({ notebook, titulo }) => tentar(() => renomearNotebook(novoPrazo(), notebook, titulo)),
  );

  servidor.registerTool(
    "notebook_excluir",
    {
      title: "Excluir notebook",
      description: "Exclui um notebook PERMANENTEMENTE (com fontes, chat, notas e itens do Estúdio). Só use quando o usuário pedir explicitamente e confirmar qual notebook.",
      inputSchema: { notebook: notebookParam, confirmar: z.literal(true).describe("Precisa ser true: confirma que o usuário pediu a exclusão.") },
      annotations: DESTRUTIVA,
    },
    async ({ notebook }) => tentar(() => excluirNotebook(novoPrazo(), notebook)),
  );

  servidor.registerTool(
    "notebook_configurar_chat",
    {
      title: "Configurar o chat do notebook",
      description: "Define como o chat do notebook responde: objetivo (padrão, guia de aprendizado ou personalizado com instruções próprias, até 10.000 caracteres) e tamanho das respostas.",
      inputSchema: {
        notebook: notebookParam,
        objetivo: z.enum(chaves(OPCOES_ESTUDIO.objetivoChat)).optional().describe(lista(OPCOES_ESTUDIO.objetivoChat)),
        instrucoes: z.string().max(10000).optional().describe("Papel, estilo ou objetivo (ex.: 'responda como professor de biologia do ensino médio'). Liga o modo personalizado."),
        tamanho: z.enum(chaves(OPCOES_ESTUDIO.tamanhoChat)).optional().describe(lista(OPCOES_ESTUDIO.tamanhoChat)),
      },
      annotations: ESCRITA,
    },
    async ({ notebook, ...config }) =>
      tentar(async () => {
        if (!config.objetivo && !config.instrucoes && !config.tamanho) throw new Error("Informe objetivo, instrucoes ou tamanho.");
        return configurarChat(novoPrazo(), notebook, config);
      }),
  );

  servidor.registerTool(
    "notebook_uso",
    {
      title: "Uso da IA do NotebookLM",
      description: "Mostra quanto do limite de uso da IA do NotebookLM já foi gasto (limite atual, que renova a cada poucas horas, e limite semanal). O Estúdio (principalmente vídeo, slides e áudio) consome esse limite.",
      annotations: LEITURA,
    },
    async () => tentar(async () => `NotebookLM — ${descreverUso(await usoNotebook(novoPrazo()))}`),
  );

  // ---------- Fontes ----------

  servidor.registerTool(
    "notebook_fontes",
    {
      title: "Listar fontes de um notebook",
      description: "Lista as fontes do notebook com tipo (site, YouTube, PDF, arquivo, texto, Drive…), tamanho, estado e link.",
      inputSchema: { notebook: notebookParam },
      annotations: LEITURA,
    },
    async ({ notebook }) =>
      tentar(async () => {
        const { id, titulo, fontes } = await listarFontes(novoPrazo(), notebook);
        if (!fontes.length) return `O notebook "${titulo}" (${id}) não tem fontes.`;
        return [`"${titulo}" (${id}) tem ${fontes.length} fontes:`, ...fontes.map((f, i) => descreverFonte(f, i + 1))].join("\n");
      }),
  );

  servidor.registerTool(
    "notebook_adicionar_fonte",
    {
      title: "Adicionar fonte",
      description: [
        "Adiciona fontes a um notebook. Use UM tipo por chamada:",
        "url (site ou YouTube; aceita vários links), texto (colado), arquivos (caminhos completos no PC: PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, EPUB, imagens, áudio MP3/WAV/M4A…, até 200 MB cada)",
        "ou drive (nome exato ou link de um arquivo do Google Drive do usuário).",
        "Espera o NotebookLM processar e diz o tipo e o tamanho de cada fonte nova.",
      ].join(" "),
      inputSchema: {
        notebook: notebookParam,
        url: z.union([z.string().url(), z.array(z.string().url()).min(1).max(50)]).optional().describe("Link (ou lista de links) de site ou vídeo do YouTube."),
        texto: z.string().max(500000).optional().describe("Texto a ser colado como fonte."),
        arquivos: z.array(z.string().min(3).max(1000)).min(1).max(20).optional().describe("Caminhos completos de arquivos do PC (ex.: C:\\Users\\...\\relatorio.pdf)."),
        drive: z.string().min(1).max(500).optional().describe("Nome exato do arquivo no Google Drive ou o link dele."),
      },
      annotations: ESCRITA,
    },
    async ({ notebook, url, texto, arquivos, drive }, extra) =>
      tentar(() =>
        adicionarFonte(novoPrazo(), notebook, { urls: url === undefined ? undefined : Array.isArray(url) ? url : [url], texto, arquivos, drive }, criarProgresso(extra as never)),
      ),
  );

  servidor.registerTool(
    "notebook_pesquisar_fontes",
    {
      title: "Pesquisar fontes na web",
      description: [
        "Usa a pesquisa de fontes do NotebookLM (modo rápido ~30 s ou Deep Research, vários minutos) e importa os resultados como fontes.",
        "Com 'consulta': faz a pesquisa. Sem 'consulta': mostra/importa os resultados da última pesquisa do notebook (útil quando ela demorou mais que a chamada).",
        "importar: \"todas\", \"nenhuma\" (só lista) ou os números dos resultados, ex. [1, 3]. Padrão: todas numa pesquisa nova; sem consulta, só lista (para o usuário escolher antes).",
      ].join(" "),
      inputSchema: {
        notebook: notebookParam,
        consulta: z.string().min(2).max(1000).optional().describe("O que pesquisar (em português)."),
        modo: z.enum(["rapida", "profunda"]).default("rapida").describe("rapida = Pesquisa rápida; profunda = Deep Research (relatório e mais fontes, demora)."),
        importar: z.union([z.enum(["todas", "nenhuma"]), z.array(z.number().int().min(1)).min(1)]).optional().describe("Padrão: \"todas\" com consulta nova; \"nenhuma\" (só lista) ao chamar sem consulta."),
      },
      annotations: ESCRITA,
    },
    async ({ notebook, consulta, modo, importar }, extra) =>
      tentar(() => pesquisarFontes(novoPrazo(), { notebook, consulta, modo, importar: importar ?? (consulta ? "todas" : "nenhuma") }, criarProgresso(extra as never))),
  );

  servidor.registerTool(
    "notebook_fonte_ler",
    {
      title: "Ler uma fonte",
      description: `Lê o conteúdo completo de uma fonte (o texto que o NotebookLM extraiu) e o guia da fonte (resumo e tópicos). ${AVISO_CONTEUDO}`,
      inputSchema: {
        notebook: notebookParam,
        fonte: z.string().min(1).describe("Título (ou parte dele) ou id da fonte."),
        guia: z.boolean().default(true).describe("Incluir o resumo e os tópicos do guia da fonte (alguns segundos a mais)."),
        max_caracteres: z.number().int().min(1000).max(200000).default(30000).describe("Corta o texto depois disto."),
      },
      annotations: LEITURA,
    },
    async ({ notebook, fonte, guia, max_caracteres }) =>
      tentar(async () => `${descreverLeitura(await lerConteudoFonte(novoPrazo(), notebook, fonte, guia), max_caracteres)}\n\n${AVISO_CONTEUDO}`),
  );

  servidor.registerTool(
    "notebook_fonte_renomear",
    {
      title: "Renomear fonte",
      description: "Muda o nome de uma fonte do notebook.",
      inputSchema: { notebook: notebookParam, fonte: z.string().min(1).describe("Título atual (ou parte) ou id."), novo_nome: z.string().min(1).max(300) },
      annotations: ESCRITA,
    },
    async ({ notebook, fonte, novo_nome }) => tentar(() => renomearFonte(novoPrazo(), notebook, fonte, novo_nome)),
  );

  servidor.registerTool(
    "notebook_fonte_remover",
    {
      title: "Remover fontes",
      description: "Remove fontes do notebook PERMANENTEMENTE. Só use quando o usuário pedir e confirmar quais.",
      inputSchema: {
        notebook: notebookParam,
        fontes: z.array(z.string().min(1)).min(1).max(50).describe("Títulos (ou partes) ou ids das fontes."),
        confirmar: z.literal(true).describe("Precisa ser true: confirma que o usuário pediu a remoção."),
      },
      annotations: DESTRUTIVA,
    },
    async ({ notebook, fontes }) => tentar(() => removerFontes(novoPrazo(), notebook, fontes)),
  );

}
