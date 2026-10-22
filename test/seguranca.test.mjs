// Testes das regras de segurança (não abrem navegador nem gastam créditos).
// Rodar: npm test   (depois de npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  caminhoDeSaida, ehTelaDeLogin, extensaoDaImagem, hostPermitido, linkDeImagemDoFlowPermitido, linkDeMidiaPermitido, linkDoNotebookPermitido, mensagemDeErro,
  validarArquivoFonte, validarImagemLocal,
} from "../dist/seguranca.js";

const pasta = mkdtempSync(path.join(tmpdir(), "mcp-google-teste-"));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test("aceita só sites do Google previstos, em https", () => {
  assert.ok(hostPermitido("https://flow.google.com/project/x"));
  assert.ok(hostPermitido("https://notebook.google.com/"));
  // Drive e Docs: só para levar slides ao Apresentações (0.12.0).
  assert.ok(hostPermitido("https://drive.google.com/drive/my-drive"));
  assert.ok(hostPermitido("https://docs.google.com/presentation/d/abc/edit"));
  assert.ok(!hostPermitido("https://docs.google.com.evil.com/"));
  assert.ok(!hostPermitido("https://sites.google.com/"));
  assert.ok(!hostPermitido("http://flow.google.com/"));
  assert.ok(!hostPermitido("https://flow.google.com.evil.com/"));
  assert.ok(!hostPermitido("https://evil.com/?flow.google.com"));
  assert.ok(!hostPermitido("file:///C:/Windows/win.ini"));
});

test("downloads só do servidor de mídia do Flow", () => {
  assert.ok(linkDeMidiaPermitido("https://flow-content.google/video/abc?Signature=x"));
  assert.ok(!linkDeMidiaPermitido("http://flow-content.google/video/abc"));
  assert.ok(!linkDeMidiaPermitido("https://flow-content.google.evil.com/video/abc"));
  assert.ok(!linkDeMidiaPermitido("https://example.com/flow-content.google"));
});

test("reconhece a tela de login (sessão expirada)", () => {
  assert.ok(ehTelaDeLogin("https://accounts.google.com/v3/signin/identifier?continue=x"));
  assert.ok(!ehTelaDeLogin("https://flow.google.com/"));
});

test("mensagens de erro não levam cookies, assinaturas nem o call log", () => {
  const erro = new Error(
    "route.fetch: Timeout 30000ms exceeded.\nCall log:\n  - → POST https://flow.google.com/x?f.sid=123\n    - cookie: SID=abc; __Secure-1PSID=def; NID=ghi\n",
  );
  const limpa = mensagemDeErro(erro);
  assert.equal(limpa, "route.fetch: Timeout 30000ms exceeded.");
  const outra = mensagemDeErro("baixando https://flow-content.google/video/x?Expires=1&KeyName=k&Signature=SEGREDO SID=abc; __Secure-3PSIDTS=xyz");
  for (const segredo of ["SEGREDO", "SID=abc", "xyz"]) assert.ok(!outra.includes(segredo), `vazou ${segredo}: ${outra}`);
});

test("upload de quadro: aceita PNG/JPG de verdade", () => {
  const png = path.join(pasta, "ok.png");
  const jpg = path.join(pasta, "ok.jpeg");
  writeFileSync(png, PNG);
  writeFileSync(jpg, JPG);
  assert.equal(validarImagemLocal(png), png);
  assert.equal(validarImagemLocal(jpg), jpg);
});

test("upload de quadro: recusa o que não é imagem", () => {
  const disfarcado = path.join(pasta, "senhas.jpg");
  writeFileSync(disfarcado, "usuario=admin senha=123");
  assert.throws(() => validarImagemLocal(disfarcado), /não é um JPEG/);
  const texto = path.join(pasta, "notas.txt");
  writeFileSync(texto, "oi");
  assert.throws(() => validarImagemLocal(texto), /Formato não aceito/);
  assert.throws(() => validarImagemLocal("relativo.png"), /caminho completo/);
  assert.throws(() => validarImagemLocal(path.join(pasta, "nao-existe.png")), /não encontrada/);
  assert.throws(() => validarImagemLocal(pasta), /não é um arquivo|Formato/);
});

