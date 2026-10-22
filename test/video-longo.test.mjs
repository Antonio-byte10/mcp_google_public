// Testes do vídeo longo sem navegador e sem créditos: prompts do modo apresentador e a correção das
// emendas paradas da cena exportada (MP4 sintético com a mesma forma do que o Flow exporta).
// Rodar: npm test   (depois de npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fecharEmendas } from "../dist/emendas.js";
import { duracaoAproximada, fixarNoTrecho, montarTrechos } from "../dist/video-longo.js";

// ---------- MP4 sintético ----------
const u32 = (...n) => Buffer.concat(n.map((x) => { const b = Buffer.alloc(4); b.writeUInt32BE(x); return b; }));
const caixa = (tipo, ...partes) => { const c = Buffer.concat(partes); return Buffer.concat([u32(8 + c.length), Buffer.from(tipo, "latin1"), c]); };
const completa = (tipo, ...nums) => caixa(tipo, u32(0, ...nums));

function trak(tipo, id, escala, duracoes, tamanhos, porChunk, inicioDados) {
  const dur = duracoes.reduce((s, d) => s + d, 0);
  const pares = [];
  for (const d of duracoes) { const ult = pares[pares.length - 1]; if (ult && ult[1] === d) ult[0]++; else pares.push([1, d]); }
  const chunks = [];
  let pos = inicioDados;
  for (let k = 0; k < tamanhos.length; k += porChunk) { chunks.push(pos); for (let j = k; j < Math.min(k + porChunk, tamanhos.length); j++) pos += tamanhos[j]; }
  return caixa("trak",
    caixa("tkhd", u32(0, 0, 0, id, 0, Math.round((dur / escala) * 1000)), Buffer.alloc(60)),
    caixa("edts", completa("elst", 1, Math.round((dur / escala) * 1000), 0, 0x10000)),
    caixa("mdia",
      completa("mdhd", 0, 0, escala, dur, 0),
      caixa("hdlr", u32(0, 0), Buffer.from(tipo, "latin1"), Buffer.alloc(13)),
      caixa("minf", caixa("stbl",
        completa("stsd", 0),
        completa("stts", pares.length, ...pares.flat()),
        completa("stsz", 0, tamanhos.length, ...tamanhos),
        completa("stsc", 1, 1, porChunk, 1),
        completa("stco", chunks.length, ...chunks),
      ))));
}

/** Vídeo 24 fps (escala 15360) com um quadro que fica 1,04 s na tela; áudio AAC 48 kHz cujos bytes são o índice da amostra. */
function mp4ComEmenda() {
  const durV = [...Array(24).fill(640), 16000, ...Array(24).fill(640)];
  const tamV = durV.map(() => 10);
  const nA = Math.ceil((durV.reduce((s, d) => s + d, 0) / 15360) * 48000 / 1024);
  const durA = Array(nA).fill(1024), tamA = durA.map(() => 4);
  const dadosV = Buffer.alloc(tamV.length * 10, 7);
  const dadosA = Buffer.concat(durA.map((_, k) => u32(k)));
  const ftyp = caixa("ftyp", Buffer.from("isom"), u32(0x200), Buffer.from("isomiso2mp41"));
  const montar = (inicio) => caixa("moov",
    completa("mvhd", 0, 0, 1000, 3042, 0x10000, ...Array(19).fill(0)),
    trak("vide", 1, 15360, durV, tamV, durV.length, inicio),
    trak("soun", 2, 48000, durA, tamA, 10, inicio + dadosV.length));
  const tam = montar(0).length;
  const moov = montar(ftyp.length + tam + 8);
  return { arquivo: Buffer.concat([ftyp, moov, caixa("mdat", dadosV, dadosA)]), nA };
}

