// Testes da pasta de dados (fora da pasta do código) e do teto diário de créditos.
// Funções puras: não abrem navegador nem tocam no disco. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { avisoDadosAntigos, escolherPastaDados } from "../dist/pastas.js";
import { TETO_DIARIO_PADRAO, conferirTetoDiario, descreverTeto, lerTetoDiario } from "../dist/teto.js";

// ---------- Pasta de dados ----------

test("dados: padrão é %LOCALAPPDATA%\\mcp-google", () => {
  assert.equal(escolherPastaDados({ localAppData: "C:\\Users\\x\\AppData\\Local", home: "C:\\Users\\x" }), path.join("C:\\Users\\x\\AppData\\Local", "mcp-google"));
});

test("dados: MCP_GOOGLE_DADOS manda (espaços em volta ignorados)", () => {
  assert.equal(escolherPastaDados({ dadosEnv: "  X:\\dados  ", localAppData: "C:\\L", home: "C:\\H" }), path.resolve("X:\\dados"));
  assert.equal(escolherPastaDados({ dadosEnv: "   ", localAppData: "C:\\L", home: "C:\\H" }), path.join("C:\\L", "mcp-google"));
});

test("dados: sem LOCALAPPDATA (fora do Windows) usa ~/.mcp-google", () => {
  assert.equal(escolherPastaDados({ home: "/home/x" }), path.join("/home/x", ".mcp-google"));
});

test("dados antigos na pasta do código geram aviso com o que foi achado", () => {
  const raiz = path.resolve("D:\\codigo");
  const existe = (c) => [path.join(raiz, "perfil"), path.join(raiz, "saidas")].includes(c);
  const aviso = avisoDadosAntigos({ raiz, dados: path.resolve("C:\\L\\mcp-google"), existe });
  assert.match(aviso, /perfil, saidas/);
  assert.match(aviso, /C:\\L\\mcp-google/);
});

test("sem dados antigos, ou com a pasta de dados igual à do código, não há aviso", () => {
  const raiz = path.resolve("D:\\codigo");
  assert.equal(avisoDadosAntigos({ raiz, dados: path.resolve("C:\\L\\mcp-google"), existe: () => false }), undefined);
  assert.equal(avisoDadosAntigos({ raiz, dados: raiz, existe: () => true }), undefined);
});

// ---------- Teto diário ----------

test("teto: padrão quando a variável não existe ou está vazia", () => {
  assert.equal(lerTetoDiario(undefined), TETO_DIARIO_PADRAO);
  assert.equal(lerTetoDiario(" "), TETO_DIARIO_PADRAO);
  assert.equal(TETO_DIARIO_PADRAO, 200);
});

test("teto: número vale; 'sem' desliga; outro valor é erro na partida", () => {
  assert.equal(lerTetoDiario("500"), 500);
  assert.equal(lerTetoDiario("0"), 0);
  assert.equal(lerTetoDiario(" SEM "), null);
  for (const ruim of ["-5", "1.5", "muito", "200 créditos"]) assert.throws(() => lerTetoDiario(ruim), /MCP_GOOGLE_TETO_DIARIO inválido/, ruim);
});

test("teto: barra só o que passaria do teto do dia", () => {
  assert.doesNotThrow(() => conferirTetoDiario(20, 180, 200)); // chega exatamente no teto
  assert.throws(() => conferirTetoDiario(20, 181, 200), /hoje já foram 181 créditos e esta geração custa 20.*teto de 200.*Nada foi gerado/);
  assert.throws(() => conferirTetoDiario(10, 0, 0), /teto de 0/);
});

test("teto: custo 0 (imagem grátis) sempre passa; sem teto nada é barrado", () => {
  assert.doesNotThrow(() => conferirTetoDiario(0, 999, 0));
  assert.doesNotThrow(() => conferirTetoDiario(1000, 5000, null));
});

test("teto: descrição para as instruções", () => {
  assert.match(descreverTeto(200), /teto diário de 200 créditos/);
  assert.match(descreverTeto(null), /sem teto/);
});