test("upload de quadro: recusa atalho (link simbólico)", (t) => {
  const alvo = path.join(pasta, "alvo.png");
  writeFileSync(alvo, PNG);
  const link = path.join(pasta, "atalho.png");
  try {
    symlinkSync(alvo, link);
  } catch {
    t.skip("sem permissão para criar link simbólico neste Windows");
    return;
  }
  assert.throws(() => validarImagemLocal(link), /links simbólicos/);
});

test("reconhece a extensão real do arquivo baixado", () => {
  assert.equal(extensaoDaImagem(PNG), "png");
  assert.equal(extensaoDaImagem(JPG), "jpg");
  assert.equal(extensaoDaImagem(Buffer.from("<html>")), null);
});

test("visualizador: só entrega arquivos de imagem/vídeo da pasta de saídas", () => {
  const saidas = mkdtempSync(path.join(tmpdir(), "mcp-google-saidas-"));
  writeFileSync(path.join(saidas, "2026-10-06_tatu.jpg"), JPG);
  writeFileSync(path.join(saidas, "pendentes.json"), "[]");
  writeFileSync(path.join(pasta, "fora.jpg"), JPG);
  assert.equal(caminhoDeSaida(saidas, "2026-10-06_tatu.jpg"), path.join(saidas, "2026-10-06_tatu.jpg"));
  for (const nome of ["../fora.jpg", ".." + String.fromCharCode(92) + "fora.jpg", "x" + String.fromCharCode(92) + "y.jpg", path.join(pasta, "fora.jpg"), "sub/x.jpg", "pendentes.json", "geracoes.jsonl", "x.exe", "...jpg", ""]) {
    assert.throws(() => caminhoDeSaida(saidas, nome), /inválido|não encontrado/i, `deveria recusar "${nome}"`);
  }
  assert.throws(() => caminhoDeSaida(saidas, "nao-existe.mp4"), /não encontrado/);
});

test("visualizador: a regex do link sobrevive ao template (bug da 0.7.0 à 0.9.0)", async () => {
  const { HTML_VISUALIZADOR } = await import("../dist/visualizador.js");
  const m = /linkSeguro = link && (\/.+?\/)\.test/.exec(HTML_VISUALIZADOR);
  assert.ok(m, "achei a regex na página");
  const re = new Function(`return ${m[1]}`)();
  assert.ok(re.test("https://notebook.google.com/notebook/abc"));
  assert.ok(re.test("https://flow.google.com/project/x"));
  assert.ok(!re.test("https://evil.com/notebook.google.com/"));
  assert.ok(!re.test("https://notebook.google.com.evil.com/"));
});

test("visualizador: procura o nome nas subpastas (flow, notebooklm) sem sair delas", () => {
  const saidas = mkdtempSync(path.join(tmpdir(), "mcp-google-saidas-"));
  const flow = path.join(saidas, "flow"), nb = path.join(saidas, "notebooklm");
  mkdirSync(flow);
  mkdirSync(nb);
  writeFileSync(path.join(flow, "v.mp4"), "x");
  writeFileSync(path.join(nb, "r.md"), "# r");
  const pastas = [flow, nb, saidas];
  assert.equal(caminhoDeSaida(pastas, "v.mp4"), path.join(flow, "v.mp4"));
  assert.equal(caminhoDeSaida(pastas, "r.md"), path.join(nb, "r.md"));
  for (const nome of ["flow/v.mp4", "../flow/v.mp4", "notebooklm" + String.fromCharCode(92) + "r.md"]) {
    assert.throws(() => caminhoDeSaida(pastas, nome), /inválido/i, `deveria recusar "${nome}"`);
  }
  assert.throws(() => caminhoDeSaida(pastas, "x.mp4"), /não encontrado/);
});

