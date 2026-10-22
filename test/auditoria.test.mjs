// Correções da auditoria técnica (14/10/2026): redirecionamento seguro, limites no MP4, travas e gravação atômica.
// Sem rede, login nem navegador. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SAIDAS = mkdtempSync(path.join(tmpdir(), "mcp-google-auditoria-"));
process.env.MCP_GOOGLE_SAIDAS = SAIDAS; // antes de importar os módulos que leem PASTA_SAIDAS

const { baixarComRedirecionamentoSeguro } = await import("../dist/download-seguro.js");
const { linkDeMidiaPermitido, linkDoNotebookPermitido } = await import("../dist/seguranca.js");
const { fecharEmendas } = await import("../dist/emendas.js");
const { inspecionarMp4, salvar, registrar } = await import("../dist/arquivos.js");
const { comTravaDeArquivo, gravarJsonAtomico } = await import("../dist/trava-arquivo.js");
const { lerLotes } = await import("../dist/pendentes.js");

// ---------- ALTA-01: redirecionamento ----------

const resposta = (status, extra = {}) => ({ status, ok: status >= 200 && status < 300, corpo: async () => Buffer.from("dados"), ...extra });
function falso(roteiro) {
  const pedidos = [];
  const salto = async (url) => {
    pedidos.push(url);
    const r = roteiro[url];
    if (!r) throw new Error(`requisição inesperada: ${url}`);
    return r;
  };
  return { salto, pedidos };
}
const OP = { rotulo: "dos servidores do Google", timeoutMs: 5000 };

test("download seguro: Location para fora da lista nunca é requisitado", async () => {
  const f = falso({ "https://lh3.googleusercontent.com/a": resposta(302, { location: "http://127.0.0.1:8080/interno" }) });
  await assert.rejects(baixarComRedirecionamentoSeguro(f.salto, "https://lh3.googleusercontent.com/a", linkDoNotebookPermitido, OP), /redirecionado para fora/);
  assert.deepEqual(f.pedidos, ["https://lh3.googleusercontent.com/a"]);
});

test("download seguro: segue redirecionamento (inclusive relativo) entre endereços permitidos", async () => {
  const f = falso({
    "https://lh3.googleusercontent.com/a": resposta(301, { location: "https://lh4.googleusercontent.com/b" }),
    "https://lh4.googleusercontent.com/b": resposta(307, { location: "/c" }),
    "https://lh4.googleusercontent.com/c": resposta(200),
  });
  const b = await baixarComRedirecionamentoSeguro(f.salto, "https://lh3.googleusercontent.com/a", linkDoNotebookPermitido, OP);
  assert.equal(b.toString(), "dados");
  assert.equal(f.pedidos.length, 3);
});

test("download seguro: endereço inicial fora da lista, sem Location, laço e erro HTTP", async () => {
  const f = falso({});
  await assert.rejects(baixarComRedirecionamentoSeguro(f.salto, "http://169.254.169.254/latest", linkDeMidiaPermitido, OP), /fora dos servidores do Google; recusado/);
  assert.equal(f.pedidos.length, 0);

  const sem = falso({ "https://flow-content.google/x": resposta(302) });
  await assert.rejects(baixarComRedirecionamentoSeguro(sem.salto, "https://flow-content.google/x", linkDeMidiaPermitido, OP), /sem destino/);

  const laco = falso({ "https://flow-content.google/x": resposta(302, { location: "https://flow-content.google/x" }) });
  await assert.rejects(baixarComRedirecionamentoSeguro(laco.salto, "https://flow-content.google/x", linkDeMidiaPermitido, OP), /Redirecionamentos demais/);
  assert.equal(laco.pedidos.length, 6);

  const erro = falso({ "https://flow-content.google/x": resposta(404) });
  await assert.rejects(baixarComRedirecionamentoSeguro(erro.salto, "https://flow-content.google/x", linkDeMidiaPermitido, OP), /HTTP 404/);
});

