// Testes do histórico do chat e das citações completas, sem navegador.
// Rodar: npm test   (depois de npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conversaEmMarkdown, descreverCitacoes, montarTrocas } from "../dist/notebook-conversa.js";
import { erroParaOClaude } from "../dist/respostas.js";

// Resposta real do khqZz em 07/10/2026 (notebook de teste sobre tatus), só com os campos que o MCP lê:
// duas perguntas e duas respostas, da mais nova para a mais antiga, como o Google manda.
const [MENSAGENS] = JSON.parse(readFileSync(new URL("./dados/chat-khqZz.json", import.meta.url), "utf8"));
const TITULOS = new Map([
  ["00000000-0000-4000-8000-000000000003", "tatu-galinha.txt"],
  ["00000000-0000-4000-8000-000000000006", "Tatu-galinha - Projeto Fritz Müller - UFSC"],
  ["00000000-0000-4000-8000-000000000010", "tatu-canastra.pdf"],
  ["00000000-0000-4000-8000-000000000013", "Tatu-bola - ficha"],
]);

test("conversa: perguntas e respostas na ordem certa (a mais antiga primeiro)", () => {
  const trocas = montarTrocas(MENSAGENS, TITULOS);
  assert.equal(trocas.length, 2);
  assert.equal(trocas[0].pergunta, "Quanto pesa o tatu-canastra?");
  assert.match(trocas[1].pergunta, /^Liste 4 fatos/);
  assert.match(trocas[1].resposta, /\[2, 3\]/);
});

test("citações: [n] na ordem das passagens, com a fonte e o trecho exato", () => {
  const c = montarTrocas(MENSAGENS, TITULOS)[1].citacoes;
  assert.deepEqual(c.map((x) => x.fonte), ["tatu-galinha.txt", "Tatu-galinha - Projeto Fritz Müller - UFSC", "tatu-galinha.txt", "tatu-canastra.pdf", "Tatu-bola - ficha"]);
  assert.deepEqual(c.map((x) => x.n), [1, 2, 3, 4, 5]);
  assert.match(c[3].trecho, /ate 1,5 m e 60 kg/);
  // Título e parágrafo da fonte ficam em linhas separadas (não "CuriosidadesOs tatus").
  assert.match(c[1].trecho, /^Curiosidades\nOs tatus do gênero Dasypus/);
  assert.ok(!/\n{2,}/.test(c[0].trecho));
});

test("citações: fonte removida do notebook não quebra a leitura", () => {
  const c = montarTrocas(MENSAGENS, new Map())[1].citacoes;
  assert.equal(c[0].fonte, "(fonte removida)");
  assert.ok(c[0].trecho.length > 50);
});

test("conversa: resposta sem a pergunta (histórico cortado) e mensagens estranhas", () => {
  const trocas = montarTrocas([MENSAGENS[0], null, ["x", null, 9]], TITULOS);
  assert.equal(trocas.length, 1);
  assert.equal(trocas[0].pergunta, "");
  assert.equal(trocas[0].citacoes.length, 5);
});

test("conversa: Markdown com perguntas, respostas e trechos citados", () => {
  const md = conversaEmMarkdown({ notebook: "nb", titulo: "Teste", trocas: montarTrocas(MENSAGENS, TITULOS) });
  assert.match(md, /^# Conversa do notebook "Teste"/);
  assert.match(md, /## 2\. Liste 4 fatos/);
  assert.match(md, /\*\*Trechos citados:\*\*/);
  assert.match(md, /\[4\] tatu-canastra\.pdf\n> Ficha tecnica/);
});

test("citações: trecho longo é cortado só no chat", () => {
  const longa = [{ n: 1, fonteId: "a", fonte: "F", trecho: "x".repeat(3000) }];
  assert.ok(descreverCitacoes(longa, 100).length < 200);
  assert.ok(descreverCitacoes(longa, Infinity).length > 3000);
});

test("erros: tela mudada (espera do Playwright) sugere o auto-diagnóstico", () => {
  assert.match(erroParaOClaude(new Error("locator.click: Timeout 30000ms exceeded.")), /diagnostico com completo=true/);
  assert.doesNotMatch(erroParaOClaude(new Error("Saldo insuficiente")), /diagnostico/);
});
