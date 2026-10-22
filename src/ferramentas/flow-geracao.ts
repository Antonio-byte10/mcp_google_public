import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { creditosFlow, estenderVideo, gerarImagem, gerarVideo, listarVozes, proporcaoDoArquivo } from "../flow.js";
import { criarProgresso, ESCRITA, LEITURA, META_UI, tentar, tentarComArquivos } from "../respostas.js";
import { descreverGastoDeHoje, relatorioDeGastos } from "../gastos.js";
import { MODELOS_FLOW, MODELOS_IMAGEM } from "../seletores.js";
import { novoPrazo } from "../prazo.js";
import {
  andamentoDe, descreverGeracao, formatoVideo, modeloImagemParam, ONDE_FICAM, personagensParam, projetoParam, quadroParam, referenciasParam,
} from "./flow-comum.js";

// Google Flow: saldo, custos e geração de imagem/vídeo (inclui editar e estender).
export function registrarFlowGeracao(servidor: McpServer): void {
  servidor.registerTool(
    "flow_creditos",
    { title: "Saldo do Flow", description: "Mostra o saldo de créditos do Google Flow da conta (não gasta nada).", annotations: LEITURA },
    async () =>
      tentar(async () => {
        const saldo = await creditosFlow(novoPrazo());
        return saldo === null ? "Não consegui ler o saldo." : `Saldo do Google Flow: ${saldo} créditos (cota diária, renova sozinha).\n${descreverGastoDeHoje()}`;
      }),
  );

  servidor.registerTool(
    "flow_gastos",
    {
      title: "Relatório de gastos do Flow",
      description: "Mostra quanto foi gasto de créditos do Flow por dia, por tipo/modelo e as gerações mais caras, a partir do registro deste PC (não abre o navegador, não gasta nada).",
      inputSchema: { dias: z.number().int().min(1).max(365).default(7).describe("Quantos dias para trás (padrão 7).") },
      annotations: LEITURA,
    },
    async ({ dias }) => tentar(async () => relatorioDeGastos(dias)),
  );


  servidor.registerTool(
    "flow_custo",
    {
      title: "Simular custo no Flow",
      description: "Simula uma geração no Flow e devolve o custo exato em créditos que o Flow mostra, SEM gerar nada.",
      inputSchema: {
        tipo: z.enum(["video", "imagem"]).default("video"),
        prompt: z.string().max(5000).default("").describe("Opcional; usado só para deduzir proporção e duração."),
        ...formatoVideo,
        modelo: z.string().optional().describe("Modelo de vídeo (veo-3.1-lite/fast/quality, omni-1.1-flash) ou de imagem (nano-banana-2, nano-banana-pro, nano-banana-2-lite). Padrão: veo-3.1-fast / nano-banana-2."),
        proporcao: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16"]).optional(),
      },
      annotations: LEITURA,
    },
    async (a) =>
      tentar(async () => {
        const prazo = novoPrazo();
        if (a.tipo === "imagem") {
          const modelo = (a.modelo ?? "nano-banana-2") as keyof typeof MODELOS_IMAGEM;
          if (!(modelo in MODELOS_IMAGEM)) throw new Error(`Modelo de imagem desconhecido: ${modelo}`);
          const r = await gerarImagem({ prompt: a.prompt || "teste", modelo, proporcao: a.proporcao, quantidade: a.quantidade, maxCreditos: Infinity, qualidade: "original", projeto: a.projeto, simular: true }, prazo);
          return `${r.configuracao}\nCusto: ${r.custoEstimado} créditos. Nada foi gerado.`;
        }
        const modelo = (a.modelo ?? "veo-3.1-fast") as keyof typeof MODELOS_FLOW;
        if (!(modelo in MODELOS_FLOW)) throw new Error(`Modelo de vídeo desconhecido: ${modelo}`);
        if (a.proporcao && !["16:9", "9:16"].includes(a.proporcao)) throw new Error("Vídeo aceita só 16:9 ou 9:16.");
        const r = await gerarVideo(
          { prompt: a.prompt || "teste", modelo, proporcao: a.proporcao as "16:9" | "9:16" | undefined, quantidade: a.quantidade, duracao: a.duracao, resolucao: a.resolucao, maxCreditos: Infinity, qualidade: "original", projeto: a.projeto, simular: true },
          prazo,
        );
        const avisos = r.avisos.length ? `\nAvisos: ${r.avisos.join(" ")}` : "";
        return `${r.configuracao}\nCusto: ${r.custoEstimado} créditos. Saldo atual: ${r.saldoAntes ?? "?"}. Nada foi gerado.${avisos}`;
      }),
  );

  servidor.registerTool(
    "flow_gerar_imagem",
    {
      title: "Gerar imagem no Flow",
      description: [
        "Gera imagens no Google Flow (Nano Banana) com a assinatura Google AI Pro e baixa os arquivos.",
        ONDE_FICAM,
        "Leva ~20-40 s. As imagens ficam no projeto do Flow e o id delas pode ser usado como quadro inicial/final em flow_gerar_video (imagem → vídeo, bom para manter o mesmo personagem entre cenas).",
        "Se demorar mais que o tempo da chamada, volta 'em andamento': chame flow_status.",
      ].join(" "),
      inputSchema: {
        prompt: z.string().min(3).max(5000).describe("Descrição da imagem em português (assunto, estilo, luz, enquadramento). Texto dentro da imagem: escreva entre aspas."),
        modelo: modeloImagemParam,
        proporcao: z
          .enum(["16:9", "4:3", "1:1", "3:4", "9:16"])
          .optional()
          .describe("Se omitida: 'vertical/reels/stories' → 9:16, 'quadrado/logo/avatar' → 1:1, senão 16:9. Para virar quadro de vídeo, use 16:9 ou 9:16 (igual ao vídeo)."),
        quantidade: z.number().int().min(1).max(4).default(1).describe("Quantas variações gerar (1 a 4)."),
        personagens: personagensParam,
        referencias: referenciasParam,
        qualidade_download: z.enum(["original", "2k"]).default("original").describe("original = 1K como o Flow gerou (rápido). 2k = versão aprimorada pelo Flow (mais lenta)."),
        max_creditos: z.number().int().min(1).optional().describe("Limite opcional desta geração: só use se o usuário pedir. O teto diário do mcp-google vale sempre."),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        const r = await gerarImagem(
          { prompt: a.prompt, modelo: a.modelo, proporcao: a.proporcao, quantidade: a.quantidade, personagens: a.personagens, referencias: a.referencias, maxCreditos: a.max_creditos, qualidade: a.qualidade_download, projeto: a.projeto },
          novoPrazo(),
          criarProgresso(extra as never),
        );
        return { texto: descreverGeracao(r), arquivos: r.relatorio.arquivos, projeto: r.projeto, andamento: andamentoDe([r.relatorio]) };
      }),
  );

  servidor.registerTool(
    "flow_editar_imagem",
    {
      title: "Editar imagem no Flow",
      description: [
        "Edita uma imagem existente com Nano Banana (0 créditos em out/2026): usa a imagem como referência e aplica a instrução.",
        "Ex.: 'troque o fundo por uma praia', 'a mesma cena à noite', 'deixe em estilo aquarela', 'tire o texto'. Gera uma imagem nova; a original não muda.",
        "Atenção: com imagem de referência o Flow traduz o pedido para o inglês, e textos escritos na imagem podem sair traduzidos; para manter, diga 'texto exatamente em português: \"Bom dia!\"'.",
        ONDE_FICAM,
      ].join(" "),
      inputSchema: {
        imagem: z.string().min(3).max(1000).describe("Id de uma imagem do projeto (flow_listar / flow_gerar_imagem) OU caminho completo de PNG/JPG/WebP do PC."),
        instrucao: z.string().min(3).max(5000).describe("O que mudar, em português."),
        modelo: modeloImagemParam,
        proporcao: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16"]).optional().describe("Padrão: a da imagem (arquivo do PC) ou deduzida da instrução. Para manter o formato de uma imagem do projeto, informe."),
        quantidade: z.number().int().min(1).max(4).default(1).describe("Quantas variações (1 a 4)."),
        qualidade_download: z.enum(["original", "2k"]).default("original"),
        max_creditos: z.number().int().min(1).optional().describe("Limite opcional desta geração: só use se o usuário pedir. O teto diário do mcp-google vale sempre."),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        const ehArquivo = /[\\/]/.test(a.imagem);
        const r = await gerarImagem(
          {
            prompt: a.instrucao, modelo: a.modelo, proporcao: a.proporcao ?? (ehArquivo ? proporcaoDoArquivo(a.imagem) : undefined),
            quantidade: a.quantidade, referencias: [a.imagem], maxCreditos: a.max_creditos, qualidade: a.qualidade_download, projeto: a.projeto,
          },
          novoPrazo(),
          criarProgresso(extra as never),
        );
        return { texto: descreverGeracao(r), arquivos: r.relatorio.arquivos, projeto: r.projeto, andamento: andamentoDe([r.relatorio]) };
      }),
  );

  servidor.registerTool(
    "flow_vozes",
    {
      title: "Vozes do Flow",
      description: "Lista as vozes do Flow (nome, gênero e timbre) para usar em voz de flow_gerar_video e na voz dos personagens. Não gasta nada.",
      inputSchema: { busca: z.string().max(40).optional().describe("Filtra por trecho (ex.: 'female', 'low', 'Fen').") },
      annotations: LEITURA,
    },
    async ({ busca }) =>
      tentar(async () => {
        const vozes = (await listarVozes(novoPrazo())).filter((v) => !busca || `${v.nome} ${v.descricao}`.toLowerCase().includes(busca.toLowerCase()));
        if (!vozes.length) return "Nenhuma voz encontrada.";
        return [`${vozes.length} voz(es) do Flow (descrições em inglês, como o Flow mostra):`, ...vozes.map((v) => `- ${v.nome}: ${v.descricao}`)].join("\n");
      }),
  );

  servidor.registerTool(
    "flow_gerar_video",
    {
      title: "Gerar vídeo no Flow",
      description: [
        "Gera vídeo curto no Google Flow (Veo 3.1, 8 s com áudio) com os créditos do Google AI Pro e baixa o .mp4.",
        ONDE_FICAM,
        "Gasta créditos da cota diária (custo na descrição de 'modelo'; padrão veo-3.1-fast). O que passaria do teto diário do mcp-google é recusado antes de enviar.",
        "Imagem → vídeo: passe imagem_inicio (e opcionalmente imagem_fim) para o vídeo começar/terminar nessas imagens.",
        "Elementos: personagens (mesma aparência entre vídeos), referencias (imagens como ingredientes) e voz (narração/falas). Elementos não combinam com imagem_inicio/imagem_fim (no Flow são modos diferentes).",
        "A geração leva ~1-3 min. No Claude Desktop cada chamada dura no máximo ~50 s, então normalmente a resposta vem 'em andamento': chame flow_status (de novo, se preciso) até os arquivos serem salvos. No Claude Code a chamada já espera e baixa.",
      ].join(" "),
      inputSchema: {
        prompt: z.string().min(5).max(5000).describe("Descrição do vídeo em português: cena, ação, câmera, luz e som. Formato e duração podem vir no texto ('vertical')."),
        ...formatoVideo,
        imagem_inicio: quadroParam("Primeiro quadro do vídeo"),
        imagem_fim: quadroParam("Último quadro do vídeo"),
        personagens: personagensParam,
        referencias: referenciasParam,
        voz: z.string().min(2).max(40).optional().describe("Voz do Flow para narração/falas (ex.: Fenrir, Kore, Charon, Aoede; lista com flow_vozes). Escreva as falas no prompt: Tatuzinho diz: \"...\"."),
        estilo_voz: z.string().max(500).optional().describe("Como a voz deve soar (ex.: 'animada, ritmo rápido', 'sussurrando')."),
        max_creditos: z.number().int().min(1).optional().describe("Limite opcional desta geração: só use se o usuário pedir. O teto diário do mcp-google vale sempre."),
        qualidade_download: z
          .enum(["original", "1080p", "gif"])
          .default("original")
          .describe("original = arquivo 720p como o Flow gerou (recomendado). 1080p = aprimorado pelo Flow (lento; evite no Claude Desktop). gif = GIF 270p."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        const r = await gerarVideo(
          {
            prompt: a.prompt, modelo: a.modelo, proporcao: a.proporcao, quantidade: a.quantidade, duracao: a.duracao, resolucao: a.resolucao,
            imagemInicio: a.imagem_inicio, imagemFim: a.imagem_fim, personagens: a.personagens, referencias: a.referencias, voz: a.voz, estiloVoz: a.estilo_voz, maxCreditos: a.max_creditos, qualidade: a.qualidade_download, projeto: a.projeto,
          },
          novoPrazo(),
          criarProgresso(extra as never),
        );
        return { texto: descreverGeracao(r), arquivos: r.relatorio.arquivos, projeto: r.projeto, andamento: andamentoDe([r.relatorio]) };
      }),
  );

  servidor.registerTool(
    "flow_estender_video",
    {
      title: "Estender vídeo",
      description: [
        "Continua um vídeo ou uma cena já estendida (+~7 s a partir do último clipe) descrevendo o que acontece em seguida, e salva a cena inteira num .mp4 só.",
        "Para um vídeo longo de vários trechos de uma vez, prefira flow_video_longo.",
        ONDE_FICAM,
        "O modelo da extensão é o Flow que escolhe (hoje Veo 3.1 Lite, 10 créditos; o menu do Flow mostra 'Estender (Veo 3.1 - Lite)'): se for diferente do pedido, a extensão usa o do Flow e a resposta avisa. O custo real é lido antes de gerar.",
        "Leva ~1-3 min: no Claude Desktop a resposta normalmente vem 'em andamento'; chame flow_status até salvar.",
      ].join(" "),
      inputSchema: {
        id: z.string().describe("Id do vídeo ou da cena a continuar (de flow_gerar_video ou flow_listar, seção Cenas)."),
        prompt: z.string().min(5).max(5000).describe("O que acontece na continuação (ação, câmera, som)."),
        modelo: z.enum(["veo-3.1-lite", "veo-3.1-fast", "veo-3.1-quality"]).default("veo-3.1-fast").describe("Preferência; o Flow pode estender só com outro modelo (hoje Lite)."),
        max_creditos: z.number().int().min(1).optional().describe("Limite opcional desta geração: só use se o usuário pedir. O teto diário do mcp-google vale sempre."),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        const r = await estenderVideo(
          { id: a.id, prompt: a.prompt, modelo: a.modelo, maxCreditos: a.max_creditos, projeto: a.projeto },
          novoPrazo(),
          criarProgresso(extra as never),
        );
        return { texto: descreverGeracao(r), arquivos: r.relatorio.arquivos, projeto: r.projeto, andamento: andamentoDe([r.relatorio]) };
      }),
  );
}
