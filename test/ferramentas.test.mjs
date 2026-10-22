// Prova de que a superfície das ferramentas MCP não muda numa refatoração: sobe o servidor,
// lista as ferramentas (não chama nenhuma, não abre navegador) e compara nome + resumo
// (sha256 de descrição, esquema de entrada e anotações) com a fixture test/dados/ferramentas.json.
// A pasta de dados é apontada para a raiz (MCP_GOOGLE_DADOS) e as descrições que a citam são normalizadas:
// o hash não depende de onde o repositório nem o %LOCALAPPDATA% estão.
// Para regenerar de propósito: MCP_GOOGLE_GERAR_FIXTURE=1 node --test test/ferramentas.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(raiz, "test", "dados", "ferramentas.json");

const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

async function listar() {
  const c = new Client({ name: "teste-ferramentas", version: "0" });
  await c.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(raiz, "dist", "index.js")],
    stderr: "ignore",
    env: { ...process.env, MCP_GOOGLE_NAVEGADOR: "chrome", MCP_GOOGLE_DADOS: raiz, MCP_GOOGLE_TETO_DIARIO: "" },
  }));
  try {
    const { tools } = await c.listTools();
    return tools
      .map((t) => ({ nome: t.name, descricao: sha((t.description ?? "").split(raiz).join("<RAIZ>")), esquema: sha(t.inputSchema), anotacoes: sha([t.title, t.annotations, t._meta]) }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  } finally {
    await c.close();
  }
}

test("as 58 ferramentas MCP continuam idênticas (nome, descrição, esquema)", async () => {
  const atual = await listar();
  if (process.env.MCP_GOOGLE_GERAR_FIXTURE) writeFileSync(fixture, JSON.stringify(atual, null, 1) + "\n");
  const esperado = JSON.parse(readFileSync(fixture, "utf8"));
  assert.equal(atual.length, 58);
  assert.deepEqual(atual, esperado);
});
