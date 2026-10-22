import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { criarPersonagem, editarPersonagem, excluirPersonagem, listarPersonagens, type ResultadoPersonagem } from "../flow.js";
import { criarProgresso, DESTRUTIVA, ESCRITA, LEITURA, META_UI, tentar, tentarComArquivos } from "../respostas.js";
import { novoPrazo } from "../prazo.js";
import { descreverArquivo, projetoParam } from "./flow-comum.js";

// Personagens do Flow: criar, listar, editar e excluir.
function descreverPersonagem(r: ResultadoPersonagem, acao: string): string {
  const linhas = [`Personagem "${r.nome}" ${acao}.`, `Página no Flow: ${r.pagina}`];
  if (r.aviso) linhas.push(`ATENÇÃO: ${r.aviso}`);
  if (r.feito.length) linhas.push(`Feito: ${r.feito.join(" · ")}`);
  if (r.pendente.length) linhas.push(`Ficou para depois (use flow_personagem_editar): ${r.pendente.join(" · ")}`);
  if (r.arquivos.length) linhas.push(`Imagens salvas:\n${r.arquivos.map(descreverArquivo).join("\n")}`);
  linhas.push(`Para usar: flow_gerar_video ou flow_gerar_imagem com personagens: ["${r.nome}"] e o nome no prompt.`);
  return linhas.join("\n");
}

export function registrarFlowPersonagens(servidor: McpServer): void {
  servidor.registerTool(
    "flow_personagem_criar",
    {
      title: "Criar personagem no Flow",
      description: [
        "Cria um personagem do Google Flow para usar em vários vídeos e imagens com a mesma aparência (e voz).",
        "Informe nome e descricao (aparência: espécie/rosto, cabelo, roupa, estilo) OU uma imagem (id do projeto ou arquivo do PC).",
        "Opcional: personalidade, voz e corpo (gera também uma imagem de corpo inteiro).",
        "Se algo falhar depois de o Flow criar o personagem, a resposta traz ATENÇÃO com o nome que ficou e o link da página: corrija com flow_personagem_editar (nome: o link) em vez de criar de novo.",
        "O retrato é gerado com Nano Banana (0 créditos em out/2026) e aparece no chat.",
        "Depois use personagens: [nome] em flow_gerar_video / flow_gerar_imagem.",
      ].join(" "),
      inputSchema: {
        nome: z.string().min(1).max(60).describe("Nome único do personagem (é por ele que você o usa depois)."),
        descricao: z.string().max(3000).optional().describe("Aparência em português. Ex.: 'tatu-galinha mascote, animação 3D fofa, olhos grandes castanhos, cachecol vermelho e verde'."),
        imagem: z.string().max(1000).optional().describe("Em vez da descrição: id de uma imagem do projeto ou caminho completo de PNG/JPG/WebP do PC."),
        personalidade: z.string().max(2000).optional().describe("Como o personagem age e fala (o Flow usa ao criar cenas)."),
        voz: z
          .string()
          .max(40)
          .optional()
          .describe("Voz do Flow. Exemplos: Fenrir (masculina, animada, jovem), Puck, Charon (masculina, grave), Achird (masculina, simpática), Kore, Aoede (feminina, leve), Achernar (feminina, suave), Despina (feminina, macia)."),
        corpo: z.string().max(2000).optional().describe("Corpo e roupa para gerar também a imagem de corpo inteiro (leva ~25 s a mais)."),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        const r = await criarPersonagem(
          { nome: a.nome, descricao: a.descricao, imagem: a.imagem, personalidade: a.personalidade, voz: a.voz, corpo: a.corpo, projeto: a.projeto },
          novoPrazo(),
          criarProgresso(extra as never),
        );
        return { texto: descreverPersonagem(r, "criado"), arquivos: r.arquivos, projeto: r.projeto };
      }),
  );

  servidor.registerTool(
    "flow_personagens",
    {
      title: "Listar personagens do Flow",
      description: "Lista os nomes dos personagens do projeto do Flow (para usar em personagens: [...] nas gerações).",
      inputSchema: { projeto: projetoParam },
      annotations: LEITURA,
    },
    async ({ projeto }) =>
      tentar(async () => {
        const { projeto: url, nomes } = await listarPersonagens(novoPrazo(), projeto);
        if (!nomes.length) return `Nenhum personagem no projeto ${url}. Crie com flow_personagem_criar.`;
        return `Personagens do projeto ${url}:\n- ${nomes.join("\n- ")}`;
      }),
  );

  servidor.registerTool(
    "flow_personagem_editar",
    {
      title: "Editar personagem do Flow",
      description:
        "Muda nome, personalidade ou voz de um personagem, ou gera a imagem de corpo inteiro. Se o personagem já tem corpo, 'corpo' refaz a imagem de corpo inteiro com a nova descrição (a versão anterior fica no histórico da página no Flow).",
      inputSchema: {
        nome: z
          .string()
          .min(1)
          .max(300)
          .describe("Nome atual do personagem, ou o link da página dele no Flow (use o link quando o nome se repete, ex.: 'Personagem sem nome')."),
        novo_nome: z.string().min(1).max(60).optional(),
        personalidade: z.string().max(2000).optional(),
        voz: z.string().max(40).optional().describe("Nova voz (ex.: Fenrir, Kore, Puck, Charon, Aoede)."),
        corpo: z.string().max(2000).optional().describe("Corpo e roupa para gerar (ou refazer, se já existir) a imagem de corpo inteiro."),
        projeto: projetoParam,
      },
      annotations: ESCRITA,
      _meta: META_UI,
    },
    async (a, extra) =>
      tentarComArquivos(async () => {
        if (!a.novo_nome && !a.personalidade && !a.voz && !a.corpo) throw new Error("Diga o que mudar: novo_nome, personalidade, voz ou corpo.");
        const r = await editarPersonagem(
          { nome: a.nome, novoNome: a.novo_nome, personalidade: a.personalidade, voz: a.voz, corpo: a.corpo, projeto: a.projeto },
          novoPrazo(),
          criarProgresso(extra as never),
        );
        return { texto: descreverPersonagem(r, "atualizado"), arquivos: r.arquivos, projeto: r.projeto };
      }),
  );

  servidor.registerTool(
    "flow_personagem_excluir",
    {
      title: "Excluir personagem do Flow",
      description: "Exclui um personagem do Flow PERMANENTEMENTE. Só use quando o usuário pedir explicitamente e confirmar o nome.",
      inputSchema: {
        nome: z.string().min(1).max(300).describe("Nome do personagem, ou o link da página dele no Flow (quando o nome se repete)."),
        confirmar: z.literal(true).describe("Precisa ser true: confirma que o usuário pediu a exclusão."),
        projeto: projetoParam,
      },
      annotations: DESTRUTIVA,
    },
    async ({ nome, projeto }) => tentar(() => excluirPersonagem(novoPrazo(), nome, projeto)),
  );
}
