import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { z } from "zod";
import { tipoMime } from "../flow.js";
import { LEITURA, texto } from "../respostas.js";
import { HTML_VISUALIZADOR, MIME_APP, URI_VISUALIZADOR } from "../visualizador.js";
import { PASTAS_DE_ARQUIVOS } from "../config.js";
import { caminhoDeSaida, mensagemDeErro, TAMANHO_MAX_PARA_CHAT } from "../seguranca.js";

// Visualizador do Claude Desktop (MCP Apps) e a ferramenta interna que entrega os arquivos a ele.
const PARTE_ARQUIVO = 6 * 1024 * 1024;

export function registrarVisualizador(servidor: McpServer): RegisteredTool {
  servidor.registerResource(
    "visualizador",
    URI_VISUALIZADOR,
    {
      title: "Visualizador do mcp-google",
      description: "Prévia das imagens e vídeos gerados, com botões para baixar e assistir.",
      mimeType: MIME_APP,
    },
    async () => ({
      contents: [{ uri: URI_VISUALIZADOR, mimeType: MIME_APP, text: HTML_VISUALIZADOR, _meta: { ui: { prefersBorder: true } } }],
    }),
  );

  return servidor.registerTool(
    "flow_arquivo",
    {
      title: "Arquivo para o visualizador",
      description:
        "Uso interno do visualizador do Claude Desktop (botões Baixar/Assistir/Ouvir): devolve um arquivo da pasta de saídas, em partes. Não use diretamente.",
      inputSchema: {
        nome: z.string().max(200).describe("Nome do arquivo dentro da pasta de saídas."),
        parte: z.number().int().min(0).max(9).default(0).describe("Parte do arquivo (0, 1, 2…)."),
      },
      annotations: LEITURA,
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ nome, parte }) => {
      try {
        const caminho = caminhoDeSaida(PASTAS_DE_ARQUIVOS, nome);
        // O SDK do MCP recusa mensagens acima de 10 MB (STDIO_DEFAULT_MAX_BUFFER_SIZE) e derruba a
        // conexão. Por isso o arquivo vai em partes de 6 MB (múltiplo de 3: os pedaços em base64 podem
        // ser emendados direto pelo visualizador).
        // Abre uma vez, confere pelo próprio arquivo aberto e lê só o pedaço pedido.
        const fd = openSync(caminho, "r");
        try {
          const info = fstatSync(fd);
          if (!info.isFile() || info.size > TAMANHO_MAX_PARA_CHAT) throw new Error("Arquivo inválido.");
          const partes = Math.max(1, Math.ceil(info.size / PARTE_ARQUIVO));
          if (parte >= partes) throw new Error(`Parte ${parte} não existe (o arquivo tem ${partes}).`);
          const pedaco = Buffer.alloc(Math.max(0, Math.min(PARTE_ARQUIVO, info.size - parte * PARTE_ARQUIVO)));
          readSync(fd, pedaco, 0, pedaco.length, parte * PARTE_ARQUIVO);
          return {
            content: [
              { type: "resource" as const, resource: { uri: `mcp-google://saidas/${encodeURIComponent(nome)}`, mimeType: tipoMime(caminho), blob: pedaco.toString("base64") } },
            ],
            // versao: o visualizador desiste se o arquivo mudar entre uma parte e outra.
            structuredContent: { parte, partes, tamanho: info.size, versao: info.mtimeMs },
          };
        } finally {
          closeSync(fd);
        }
      } catch (erro) {
        return { ...texto(`Erro: ${mensagemDeErro(erro)}`), isError: true };
      }
    },
  );
}
