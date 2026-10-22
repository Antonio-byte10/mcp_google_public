import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AVISO_DADOS, AVISO_NAVEGADOR, PASTA_DADOS, iniciarLogin, janelaLoginAberta, MENSAGEM_SEM_SESSAO, rotuloNavegador, sessaoAtiva } from "../navegador.js";
import { diagnosticarNotebook } from "../notebooklm.js";
import { diagnosticarTelasDrive, diagnosticarTelasNotebook } from "../diagnostico-telas.js";
import { diagnosticarFlow } from "../flow.js";
import { ESCRITA, LEITURA, tentar } from "../respostas.js";
import { PASTA_SAIDAS } from "../config.js";
import { infoCliente, novoPrazo } from "../prazo.js";
import { mensagemDeErro } from "../seguranca.js";
import { VERSAO } from "../versao.js";

// Sessão e diagnóstico: login e conferência de que as telas do Google ainda são as esperadas.

/** Linhas com o navegador ativo (e o aviso, se caiu no outro por não ter o escolhido instalado). */
function infoNavegador(): string[] {
  return [
    `Navegador: ${rotuloNavegador()}`,
    `Dados deste PC (login, arquivos, preferências): ${PASTA_DADOS}`,
    ...(AVISO_NAVEGADOR ? [`AVISO: ${AVISO_NAVEGADOR}`] : []),
    ...(AVISO_DADOS ? [`AVISO: ${AVISO_DADOS}`] : []),
  ];
}

export function registrarSistema(servidor: McpServer): void {
  servidor.registerTool(
    "login_iniciar",
    {
      title: "Entrar na conta Google",
      description:
        `Abre uma janela do ${rotuloNavegador()} (normal, sem automação) para o usuário fazer login manualmente na conta Google. O MCP não vê nem guarda a senha. Use quando outra ferramenta disser que a sessão expirou.`,
      annotations: ESCRITA,
    },
    async () => tentar(iniciarLogin),
  );

  servidor.registerTool(
    "login_status",
    {
      title: "Conferir login",
      description: "Confere se a sessão do Google ainda está ativa no perfil local.",
      annotations: LEITURA,
    },
    async () =>
      tentar(async () => {
        if (janelaLoginAberta()) return "A janela de login ainda está aberta. Feche-a para eu conferir a sessão.";
        const situacao = (await sessaoAtiva(novoPrazo())) ? "Sessão do Google ativa." : MENSAGEM_SEM_SESSAO;
        return [situacao, ...infoNavegador()].join("\n");
      }),
  );

  servidor.registerTool(
    "diagnostico",
    {
      title: "Diagnóstico do MCP",
      description: [
        "Confere login, NotebookLM e Flow (telas, menus e saldo) e diz exatamente o que está funcionando ou quebrado. Não gasta créditos nem o limite de uso. Use quando algo der erro ou parecer que o Google mudou a tela.",
        "completo=true é o auto-diagnóstico das telas (~30 s): confere CADA botão, menu, diálogo e leitura interna que o MCP usa (NotebookLM, Flow e Google Drive) e, se algo mudou, diz qual item e onde ele fica em src/seletores.ts. Só abre e fecha menus; nada é gerado nem alterado.",
        "Se o tempo da chamada não der para tudo, a resposta diz qual parte faltou: chame de novo com parte (notebooklm, flow ou drive).",
      ].join(" "),
      inputSchema: {
        completo: z.boolean().default(false).describe("true = auto-diagnóstico de todas as telas (~30 s)."),
        parte: z.enum(["tudo", "notebooklm", "flow", "drive"]).default("tudo").describe("Com completo=true: qual parte conferir."),
        notebook: z.string().optional().describe("Com completo=true: notebook usado no teste (padrão: o primeiro seu com fontes)."),
      },
      annotations: LEITURA,
    },
    async ({ completo, parte, notebook }) =>
      tentar(async () => {
        const prazo = novoPrazo();
        const { cliente, limiteSegundos } = infoCliente();
        const linhas = [`mcp-google ${VERSAO} · cliente: ${cliente} · tempo máximo por chamada: ${limiteSegundos}s`, `Arquivos em: ${PASTA_SAIDAS} (flow, notebooklm, notebooklm/roteiros, notebooklm/conversas)`, ...infoNavegador()];
        if (!(await sessaoAtiva(prazo))) return [...linhas, `FALHA - ${MENSAGEM_SEM_SESSAO}`].join("\n");
        linhas.push("OK - sessão do Google ativa");
        if (!completo) {
          for (const [nome, teste] of [["NotebookLM", diagnosticarNotebook], ["Flow", diagnosticarFlow]] as const) {
            try {
              linhas.push(...(await teste(prazo)));
            } catch (erro) {
              linhas.push(`FALHA - ${nome}: ${mensagemDeErro(erro)}`);
            }
          }
          return linhas.join("\n");
        }
        // Auto-diagnóstico: cada parte só começa se ainda houver tempo para ela inteira.
        const partes = parte === "tudo" ? (["notebooklm", "flow", "drive"] as const) : ([parte] as const);
        // Medido (modo Desktop): NotebookLM ~14 s, Flow ~15 s com as telas de personagem (08/10), Drive ~5 s.
        const tempo = { notebooklm: 25000, flow: 25000, drive: 10000 };
        const falhas: string[] = [];
        const faltou: string[] = [];
        for (const qual of partes) {
          if (!prazo.sobra(tempo[qual])) {
            faltou.push(qual);
            continue;
          }
          try {
            if (qual === "flow") {
              const r = await diagnosticarFlow(prazo, true);
              linhas.push(...r.map((l) => l.replace(/^(OK|FALHA) - /, "$1 - Flow: ")));
              falhas.push(...r.filter((l) => l.startsWith("FALHA")).map((l) => `Flow: ${l.slice(8)}`));
            } else {
              const c = qual === "notebooklm" ? await diagnosticarTelasNotebook(prazo, notebook) : await diagnosticarTelasDrive(prazo);
              linhas.push(...c.linhas);
              falhas.push(...c.falhas);
            }
          } catch (erro) {
            linhas.push(`FALHA - ${qual}: ${mensagemDeErro(erro).split("\n")[0]}`);
            falhas.push(`${qual}: não terminou (${mensagemDeErro(erro).split("\n")[0].slice(0, 120)})`);
          }
        }
        linhas.push("");
        linhas.push(
          falhas.length
            ? `RESUMO: ${falhas.length} item(ns) mudaram ou falharam:\n- ${falhas.join("\n- ")}\nOs nomes de botões, textos e leituras ficam em src/seletores.ts (o nome depois da seta). Peça ao Claude Code para remapear a tela.`
            : "RESUMO: tudo o que foi conferido está igual ao que o MCP espera.",
        );
        if (faltou.length) linhas.push(`Sem tempo nesta chamada para: ${faltou.join(", ")}. Chame diagnostico com completo=true e parte=${faltou[0]}.`);
        return linhas.join("\n");
      }),
  );
}
