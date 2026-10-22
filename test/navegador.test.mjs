// Testes da escolha do navegador e da pasta de perfil. Funções puras: não abrem navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { NAVEGADORES, acharExecutavel, caminhosCandidatos, escolherNavegador, escolherPastaPerfil, opcoesDeLancamento } from "../dist/navegador-tipos.js";

const todos = () => true;
const nenhum = () => false;
const so = (id) => (x) => x === id;

test("padrão é o Edge quando instalado", () => {
  const e = escolherNavegador(undefined, todos);
  assert.equal(e.navegador.id, "edge");
  assert.equal(e.aviso, undefined);
});

test("variável válida manda (sem aviso, case e espaços tolerados)", () => {
  assert.equal(escolherNavegador("edge", todos).navegador.id, "edge");
  assert.equal(escolherNavegador(" Chrome ", todos).navegador.id, "chrome");
});

test("variável inválida dá erro claro", () => {
  assert.throws(() => escolherNavegador("firefox", todos), /MCP_GOOGLE_NAVEGADOR inválido/);
});

test("sem variável e sem Edge, cai no Chrome com aviso", () => {
  const e = escolherNavegador(undefined, so("chrome"));
  assert.equal(e.navegador.id, "chrome");
  assert.match(e.aviso, /Microsoft Edge não foi encontrado/);
});

test("variável definida nunca cai no outro navegador", () => {
  assert.equal(escolherNavegador("chrome", so("edge")).navegador.id, "chrome");
  assert.equal(escolherNavegador("edge", so("chrome")).navegador.id, "edge");
});

test("nenhum instalado mantém o padrão", () => {
  assert.equal(escolherNavegador(undefined, nenhum).navegador.id, "edge");
});

test("definições dos navegadores", () => {
  assert.deepEqual([NAVEGADORES.chrome.channel, NAVEGADORES.chrome.processo, NAVEGADORES.chrome.pastaPerfil], ["chrome", "chrome.exe", "perfil-chrome"]);
  assert.deepEqual([NAVEGADORES.edge.channel, NAVEGADORES.edge.processo, NAVEGADORES.edge.pastaPerfil], ["msedge", "msedge.exe", "perfil-edge"]);
  assert.equal(NAVEGADORES.chrome.rotulo, "Google Chrome");
  assert.equal(NAVEGADORES.edge.rotulo, "Microsoft Edge");
});

test("caminhos candidatos usam as pastas do ambiente", () => {
  const env = { ProgramFiles: "D:\\PF", "ProgramFiles(x86)": "D:\\PF86", LOCALAPPDATA: "D:\\Local" };
  const c = caminhosCandidatos("chrome", env);
  assert.deepEqual(c, ["D:\\PF\\Google\\Chrome\\Application\\chrome.exe", "D:\\PF86\\Google\\Chrome\\Application\\chrome.exe", "D:\\Local\\Google\\Chrome\\Application\\chrome.exe"]);
  assert.equal(acharExecutavel("chrome", (x) => x.startsWith("D:\\Local"), env), c[2]);
  assert.equal(acharExecutavel("edge", nenhum, env), undefined);
});

const raiz = path.join("C:", "proj");
const chrome = NAVEGADORES.chrome;
const edge = NAVEGADORES.edge;
const com = (...pastas) => (p) => pastas.some((x) => p === path.join(raiz, x));

test("Chrome usa perfil-chrome, mesmo existindo o perfil antigo", () => {
  assert.equal(escolherPastaPerfil({ raiz, navegador: chrome, existe: com("perfil") }), path.join(raiz, "perfil-chrome"));
});

test("Edge reaproveita perfil/ antigo só se perfil-edge não existe", () => {
  assert.equal(escolherPastaPerfil({ raiz, navegador: edge, existe: com("perfil") }), path.join(raiz, "perfil"));
  assert.equal(escolherPastaPerfil({ raiz, navegador: edge, existe: com("perfil", "perfil-edge") }), path.join(raiz, "perfil-edge"));
  assert.equal(escolherPastaPerfil({ raiz, navegador: edge, existe: com() }), path.join(raiz, "perfil-edge"));
});

test("MCP_GOOGLE_PERFIL manda na pasta", () => {
  assert.equal(escolherPastaPerfil({ perfilEnv: "X:\\meu", raiz, navegador: edge, existe: com("perfil") }), "X:\\meu");
});

test("lançamento usa o mesmo executável do login e mantém os argumentos", () => {
  const o = opcoesDeLancamento(NAVEGADORES.chrome, "C:/x/chrome.exe", true, 1234);
  assert.equal(o.executablePath, "C:/x/chrome.exe");
  assert.equal("channel" in o, false);
  assert.deepEqual(o.ignoreDefaultArgs, ["--enable-automation"]);
  assert.equal(o.timeout, 1234);
  assert.equal(o.headless, true);
  assert.equal(opcoesDeLancamento(NAVEGADORES.edge, undefined, false, 1).channel, "msedge");
});
