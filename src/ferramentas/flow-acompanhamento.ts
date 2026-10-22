import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  baixar, criarProjeto, definirProjetoPadrao, listarMidias, listarProjetos, statusFlow, type Arquivo, type RelatorioLote,
} from "../flow.js";
import { criarProgresso, ESCRITA, LEITURA, META_UI, tentar, tentarComArquivos } from "../respostas.js";
import { continuarRoteiros, criarRoteiro } from "../roteiro.js";
import { continuarVideosLongos, criarVideoLongo, duracaoAproximada, listarVideosLongos, montarTrechos, retomarVideoLongo } from "../video-longo.js";
import { lerLotes } from "../pendentes.js";
import { novoPrazo } from "../prazo.js";
import {
  descreverArquivo, descreverLote, andamentoDe, modeloVideoParam, ONDE_FICAM, personagensParam, projetoParam, quadroParam, referenciasParam,
} from "./flow-comum.js";

// Google Flow: acompanhamento (flow_status), vídeo longo, roteiro, projetos, listagem e download.
export function registrarFlowAcompanhamento(servidor: McpServer): void {
  servidor.registerTool(
    "flow_status",
    {
      title: "Acompanhar gerações do Flow",
      description: `Acompanha as gerações em andamento (vídeos, imagens e extensões), espera o que der dentro do tempo da chamada e baixa o que ficar pronto. Repita até não haver mais nada pendente. ${ONDE_FICAM}`,
      inputSchema: { lote: z.string().optional().describe("Opcional: id do lote ou da mídia. Sem isso, cuida de todos os pendentes.") },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async ({ lote }, extra) =>
      tentarComArquivos(async () => {
        const prazo = novoPrazo();
        const progresso = criarProgresso(extra as never);
        const cabecalho: string[] = [];
        const extras: Arquivo[] = [];
        // Primeiro envia o que ficou na fila (cenas de roteiro, próximo trecho de vídeo longo, vídeo
        // longo pronto para juntar). Cada envio abre o próprio navegador.
        if (!lote) {
          cabecalho.push(...(await continuarRoteiros(prazo, progresso)));
          const vl = await continuarVideosLongos(prazo, progresso);
          cabecalho.push(...vl.linhas);
          extras.push(...vl.arquivos);
        }
        // No Claude Desktop um envio pode usar quase toda a chamada: sem tempo para acompanhar,
        // responde já (não é erro; a próxima chamada acompanha).
        let rels: RelatorioLote[] = [];
        if (prazo.sobra(20000)) rels = await statusFlow(prazo, lote, progresso);
        else if (lerLotes().length) cabecalho.push("Sem tempo para acompanhar nesta chamada: chame flow_status de novo.");
        // Algo terminou e ainda sobra tempo (Claude Code): já dá o próximo passo do vídeo longo.
        if (!lote && rels.some((r) => r.estado !== "aguardando") && prazo.sobra(45000)) {
          const vl = await continuarVideosLongos(prazo, progresso);
          cabecalho.push(...vl.linhas);
          extras.push(...vl.arquivos);
        }
        const topo = cabecalho.length ? cabecalho.join("\n") + "\n\n" : "";
        if (!rels.length) {
          const nada = lote ? `Nenhuma geração pendente com "${lote}".` : lerLotes().length ? "" : "Nenhuma geração pendente. Tudo já foi baixado.";
          return { texto: (topo + nada).trim() || "Nada a fazer agora.", arquivos: extras };
        }
        return {
          texto: topo + rels.map((r) => `Lote ${r.lote} (${r.tipo}) - ${r.estado}\nPrompt: ${r.prompt.slice(0, 150)}\n${descreverLote(r)}`).join("\n\n---\n\n"),
          arquivos: [...extras, ...rels.flatMap((r) => r.arquivos)],
          andamento: andamentoDe(rels),
        };
      }),
  );

  servidor.registerTool(
    "flow_video_longo",
    {
      title: "Vídeo longo e contínuo (estender trecho a trecho)",
      description: [
        "Faz um vídeo contínuo, sem cortes, de um personagem falando: o 1º trecho (8 s) vira o vídeo base e cada um dos outros é uma extensão (~7 s) que continua do fim do anterior. No fim o Flow junta tudo e o MCP salva UM .mp4, já sem as pausas de ~1 s que a exportação do Flow deixa em cada emenda (o original do Flow fica ao lado). Ex.: 4 trechos ≈ 29 s, 5 ≈ 36 s, em 9:16 para TikTok/Reels.",
        "RECOMENDADO — modo apresentador: passe 'cenario' (personagem, lugar e estilo, uma vez) e 'falas' (uma por trecho); o MCP monta os prompts no jeito que funciona nas extensões (plano único, fala do 1º ao último instante, gestos no lugar). Falas: ~15-19 palavras no 1º trecho e ~13-17 nas extensões.",
        "As extensões são sempre Veo 3.1 Lite: o personagem NÃO troca de ambiente nem faz ações grandes (andar até outro lugar, objetos novos entrando). Use 'trechos' (texto livre) só se precisar controlar cada prompt.",
        "Personagens e voz vão em todos os trechos (elementos_em_todos); restricoes e estilo_voz vão escritos no texto de todos os trechos; referências ou imagem_inicio só no 1º.",
        "Custo: o 1º trecho no modelo escolhido (lite 10, fast 20 = padrão, quality 100) + 10 por extensão (o Flow estende sempre com Veo 3.1 Lite): 4 trechos em Fast = 50 créditos. O vídeo inteiro precisa caber no teto diário do mcp-google (conferido antes de enviar).",
        "Leva ~1-2 min por trecho, um depois do outro. Depois de chamar, use SÓ flow_status (repetindo) até aparecer PRONTO; não chame esta ferramenta de novo para o mesmo vídeo.",
        "Sem trechos e sem retomar: lista os vídeos longos e o estado de cada um.",
        ONDE_FICAM,
      ].join(" "),
      inputSchema: {
        trechos: z
          .array(z.string().min(5).max(3000))
          .min(2)
          .max(8)
          .optional()
          .describe("Modo livre: o prompt de cada trecho, na ordem (ação, câmera, som e falas entre aspas). Prefira cenario + falas."),
        cenario: z
          .string()
          .min(10)
          .max(1500)
          .optional()
          .describe("Modo apresentador: quem é o personagem, onde está e o estilo (ex.: 'Tatuzinho, um tatu-galinha de animação 3D fofo com cachecol vermelho, sentado numa poltrona de uma biblioteca aconchegante, luz quente'). Vai inteiro no 1º trecho."),
        falas: z
          .array(z.string().min(3).max(400))
          .min(2)
          .max(8)
          .optional()
          .describe("Modo apresentador: o que o personagem diz em cada trecho, na ordem (português do Brasil, sem aspas). ~15-19 palavras no 1º e ~13-17 nos outros."),
        gestos: z
          .array(z.string().max(200))
          .max(8)
          .optional()
          .describe("Modo apresentador, opcional: gesto de cada trecho (ex.: 'contando nos dedos'). Sem isso, o MCP alterna gestos variados. Regras que valem para o vídeo todo vão em 'restricoes', não aqui."),
        final: z.string().max(200).optional().describe("Modo apresentador, opcional: como termina o último trecho (padrão: 'sorri e acena para a câmera')."),
        titulo: z.string().max(80).optional().describe("Nome do vídeo (vira o nome do arquivo)."),
        modelo: z.enum(["veo-3.1-lite", "veo-3.1-fast", "veo-3.1-quality"]).default("veo-3.1-fast").describe("Modelo do 1º trecho (lite 10, fast 20, quality 100 créditos); as extensões o Flow faz com Lite (10)."),
        proporcao: z.enum(["9:16", "16:9"]).default("9:16").describe("9:16 (vertical: TikTok, Reels, Shorts) ou 16:9."),
        max_creditos: z.number().int().min(1).optional().describe("Limite opcional do vídeo inteiro: só use se o usuário pedir. O teto diário do mcp-google vale sempre."),
        personagens: personagensParam,
        voz: z.string().min(2).max(40).optional().describe("Voz do Flow para as falas (veja flow_vozes)."),
        estilo_voz: z.string().max(300).optional().describe("Como a voz deve soar (ex.: 'animado, ritmo rápido'). Vai escrito em todos os trechos."),
        restricoes: z
          .string()
          .max(300)
          .optional()
          .describe("Regras visuais que valem para o vídeo inteiro, repetidas em todos os trechos (ex.: 'sem fogo, sem faíscas, mão mecânica fosca'). Funciona no modo apresentador e no modo livre."),
        imagem_inicio: quadroParam("Primeiro quadro do vídeo"),
        referencias: referenciasParam,
        reforcar_continuidade: z.boolean().default(true).describe("Acrescenta às extensões: 'mesmo personagem, mesma voz e mesmo estilo visual'."),
        elementos_em_todos: z.boolean().default(true).describe("Repete personagens e voz como elementos em cada extensão (não só no 1º trecho)."),
        projeto: projetoParam,
        retomar: z.string().max(40).optional().describe("Id de um vídeo longo que parou (vl…) para continuar de onde parou."),
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        const prazo = novoPrazo();
        const progresso = criarProgresso(extra as never);
        if (a.retomar) {
          const r = await retomarVideoLongo(a.retomar.trim(), prazo, progresso);
          return { texto: r.texto, arquivos: r.arquivos };
        }
        if (a.trechos && (a.falas || a.cenario)) throw new Error("Use 'trechos' (modo livre) OU 'cenario' + 'falas' (modo apresentador), não os dois. Nada foi enviado.");
        if (!a.trechos && !a.falas && !a.cenario) return { texto: listarVideosLongos(), arquivos: [] };
        if (!a.trechos && (!a.falas || !a.cenario)) throw new Error("O modo apresentador precisa de 'cenario' e de 'falas' (uma por trecho). Nada foi enviado.");
        const montado = a.falas && a.cenario ? montarTrechos({ cenario: a.cenario, falas: a.falas, gestos: a.gestos, final: a.final }) : undefined;
        const trechos = montado?.trechos ?? a.trechos!;
        const r = await criarVideoLongo(
          {
            trechos, titulo: a.titulo, modelo: a.modelo, proporcao: a.proporcao, maxCreditos: a.max_creditos, projeto: a.projeto,
            personagens: a.personagens, voz: a.voz, estiloVoz: a.estilo_voz, restricoes: a.restricoes, imagemInicio: a.imagem_inicio, referencias: a.referencias,
            // O modo apresentador já escreve a continuidade em cada trecho.
            reforcarContinuidade: montado ? false : a.reforcar_continuidade, elementosNasExtensoes: a.elementos_em_todos, avisos: montado?.avisos,
          },
          prazo,
          progresso,
        );
        return { texto: r.texto, arquivos: r.arquivos };
      }),
  );

  servidor.registerTool(
    "flow_projetos",
    {
      title: "Listar projetos do Flow",
      description: "Lista os projetos da conta no Google Flow (nome, link, data) e qual é o padrão usado quando nenhuma ferramenta recebe 'projeto'. Não gasta nada.",
      annotations: LEITURA,
    },
    async () =>
      tentar(async () => {
        const { projetos, padrao } = await listarProjetos(novoPrazo());
        if (!projetos.length) return "Nenhum projeto encontrado na página inicial do Flow.";
        const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
        return [
          `${projetos.length} projeto(s) no Flow:`,
          ...projetos.map((x) => `- ${x.titulo || "(sem nome)"}${x.id === padrao ? "  ← PADRÃO" : ""} | ${data(x.criadoEm)} | ${x.link}`),
          padrao && !projetos.some((x) => x.id === padrao) ? `Padrão atual: https://flow.google.com/project/${padrao} (não apareceu na lista).` : "",
          "Use o nome em 'projeto' de qualquer ferramenta do Flow, ou mude o padrão com flow_projeto_padrao.",
        ]
          .filter(Boolean)
          .join("\n");
      }),
  );

  servidor.registerTool(
    "flow_projeto_criar",
    {
      title: "Criar projeto no Flow",
      description:
        "Cria um projeto novo no Google Flow com o nome dado (ex.: um por vídeo ou por série). Não gasta créditos. Atenção: personagens ficam no projeto em que foram criados; num projeto novo, crie-os de novo (flow_personagem_criar) antes de usá-los.",
      inputSchema: {
        nome: z.string().min(1).max(80).describe("Nome único do projeto."),
        tornar_padrao: z.boolean().default(false).describe("Se true, vira o projeto usado quando 'projeto' não é informado."),
      },
      annotations: ESCRITA,
    },
    async ({ nome, tornar_padrao }) =>
      tentar(async () => {
        const x = await criarProjeto(novoPrazo(), nome, tornar_padrao);
        return `Projeto "${x.titulo}" criado: ${x.link}${x.padrao ? "\nAgora é o projeto padrão." : `\nPara usar: projeto: "${x.titulo}" nas ferramentas do Flow.`}`;
      }),
  );

  servidor.registerTool(
    "flow_projeto_padrao",
    {
      title: "Mudar o projeto padrão do Flow",
      description: "Escolhe qual projeto do Flow as ferramentas usam quando 'projeto' não é informado (fica salvo em config.json neste PC, vale para o Claude Code e o Desktop).",
      inputSchema: { projeto: z.string().min(1).max(300).describe("Id, link ou nome exato do projeto (veja flow_projetos).") },
      annotations: ESCRITA,
    },
    async ({ projeto }) =>
      tentar(async () => {
        const x = await definirProjetoPadrao(novoPrazo(), projeto);
        return `Projeto padrão agora: ${x.titulo || "(sem nome)"} — ${x.link}`;
      }),
  );

  servidor.registerTool(
    "flow_roteiro",
    {
      title: "Roteiro em lote (várias cenas de vídeo)",
      description: [
        "Gera várias cenas de vídeo de uma vez (até 10), cada uma com seu prompt e, se quiser, personagens, imagem inicial, referências ou voz.",
        "Mostra o custo total estimado (cenas × custo do modelo). O roteiro inteiro precisa caber no teto diário do mcp-google (conferido antes de enviar).",
        "Envia o que couber no tempo da chamada; o resto fica na fila e o flow_status envia as próximas e baixa os vídeos prontos. Repita flow_status até terminar.",
        "Dica: gere antes as imagens das cenas (flow_gerar_imagem, 0 créditos) e use como imagem_inicio para aprovar o visual sem gastar.",
        ONDE_FICAM,
      ].join(" "),
      inputSchema: {
        cenas: z
          .array(
            z.object({
              prompt: z.string().min(5).max(5000).describe("O que acontece na cena (ação, câmera, som, falas)."),
              personagens: personagensParam,
              imagem_inicio: quadroParam("Primeiro quadro da cena"),
              referencias: referenciasParam,
              voz: z.string().min(2).max(40).optional().describe("Voz do Flow para as falas desta cena (veja flow_vozes)."),
            }),
          )
          .min(1)
          .max(10),
        modelo: modeloVideoParam,
        proporcao: z.enum(["16:9", "9:16"]).optional().describe("A mesma para todas as cenas. Padrão: deduzida de cada prompt."),
        max_creditos_total: z.number().int().min(1).optional().describe("Limite opcional do roteiro inteiro: só use se o usuário pedir. O teto diário do mcp-google vale sempre."),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
    },
    async (a, extra) =>
      tentar(() =>
        criarRoteiro(
          {
            cenas: a.cenas.map((c) => ({ prompt: c.prompt, personagens: c.personagens, imagemInicio: c.imagem_inicio, referencias: c.referencias, voz: c.voz })),
            modelo: a.modelo, proporcao: a.proporcao, maxCreditos: a.max_creditos_total, projeto: a.projeto,
          },
          novoPrazo(),
          criarProgresso(extra as never),
        ),
      ),
  );

  servidor.registerTool(
    "flow_listar",
    {
      title: "Listar mídias do Flow",
      description: "Lista as imagens e vídeos de um projeto do Flow (padrão: 'Claude MCP') com id, tipo, título e estado.",
      inputSchema: { projeto: projetoParam },
      annotations: LEITURA,
    },
    async ({ projeto }) =>
      tentar(async () => {
        const { projeto: url, itens, cenas, pendentes } = await listarMidias(novoPrazo(), projeto);
        const aviso = pendentes ? `\n\n${pendentes} geração(ões) aguardando download: use flow_status.` : "";
        if (!itens.length && !cenas.length) return `Nenhuma mídia no projeto ${url}.${aviso}`;
        const secaoCenas = cenas.length
          ? "\n\nCenas (vídeos estendidos; baixe com flow_baixar ou continue com flow_estender_video pelo id da cena):\n" +
            cenas
              .map((c) => `- ${c.titulo || "(sem título)"} | ${c.clipes.length} clipe(s), ~${duracaoAproximada(c.clipes.length)} s | id ${c.id}` + c.clipes.map((x, i) => `\n  ${i + 1}. ${x.titulo || "(clipe)"} | ${x.estado} | id ${x.id}`).join(""))
              .join("\n")
          : "";
        return (
          `Projeto: ${url}\n` +
          itens.map((v) => `- [${v.tipo}] ${v.titulo || "(sem título)"} | ${v.estado} | id ${v.id}\n  prompt: ${v.prompt.slice(0, 150)}`).join("\n") +
          secaoCenas +
          aviso
        );
      }),
  );

  servidor.registerTool(
    "flow_baixar",
    {
      title: "Baixar mídia do Flow",
      description: `Baixa uma imagem, vídeo ou cena (vídeo estendido) já gerada no Flow pelo id. ${ONDE_FICAM} 'original' é o arquivo como foi gerado; 1080p (vídeo) e 2k (imagem) são aprimorados pelo Flow e o saldo é conferido antes e depois.`,
      inputSchema: {
        id: z.string().describe("Id da mídia ou da cena."),
        qualidade: z.enum(["original", "1080p", "2k", "gif"]).default("original"),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async ({ id, qualidade, projeto }) =>
      tentarComArquivos(async () => {
        const a = await baixar(novoPrazo(), id, qualidade, projeto);
        const saldo = a.saldoAntes !== null ? `\nSaldo: ${a.saldoAntes} → ${a.saldoDepois ?? "?"}` : "";
        return { texto: `Arquivo salvo:\n${descreverArquivo(a)}${saldo}`, arquivos: [a], projeto: a.projeto };
      }),
  );
}
