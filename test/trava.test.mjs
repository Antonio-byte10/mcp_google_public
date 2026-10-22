// Testes da trava do perfil entre processos (named pipe) e de regras novas de segurança.
// Não abrem navegador. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pegarTrava, nomeDaTrava, quemSegura } from "../dist/trava.js";
import { hostPermitido, linkDoNotebookPermitido, mensagemDeErro } from "../dist/seguranca.js";

const nome = nomeDaTrava(mkdtempSync(path.join(tmpdir(), "mcp-google-trava-")));
const info = (app, ate = Date.now() + 60000) => ({ pid: process.pid, app, desde: Date.now(), ate });

test("trava: só um dono por vez; o segundo espera e pega quando o primeiro solta", async () => {
  const a = await pegarTrava(nome, info("claude-code"), 1000);
  const t0 = Date.now();
  setTimeout(() => a.soltar(), 600);
  const b = await pegarTrava(nome, info("claude-ai"), 5000);
  assert.ok(Date.now() - t0 >= 500, "o segundo deveria ter esperado");
  b.soltar();
});

test("trava: quem espera demais desiste com mensagem dizendo quem segura (e se parece travado)", async () => {
  const a = await pegarTrava(nome, info("claude-ai", Date.now() - 120000), 1000);
  const dono = await quemSegura(nome);
  assert.equal(dono?.app, "claude-ai");
  await assert.rejects(pegarTrava(nome, info("claude-code"), 800), /Claude Desktop .* parece travado/);
  a.soltar();
});

test("trava: processo que morre (sem soltar) libera a trava sozinho", async () => {
  const pasta = mkdtempSync(path.join(tmpdir(), "mcp-google-filho-"));
  const script = path.join(pasta, "filho.mjs");
  const dist = new URL("../dist/trava.js", import.meta.url).href;
  writeFileSync(script, `import { pegarTrava } from ${JSON.stringify(dist)};
await pegarTrava(${JSON.stringify(nome)}, { pid: process.pid, app: "claude-code", desde: Date.now(), ate: Date.now() + 60000 }, 1000);
process.send("pegou"); setInterval(() => {}, 1000);`);
  const filho = fork(script, { stdio: "ignore" });
  await new Promise((ok) => filho.once("message", ok));
  await assert.rejects(pegarTrava(nome, info("claude-ai"), 300), /em uso/);
  filho.kill("SIGKILL"); // morte à força: nenhum código de limpeza roda
  await new Promise((ok) => filho.once("exit", ok));
  const t = await pegarTrava(nome, info("claude-ai"), 3000);
  t.soltar();
});

test("erros: cookies e tokens não passam, nem no meio do texto", () => {
  const sujo = [
    'request failed: {"cookie": "SID=abc; foo=bar", "authorization": "SAPISIDHASH 1700_deadbeef"}',
    "__Host-1PLSID=segredo1; __Host-GAPS=segredo2; AEC=segredo3",
    "x-goog-authuser: 0",
    "Browser logs:\n<launching> msedge.exe --user-data-dir=C:\\Users\\Fulano\\perfil",
  ].join("\n");
  const limpo = mensagemDeErro(new Error(sujo));
  for (const segredo of ["abc", "foo=bar", "deadbeef", "segredo1", "segredo2", "segredo3", "Fulano"]) {
    assert.ok(!limpo.includes(segredo), `vazou "${segredo}": ${limpo}`);
  }
});

test("navegação: about:blank é permitido (aba vazia); outros esquemas não", () => {
  assert.ok(hostPermitido("about:blank"));
  assert.ok(!hostPermitido("about:config"));
  assert.ok(!hostPermitido("chrome://settings"));
  assert.ok(!hostPermitido("javascript:alert(1)"));
});

test("NotebookLM: downloads só de lh3-lh6 e dos servidores de download (não de qualquer googleusercontent)", () => {
  assert.ok(linkDoNotebookPermitido("https://lh3.googleusercontent.com/notebooklm/x=m22-dv"));
  assert.ok(linkDoNotebookPermitido("https://drum.usercontent.google.com/download/x"));
  assert.ok(!linkDoNotebookPermitido("https://script.googleusercontent.com/macros/x"));
  assert.ok(!linkDoNotebookPermitido("https://sites.googleusercontent.com/x"));
  assert.ok(!linkDoNotebookPermitido("https://evil.usercontent.google.com.evil.com/x"));
});

test("visualizador: partes de 6 MB emendam em base64 sem corromper (múltiplo de 3)", () => {
  const PARTE = 6 * 1024 * 1024;
  assert.equal(PARTE % 3, 0);
  const dados = Buffer.alloc(PARTE * 2 + 12345);
  for (let i = 0; i < dados.length; i++) dados[i] = (i * 7) & 255;
  const pedacos = [];
  for (let p = 0; p * PARTE < dados.length; p++) pedacos.push(dados.subarray(p * PARTE, (p + 1) * PARTE).toString("base64"));
  assert.ok(Buffer.from(pedacos.join(""), "base64").equals(dados));
});