/** Lê de volta: stts do vídeo, e o conteúdo das amostras de áudio referenciadas. */
function ler(b) {
  const filhos = (ini, fim) => { const l = []; for (let i = ini; i + 8 <= fim; i += b.readUInt32BE(i)) l.push({ tipo: b.toString("latin1", i + 4, i + 8), ini: i, fim: i + b.readUInt32BE(i) }); return l; };
  const achar = (pai, ...caminho) => caminho.reduce((c, t) => filhos(c.ini + 8, c.fim).find((x) => x.tipo === t), pai);
  const moov = filhos(0, b.length).find((x) => x.tipo === "moov");
  const traks = filhos(moov.ini + 8, moov.fim).filter((x) => x.tipo === "trak");
  const [v, a] = traks.map((t) => achar(t, "mdia", "minf", "stbl"));
  const sttsV = achar(v, "stts");
  const pares = Array.from({ length: b.readUInt32BE(sttsV.ini + 12) }, (_, k) => [b.readUInt32BE(sttsV.ini + 16 + k * 8), b.readUInt32BE(sttsV.ini + 20 + k * 8)]);
  const stsz = achar(a, "stsz"), stco = achar(a, "stco"), stsc = achar(a, "stsc");
  const n = b.readUInt32BE(stsz.ini + 16);
  assert.equal(b.readUInt32BE(stsc.ini + 20), 1, "uma amostra por chunk");
  const amostras = Array.from({ length: n }, (_, k) => b.readUInt32BE(b.readUInt32BE(stco.ini + 16 + k * 4)));
  const mvhd = filhos(moov.ini + 8, moov.fim).find((x) => x.tipo === "mvhd");
  return { pares, amostras, duracaoFilme: b.readUInt32BE(mvhd.ini + 24) };
}

test("emendas: fecha o quadro parado e tira o segundo de áudio correspondente", () => {
  const { arquivo, nA } = mp4ComEmenda();
  const r = fecharEmendas(arquivo);
  assert.ok(r, "devia achar a emenda");
  assert.equal(r.emendas, 1);
  assert.equal(r.segundos, 1);
  assert.equal(r.duracaoDepois, 2.04);
  const lido = ler(r.dados);
  assert.deepEqual(lido.pares, [[49, 640]]);
  // Amostras cujo meio cai em [1,0417 s; 2,0417 s): 49 a 95.
  const esperadas = Array.from({ length: nA }, (_, k) => k).filter((k) => k < 49 || k > 95);
  assert.deepEqual(lido.amostras, esperadas);
  // Duração do filme = a faixa mais longa: o áudio (96 × 1024 / 48000 = 2,048 s).
  assert.equal(lido.duracaoFilme, 2048);
  assert.equal(fecharEmendas(r.dados), null, "o arquivo corrigido não tem mais emendas");
});

test("emendas: arquivo sem emenda ou que não é MP4 fica como está", () => {
  assert.equal(fecharEmendas(Buffer.from("isto não é um mp4")), null);
  assert.equal(fecharEmendas(Buffer.alloc(0)), null);
});

test("modo apresentador: plano único, fala do começo ao fim e despedida no último trecho", () => {
  const { trechos, avisos } = montarTrechos({
    cenario: "Tatuzinho, um tatu-galinha 3D com cachecol vermelho, numa biblioteca aconchegante",
    falas: [
      "Você sabia que o polvo tem três corações e que um deles para quando ele nada?",
      "Dois corações mandam sangue para as brânquias e o terceiro leva sangue para o resto do corpo.",
      "Curto demais.",
    ],
  });
  assert.equal(trechos.length, 3);
  assert.match(trechos[0], /^Tatuzinho, um tatu-galinha .* aconchegante\. Plano único contínuo, sem cortes/);
  assert.match(trechos[0], /"Você sabia que o polvo tem três corações e que um deles para quando ele nada\?"/);
  assert.match(trechos[1], /^Continuação exata do mesmo plano, sem corte/);
  assert.match(trechos[1], /até o último instante/);
  assert.match(trechos[2], /sorri e acena para a câmera\.$/);
  assert.notEqual(trechos[1].match(/sem pausa, ([^.]+)\./)[1], trechos[2].match(/sem pausa, ([^.]+)\./)[1], "gestos variam");
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /Fala 3 tem 2 palavras/);
  assert.equal(duracaoAproximada(4), 29);
});

test("restrições e estilo da voz vão escritos no trecho (todos, não só o 1º)", () => {
  const { trechos } = montarTrechos({ cenario: "Dreko numa oficina de hacker à noite", falas: ["um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze", "um dois três quatro cinco seis sete oito nove dez onze doze treze"] });
  const fixos = { restricoes: "sem fogo, sem faíscas, mão mecânica fosca.", estiloVoz: " animado, ritmo rápido " };
  for (const t of trechos.map((x) => fixarNoTrecho(x, fixos))) {
    assert.match(t, /Regras fixas do vídeo inteiro: sem fogo, sem faíscas, mão mecânica fosca\. Estilo da voz: animado, ritmo rápido\.$/);
  }
  assert.equal(fixarNoTrecho(" só o prompt ", {}), "só o prompt");
  assert.equal(fixarNoTrecho("prompt", { restricoes: "  ", estiloVoz: "" }), "prompt");
});