test("imagens do personagem: só flow.google.com/asb/, em https", () => {
  assert.ok(linkDeImagemDoFlowPermitido("https://flow.google.com/asb/AB-nOUa_token"));
  assert.ok(!linkDeImagemDoFlowPermitido("http://flow.google.com/asb/x"));
  assert.ok(!linkDeImagemDoFlowPermitido("https://flow.google.com/project/x"));
  assert.ok(!linkDeImagemDoFlowPermitido("https://flow.google.com.evil.com/asb/x"));
  assert.ok(!linkDeImagemDoFlowPermitido("https://evil.com/asb/x"));
});

test("NotebookLM: downloads só dos servidores de arquivos do Google", () => {
  assert.ok(linkDoNotebookPermitido("https://lh3.googleusercontent.com/notebooklm/AKYW=m22-dv"));
  assert.ok(linkDoNotebookPermitido("https://drum.usercontent.google.com/download/x"));
  assert.ok(linkDoNotebookPermitido("https://contribution.usercontent.google.com/download?c=x&filename=a.pdf"));
  assert.ok(linkDoNotebookPermitido("https://lh3.google.com/rd-notebooklm/ABzc=s0-w2048"));
  assert.ok(!linkDoNotebookPermitido("https://lh3.google.com/outro/caminho"));
  assert.ok(!linkDoNotebookPermitido("https://www.google.com/rd-notebooklm/x"));
  assert.ok(!linkDoNotebookPermitido("http://lh3.googleusercontent.com/x"));
  assert.ok(!linkDoNotebookPermitido("https://googleusercontent.com.evil.com/x"));
  assert.ok(!linkDoNotebookPermitido("https://evilusercontent.google.com/x"));
  assert.ok(!linkDoNotebookPermitido("https://evil.com/?u=lh3.googleusercontent.com"));
  assert.ok(!linkDoNotebookPermitido("https://notebook.google.com/"));
});

test("NotebookLM: fonte do PC só aceita documento/imagem/áudio de verdade", () => {
  const pdf = path.join(pasta, "artigo.pdf");
  writeFileSync(pdf, "%PDF-1.7 ...");
  assert.equal(validarArquivoFonte(pdf), pdf);
  const txt = path.join(pasta, "notas.txt");
  writeFileSync(txt, "texto comum, com acentuação");
  assert.equal(validarArquivoFonte(txt), txt);
  const docx = path.join(pasta, "doc.docx");
  writeFileSync(docx, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]));
  assert.equal(validarArquivoFonte(docx), docx);
  const mp3 = path.join(pasta, "fala.mp3");
  writeFileSync(mp3, Buffer.concat([Buffer.from("ID3"), Buffer.alloc(10)]));
  assert.equal(validarArquivoFonte(mp3), mp3);

  const recusar = (nome, conteudo, erro) => {
    const arq = path.join(pasta, nome);
    writeFileSync(arq, conteudo);
    assert.throws(() => validarArquivoFonte(arq), erro, `deveria recusar ${nome}`);
  };
  recusar(".env", "SENHA=123", /Formato não aceito/);
  recusar("id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----", /Formato não aceito/);
  recusar("chave.pem", "-----BEGIN PRIVATE KEY-----", /Formato não aceito/);
  recusar("falso.pdf", "não sou pdf", /não é um PDF/);
  recusar("programa.txt", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), /não é um texto/);
  recusar("vazio.pdf", "", /vazio/);
  assert.throws(() => validarArquivoFonte("relativo.pdf"), /caminho completo/);
  assert.throws(() => validarArquivoFonte(path.join(pasta, "nao-existe.pdf")), /não encontrado/);
});

test("arquivos do PC: caminhos de rede (UNC) são recusados sem tocar na rede", () => {
  for (const c of [String.raw`\\servidor\pasta\a.png`, "//servidor/pasta/a.png", String.raw`\\?\C:\x\a.png`, String.raw`\\192.168.0.1\c$\a.pdf`]) {
    assert.throws(() => validarImagemLocal(c), /caminhos de rede/, `imagem: ${c}`);
    assert.throws(() => validarArquivoFonte(c), /caminhos de rede/, `fonte: ${c}`);
  }
});