// ---------- ALTA-02 / BAIXA-01: leitores de MP4 ----------

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const caixa = (tipo, ...partes) => { const c = Buffer.concat(partes); return Buffer.concat([u32(8 + c.length), Buffer.from(tipo, "latin1"), c]); };
const mdhd = caixa("mdhd", Buffer.alloc(24));
const hdlr = caixa("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from("vide"), Buffer.alloc(12)]));
function mp4(stbl) {
  const trak = caixa("trak", caixa("mdia", mdhd, hdlr, caixa("minf", caixa("stbl", ...stbl))));
  return Buffer.concat([caixa("ftyp", Buffer.from("isom0000")), caixa("moov", caixa("mvhd", Buffer.alloc(100)), trak), caixa("mdat", Buffer.alloc(16))]);
}
const sttsOk = caixa("stts", u32(0), u32(1), u32(2), u32(10));
const stszOk = caixa("stsz", u32(0), u32(0), u32(2), u32(100), u32(100));
const stscOk = caixa("stsc", u32(0), u32(1), u32(1), u32(2), u32(1));
const stcoOk = caixa("stco", u32(0), u32(1), u32(0));

test("MP4: tabelas com contagem absurda ou truncadas devolvem null sem alocar nem estourar", () => {
  const t0 = Date.now();
  const casos = {
    "stts: 1 par repetindo 4 bilhões de amostras": [caixa("stts", u32(0), u32(1), u32(0xffffffff), u32(10)), stszOk, stscOk, stcoOk],
    "stts: 2 bilhões de pares": [caixa("stts", u32(0), u32(0x7fffffff)), stszOk, stscOk, stcoOk],
    "stsz: 4 bilhões de amostras": [sttsOk, caixa("stsz", u32(0), u32(0), u32(0xffffffff)), stscOk, stcoOk],
    "stsz com tamanho fixo e 4 bilhões de amostras": [sttsOk, caixa("stsz", u32(0), u32(4), u32(0xffffffff)), stscOk, stcoOk],
    "stco: 4 bilhões de chunks": [sttsOk, stszOk, stscOk, caixa("stco", u32(0), u32(0xffffffff))],
    "stsc: 4 bilhões de regras": [sttsOk, stszOk, caixa("stsc", u32(0), u32(0xffffffff)), stcoOk],
    "stsz truncada (só o cabeçalho)": [sttsOk, caixa("stsz", u32(0)), stscOk, stcoOk],
    "stts truncada": [caixa("stts", u32(0)), stszOk, stscOk, stcoOk],
  };
  for (const [nome, tabelas] of Object.entries(casos)) assert.equal(fecharEmendas(mp4(tabelas)), null, nome);
  // cortes em qualquer ponto de um arquivo válido também não podem lançar
  const inteiro = mp4([sttsOk, stszOk, stscOk, stcoOk]);
  for (let corte = 0; corte < inteiro.length; corte += 7) assert.doesNotThrow(() => fecharEmendas(inteiro.subarray(0, corte)));
  // caixa de 64 bits sem os 8 bytes do tamanho
  assert.equal(fecharEmendas(Buffer.concat([u32(1), Buffer.from("free"), Buffer.alloc(3)])), null);
  assert.ok(Date.now() - t0 < 3000, "nada de laço enorme");
});

test("inspecionarMp4: arquivo truncado ou com tkhd/mvhd fora dos limites não lança", () => {
  const ftyp = caixa("ftyp", Buffer.from("isom0000"));
  const arquivos = {
    "so-ftyp.mp4": ftyp,
    "mvhd-truncado.mp4": Buffer.concat([ftyp, u32(100), Buffer.from("mvhd"), Buffer.alloc(10)]),
    "tkhd-gigante.mp4": Buffer.concat([ftyp, u32(0xffffffff), Buffer.from("tkhd"), Buffer.alloc(10)]),
    "tkhd-no-fim.mp4": Buffer.concat([ftyp, Buffer.from("tkhd")]),
  };
  for (const [nome, dados] of Object.entries(arquivos)) {
    const arq = path.join(SAIDAS, nome);
    writeFileSync(arq, dados);
    assert.equal(inspecionarMp4(arq).duracao, 0, nome);
  }
  const ruim = path.join(SAIDAS, "nao-mp4.mp4");
  writeFileSync(ruim, Buffer.from("xx"));
  assert.throws(() => inspecionarMp4(ruim), /não é um MP4 válido/);
});

// ---------- MEDIA-01 / MEDIA-03: trava por arquivo e gravação atômica ----------

test("trava de arquivo: libera mesmo se o trecho lançar; é reentrante; quebra trava esquecida", () => {
  const arq = path.join(SAIDAS, "estado.json");
  assert.throws(() => comTravaDeArquivo(arq, () => { throw new Error("boom"); }), /boom/);
  assert.ok(!existsSync(arq + ".lock"));
  assert.equal(comTravaDeArquivo(arq, () => comTravaDeArquivo(arq, () => 7)), 7);
  writeFileSync(arq + ".lock", "");
  const velho = new Date(Date.now() - 60000);
  utimesSync(arq + ".lock", velho, velho);
  assert.equal(comTravaDeArquivo(arq, () => "ok"), "ok");
});

test("gravação atômica: substitui o arquivo inteiro e não deixa temporários", () => {
  const arq = path.join(SAIDAS, "config-teste.json");
  writeFileSync(arq, "{ lixo pela metade");
  gravarJsonAtomico(arq, { flowProjeto: "abc" });
  assert.deepEqual(JSON.parse(readFileSync(arq, "utf8")), { flowProjeto: "abc" });
  assert.deepEqual(readdirSync(SAIDAS).filter((n) => n.endsWith(".tmp")), []);
});

test("alterarLotes: vários processos acrescentando ao mesmo pendentes.json não perdem gravações", async () => {
  const dist = pathToFileURL(path.resolve("dist", "pendentes.js")).href;
  const codigo = [
    `const { alterarLotes } = await import(${JSON.stringify(dist)});`,
    "const id = process.argv[1];",
    'for (let i = 0; i < 15; i++) alterarLotes((ls) => [...ls, { lote: id + "-" + i }]);',
  ].join("\n");
  const filhos = [0, 1, 2, 3].map((n) => new Promise((ok, falha) => {
    const f = spawn(process.execPath, ["--input-type=module", "-e", codigo, `p${n}`], { env: process.env, stdio: "inherit" });
    f.on("exit", (c) => (c === 0 ? ok() : falha(new Error(`filho ${n} saiu com ${c}`))));
  }));
  await Promise.all(filhos);
  const lotes = lerLotes();
  assert.equal(lotes.length, 60);
  assert.equal(new Set(lotes.map((l) => l.lote)).size, 60);
});

// ---------- MEDIA-02 / BAIXA-02 ----------

test("salvar: criação exclusiva, nunca sobrescreve e numera os repetidos", () => {
  const pasta = path.join(SAIDAS, "salvar");
  const a = salvar("x.txt", "um", pasta);
  const b = salvar("x.txt", "dois", pasta);
  const c = salvar("x.txt", "tres", pasta);
  assert.deepEqual([a, b, c].map((p) => path.basename(p)), ["x.txt", "x-2.txt", "x-3.txt"]);
  assert.equal(readFileSync(a, "utf8"), "um");
  assert.equal(readFileSync(b, "utf8"), "dois");
});

test("registrar: cada chamada vira uma linha JSON inteira em geracoes.jsonl", () => {
  for (let i = 0; i < 20; i++) registrar({ acao: "teste", i });
  const linhas = readFileSync(path.join(SAIDAS, "geracoes.jsonl"), "utf8").trim().split("\n");
  assert.equal(linhas.length, 20);
  assert.deepEqual(linhas.map((l) => JSON.parse(l).i), [...Array(20).keys()]);
  assert.ok(!existsSync(path.join(SAIDAS, "geracoes.jsonl.lock")));
});

// ---------- Trava: nunca gira sem prazo ----------

test("trava de arquivo: lock impossível de remover (é uma pasta) estoura o prazo em vez de girar", () => {
  const arq = path.join(SAIDAS, "preso.json");
  mkdirSync(arq + ".lock");
  const velho = new Date(Date.now() - 60000);
  utimesSync(arq + ".lock", velho, velho);
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  assert.throws(() => comTravaDeArquivo(arq, () => 1, 400), /Não consegui a trava/);
  const gasto = Date.now() - t0;
  assert.ok(gasto >= 300 && gasto < 3000, `levou ${gasto} ms`);
  const cpu = process.cpuUsage(cpu0);
  assert.ok((cpu.user + cpu.system) / 1000 < gasto * 0.7, "dorme entre as tentativas, sem ocupar a CPU");
});

test("trava de arquivo: pasta que não pode conter a trava falha na hora com o erro de origem", () => {
  const arquivoComoPasta = path.join(SAIDAS, "e-um-arquivo");
  writeFileSync(arquivoComoPasta, "x");
  const t0 = Date.now();
  assert.throws(() => comTravaDeArquivo(path.join(arquivoComoPasta, "estado.json"), () => 1, 5000));
  assert.ok(Date.now() - t0 < 1000);
});

test("gravação atômica: se o rename falha, o temporário é removido", () => {
  const destino = path.join(SAIDAS, "destino-pasta");
  mkdirSync(destino);
  assert.throws(() => gravarJsonAtomico(destino, { a: 1 }));
  assert.deepEqual(readdirSync(SAIDAS).filter((n) => n.startsWith("destino-pasta.") && n.endsWith(".tmp")), []);
});

// ---------- Roteiro: reserva e mescla (I-3) ----------

test("roteiro: reservarCena grava só a cena e o gasto; segunda reserva da mesma cena é recusada", async () => {
  const { reservarCena, marcarErroCena } = await import("../dist/roteiro.js");
  const disco = () => [{ id: "r1", gasto: 0, cenas: [{ prompt: "a" }, { prompt: "b" }] }];
  const lista = disco();
  reservarCena(lista, "r1", 0, { lote: "L1", custo: 20 });
  assert.equal(lista[0].cenas[0].lote, "L1");
  assert.equal(lista[0].gasto, 20);
  assert.equal(lista[0].cenas[1].lote, undefined);
  // a "outra janela" chega depois, com o disco já atualizado: não pode enviar de novo
  assert.throws(() => reservarCena(lista, "r1", 0, { lote: "L2", custo: 20 }), /outra janela/);
  assert.equal(lista[0].cenas[0].lote, "L1");
  assert.equal(lista[0].gasto, 20);
  // cena marcada com erro também não é enviada; erro não sobrescreve cena já enviada
  marcarErroCena(lista, "r1", 1, "falhou");
  assert.throws(() => reservarCena(lista, "r1", 1, { lote: "L3", custo: 20 }), /outra janela/);
  marcarErroCena(lista, "r1", 0, "tarde demais");
  assert.equal(lista[0].cenas[0].erro, undefined);
  assert.throws(() => reservarCena(lista, "sumiu", 0, { lote: "L4", custo: 1 }), /não existe mais/);
});

test("roteiro: desfazerReservaCena limpa o lote e devolve o gasto, só se a reserva é a nossa", async () => {
  const { reservarCena, desfazerReservaCena, marcarErroCena } = await import("../dist/roteiro.js");
  const lista = [{ id: "r1", gasto: 5, cenas: [{ prompt: "a" }, { prompt: "b" }] }];
  reservarCena(lista, "r1", 0, { lote: "L1", custo: 20 });
  // outra reserva (lote diferente) não é desfeita
  desfazerReservaCena(lista, "r1", 0, { lote: "OUTRO", custo: 20 });
  assert.equal(lista[0].cenas[0].lote, "L1");
  assert.equal(lista[0].gasto, 25);
  desfazerReservaCena(lista, "r1", 0, { lote: "L1", custo: 20 });
  assert.equal(lista[0].cenas[0].lote, undefined);
  assert.equal(lista[0].gasto, 5);
  // depois do desfazer a cena pode ser marcada com erro e o gasto nunca fica negativo
  marcarErroCena(lista, "r1", 0, "falhou");
  assert.equal(lista[0].cenas[0].erro, "falhou");
  reservarCena(lista, "r1", 1, { lote: "L2", custo: 50 });
  lista[0].gasto = 10;
  desfazerReservaCena(lista, "r1", 1, { lote: "L2", custo: 50 });
  assert.equal(lista[0].gasto, 0);
  desfazerReservaCena(lista, "sumiu", 0, { lote: "x", custo: 1 }); // não lança
});
