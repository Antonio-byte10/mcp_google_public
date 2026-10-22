import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registrarNotebooksEFontes } from "./ferramentas/notebook-gestao.js";
import { registrarConversaRoteiroNotas } from "./ferramentas/notebook-conversa.js";
import { registrarEstudioGerar } from "./ferramentas/notebook-estudio-gerar.js";
import { registrarEstudioItens } from "./ferramentas/notebook-estudio-itens.js";

// Ferramentas do NotebookLM (Gemini Notebook): notebooks, fontes, chat, notas e Estúdio.
// Cada tema mora em src/ferramentas/notebook-*.ts; aqui só se registra na ordem de sempre.
export function registrarFerramentasNotebook(servidor: McpServer): void {
  registrarNotebooksEFontes(servidor);
  registrarConversaRoteiroNotas(servidor);
  registrarEstudioGerar(servidor);
  registrarEstudioItens(servidor);
}
