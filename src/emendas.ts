// Fecha os "buracos" das emendas na cena exportada pelo Flow.
//
// Medido em 07/10/2026 (3 vídeos longos): cada extensão do Veo 3.1 Lite rende ~7 s, mas a linha do
// tempo da cena reserva 8 s para ela. Na exportação, o último quadro do clipe fica ~1 s na tela
// (uma amostra de vídeo com duração de 1,04 s) e o áudio ganha 1 s de silêncio digital. Quem
// assiste vê o personagem "travar" e calar em cada emenda (ex.: 15-16 s e 23-24 s num vídeo de 31 s).
//
// A correção mexe só nas tabelas do MP4 (moov), sem recodificar nada: o quadro parado volta a durar
// um quadro e as amostras de áudio daquele segundo deixam de ser referenciadas (os bytes continuam
// no mdat, sem uso; isso é válido no formato). Imagem e som ficam idênticos ao que o Flow gerou.
// Qualquer coisa fora do padrão (MP4 fragmentado, mais de uma faixa de vídeo/áudio, listas de
// edição com cortes, tabelas desconhecidas) faz a função desistir e devolver null.

interface Caixa {
  tipo: string;
  ini: number;
  tam: number;
  cab: number;
}

const CONTEINERES = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);
// Tabelas por amostra que sei refazer na faixa de áudio. Se aparecer outra, não mexo no arquivo.
const TABELAS_CONHECIDAS = new Set(["stsd", "stts", "ctts", "stsz", "stsc", "stco", "co64", "stss", "sbgp", "sgpd", "sdtp"]);

function caixas(b: Buffer, ini: number, fim: number): Caixa[] {
  const lista: Caixa[] = [];
  let i = ini;
  while (i + 8 <= fim) {
    let tam = b.readUInt32BE(i);
    let cab = 8;
    if (tam === 1) {
      if (i + 16 > fim) throw new Error("caixa inválida");
      tam = Number(b.readBigUInt64BE(i + 8));
      cab = 16;
    } else if (tam === 0) tam = fim - i;
    if (tam < cab || i + tam > fim) throw new Error("caixa inválida");
    lista.push({ tipo: b.toString("latin1", i + 4, i + 8), ini: i, tam, cab });
    i += tam;
  }
  return lista;
}

const filha = (b: Buffer, pai: Caixa, tipo: string) => caixas(b, pai.ini + pai.cab, pai.ini + pai.tam).find((c) => c.tipo === tipo);
const corpo = (b: Buffer, c: Caixa) => b.subarray(c.ini + c.cab, c.ini + c.tam);

function caixa(tipo: string, conteudo: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(8 + conteudo.length, 0);
  cab.write(tipo, 4, "latin1");
  return Buffer.concat([cab, conteudo]);
}

/** Caixa "completa" (versão + flags) com uma tabela de números de 32 bits. */
function tabela(tipo: string, versaoFlags: number, cabecalho: number[], linhas: number[][]): Buffer {
  const nums = [...cabecalho, ...linhas.flat()];
  const d = Buffer.alloc(4 + nums.length * 4);
  d.writeUInt32BE(versaoFlags, 0);
  nums.forEach((n, k) => (n < 0 ? d.writeInt32BE(n, 4 + k * 4) : d.writeUInt32BE(n, 4 + k * 4)));
  return caixa(tipo, d);
}

/** Lista "valor por amostra" → pares [quantidade, valor]. */
function compactar(valores: number[]): number[][] {
  const pares: number[][] = [];
  for (const v of valores) {
    const ult = pares[pares.length - 1];
    if (ult && ult[1] === v) ult[0]++;
    else pares.push([1, v]);
  }
  return pares;
}

// Teto de entradas por tabela (e de amostras expandidas): ~1 milhão cobre mais de 10 horas de vídeo.
// Um arquivo forjado ou corrompido com contagem de bilhões faria o Node alocar até estourar a memória.
const MAX_ENTRADAS = 1_000_000;

/** Lê a contagem de uma tabela em `pos` e confere que ela cabe no buffer antes de alguém alocar ou percorrer. */
function contarEntradas(c: Buffer, pos: number, bytesPorEntrada: number): number {
  if (pos + 4 > c.length) throw new Error("tabela de MP4 truncada");
  const n = c.readUInt32BE(pos);
  if (n > MAX_ENTRADAS || pos + 4 + n * bytesPorEntrada > c.length) throw new Error(`tabela de MP4 corrompida ou excessiva: ${n} entradas`);
  return n;
}

function expandirPares(c: Buffer, inicio: number, assinado = false): number[] {
  const n = contarEntradas(c, inicio, 8);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const qtd = c.readUInt32BE(inicio + 4 + k * 8);
    if (out.length + qtd > MAX_ENTRADAS) throw new Error("tabela de MP4 expande amostras demais");
    const val = assinado ? c.readInt32BE(inicio + 8 + k * 8) : c.readUInt32BE(inicio + 8 + k * 8);
    for (let j = 0; j < qtd; j++) out.push(val);
  }
  return out;
}

interface Faixa {
  trak: Caixa;
  tipo: string;
  escala: number;
  stbl: Caixa;
  duracoes: number[];
  tamanhos: number[];
  posicoes: number[];
}

function lerFaixa(b: Buffer, trak: Caixa): Faixa {
  const mdia = filha(b, trak, "mdia")!;
  const mdhd = corpo(b, filha(b, mdia, "mdhd")!);
  const escala = mdhd[0] === 1 ? mdhd.readUInt32BE(20) : mdhd.readUInt32BE(12);
  const tipo = corpo(b, filha(b, mdia, "hdlr")!).toString("latin1", 8, 12);
  const stbl = filha(b, filha(b, mdia, "minf")!, "stbl")!;
  const tab = (t: string) => {
    const c = filha(b, stbl, t);
    return c ? corpo(b, c) : undefined;
  };
  const duracoes = expandirPares(tab("stts")!, 4);
  const stsz = tab("stsz")!;
  if (stsz.length < 12) throw new Error("stsz truncada");
  const fixo = stsz.readUInt32BE(4);
  const n = fixo ? stsz.readUInt32BE(8) : contarEntradas(stsz, 8, 4);
  if (n > MAX_ENTRADAS) throw new Error(`stsz excessiva: ${n} amostras`);
  const tamanhos = Array.from({ length: n }, (_, k) => (fixo ? fixo : stsz.readUInt32BE(12 + k * 4)));
  const stco = tab("stco"), co64 = tab("co64");
  const nChunks = stco ? contarEntradas(stco, 4, 4) : contarEntradas(co64!, 4, 8);
  const chunk = (k: number) => (stco ? stco.readUInt32BE(8 + k * 4) : Number(co64!.readBigUInt64BE(8 + k * 8)));
  const stsc = tab("stsc")!;
  const regras = Array.from({ length: contarEntradas(stsc, 4, 12) }, (_, k) => [stsc.readUInt32BE(8 + k * 12), stsc.readUInt32BE(12 + k * 12)]);
  const posicoes: number[] = [];
  let s = 0;
  for (let c = 0; c < nChunks && s < n; c++) {
    let porChunk = 0;
    for (const [primeiro, qtd] of regras) if (c + 1 >= primeiro) porChunk = qtd;
    let pos = chunk(c);
    for (let j = 0; j < porChunk && s < n; j++, s++) {
      posicoes.push(pos);
      pos += tamanhos[s];
    }
  }
  if (duracoes.length !== n || posicoes.length !== n) throw new Error("tabelas inconsistentes");
  return { trak, tipo, escala, stbl, duracoes, tamanhos, posicoes };
}

/** Reescreve um contêiner trocando caixas filhas (por início) e mantendo o resto byte a byte. */
function reescrever(b: Buffer, c: Caixa, trocas: Map<number, Buffer | null>): Buffer {
  if (trocas.has(c.ini)) return trocas.get(c.ini) ?? Buffer.alloc(0);
  if (!CONTEINERES.has(c.tipo)) return b.subarray(c.ini, c.ini + c.tam);
  const partes = caixas(b, c.ini + c.cab, c.ini + c.tam).map((f) => reescrever(b, f, trocas));
  return caixa(c.tipo, Buffer.concat(partes));
}

/** Copia a caixa trocando um número de 32 ou 64 bits (durações nos cabeçalhos). */
function comDuracao(b: Buffer, c: Caixa, v0: number, v1: number, valor: number): Buffer {
  const copia = Buffer.from(b.subarray(c.ini, c.ini + c.tam));
  if (copia[c.cab] === 1) copia.writeBigUInt64BE(BigInt(valor), c.cab + v1);
  else copia.writeUInt32BE(Math.min(valor, 0xffffffff), c.cab + v0);
  return copia;
}

export interface Emendas {
  dados: Buffer;
  /** Quantas emendas paradas foram fechadas. */
  emendas: number;
  /** Segundos removidos no total. */
  segundos: number;
  duracaoAntes: number;
  duracaoDepois: number;
}

export function fecharEmendas(b: Buffer): Emendas | null {
  try {
    const topo = caixas(b, 0, b.length);
    if (topo.some((c) => c.tipo === "moof")) return null;
    const moov = topo.find((c) => c.tipo === "moov");
    const mdat = topo.find((c) => c.tipo === "mdat");
    if (!moov || !mdat) return null;
    const filhosMoov = caixas(b, moov.ini + moov.cab, moov.ini + moov.tam);
    if (filhosMoov.some((c) => c.tipo === "mvex")) return null;
    const faixas = filhosMoov.filter((c) => c.tipo === "trak").map((t) => lerFaixa(b, t));
    const video = faixas.filter((f) => f.tipo === "vide"), audio = faixas.filter((f) => f.tipo === "soun");
    if (video.length !== 1 || audio.length > 1 || faixas.length !== video.length + audio.length) return null;
    const v = video[0], a = audio[0];

    // Listas de edição: só aceito a simples (uma entrada começando no 0).
    for (const f of faixas) {
      const edts = filha(b, f.trak, "edts");
      const elst = edts && filha(b, edts, "elst");
      if (!elst) continue;
      const c = corpo(b, elst);
      const mediaIni = c[0] === 1 ? Number(c.readBigInt64BE(16)) : c.readInt32BE(12);
      if (c.readUInt32BE(4) !== 1 || mediaIni !== 0) return null;
    }
    if (a && caixas(b, a.stbl.ini + a.stbl.cab, a.stbl.ini + a.stbl.tam).some((c) => !TABELAS_CONHECIDAS.has(c.tipo))) return null;

    // Quadro "normal" = a duração mais comum; parado = mais de 0,25 s além dela.
    const contagem = new Map<number, number>();
    for (const d of v.duracoes) contagem.set(d, (contagem.get(d) ?? 0) + 1);
    const normal = [...contagem.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const buracos: { ini: number; tam: number }[] = []; // em segundos
    let t = 0;
    const novasDuracoesV = v.duracoes.map((d) => {
      const extra = d - normal;
      if (extra > 0.25 * v.escala && extra <= 3 * v.escala) {
        buracos.push({ ini: (t + normal) / v.escala, tam: extra / v.escala });
        t += d;
        return normal;
      }
      t += d;
      return d;
    });
    if (!buracos.length) return null;
    const durV = novasDuracoesV.reduce((s, d) => s + d, 0);

    const trocas = new Map<number, Buffer | null>();
    trocas.set(filha(b, v.stbl, "stts")!.ini, tabela("stts", 0, [compactar(novasDuracoesV).length], compactar(novasDuracoesV)));

    // Áudio: some com as amostras cujo meio cai dentro de um buraco.
    let durA = 0;
    let manter: number[] = [];
    if (a) {
      let ta = 0;
      a.duracoes.forEach((d, k) => {
        const meio = (ta + d / 2) / a.escala;
        if (!buracos.some((x) => meio >= x.ini && meio < x.ini + x.tam)) manter.push(k);
        ta += d;
      });
      durA = manter.reduce((s, k) => s + a.duracoes[k], 0);
    }

    // Durações nos cabeçalhos (mvhd na escala do filme; tkhd e elst também).
    const mvhd = filhosMoov.find((c) => c.tipo === "mvhd")!;
    const mv = corpo(b, mvhd);
    const escalaFilme = mv[0] === 1 ? mv.readUInt32BE(20) : mv.readUInt32BE(12);
    const noFilme = (dur: number, escala: number) => Math.round((dur / escala) * escalaFilme);
    const ajustarFaixa = (f: Faixa, dur: number) => {
      const mdia = filha(b, f.trak, "mdia")!;
      const mdhd = filha(b, mdia, "mdhd")!;
      trocas.set(mdhd.ini, comDuracao(b, mdhd, 16, 24, dur));
      const tkhd = filha(b, f.trak, "tkhd")!;
      trocas.set(tkhd.ini, comDuracao(b, tkhd, 20, 28, noFilme(dur, f.escala)));
      const edts = filha(b, f.trak, "edts");
      const elst = edts && filha(b, edts, "elst");
      if (elst) trocas.set(elst.ini, comDuracao(b, elst, 8, 8, noFilme(dur, f.escala)));
    };
    ajustarFaixa(v, durV);
    if (a) ajustarFaixa(a, durA);
    trocas.set(mvhd.ini, comDuracao(b, mvhd, 16, 24, Math.max(noFilme(durV, v.escala), a ? noFilme(durA, a.escala) : 0)));

    // Tabelas novas do áudio: uma amostra por "chunk", posições absolutas (ajustadas abaixo).
    const tabelaAudio = (deslocamento: number): Map<number, Buffer | null> => {
      const m = new Map<number, Buffer | null>();
      if (!a) return m;
      const tab = (tipo: string) => filha(b, a.stbl, tipo);
      const durs = manter.map((k) => a.duracoes[k]);
      m.set(tab("stts")!.ini, tabela("stts", 0, [compactar(durs).length], compactar(durs)));
      m.set(tab("stsz")!.ini, tabela("stsz", 0, [0, manter.length], manter.map((k) => [a.tamanhos[k]])));
      m.set(tab("stsc")!.ini, tabela("stsc", 0, [1], [[1, 1, corpo(b, tab("stsc")!).readUInt32BE(16)]]));
      const posicoes = manter.map((k) => a.posicoes[k] + (a.posicoes[k] > moov.ini ? deslocamento : 0));
      const antigo = (tab("stco") ?? tab("co64"))!;
      if (posicoes.some((p) => p > 0xffffffff)) {
        const d = Buffer.alloc(8 + posicoes.length * 8);
        d.writeUInt32BE(posicoes.length, 4);
        posicoes.forEach((p, k) => d.writeBigUInt64BE(BigInt(p), 8 + k * 8));
        m.set(antigo.ini, caixa("co64", d));
      } else m.set(antigo.ini, tabela("stco", 0, [posicoes.length], posicoes.map((p) => [p])));
      const ctts = tab("ctts");
      if (ctts) {
        const c = corpo(b, ctts);
        const vals = expandirPares(c, 4, c[0] === 1);
        const novos = compactar(manter.map((k) => vals[k]));
        m.set(ctts.ini, tabela("ctts", c.readUInt32BE(0), [novos.length], novos));
      }
      const stss = tab("stss");
      if (stss) {
        const c = corpo(b, stss);
        const chave = new Set(Array.from({ length: contarEntradas(c, 4, 4) }, (_, k) => c.readUInt32BE(8 + k * 4) - 1));
        const novos = manter.map((k, j) => (chave.has(k) ? j + 1 : 0)).filter(Boolean);
        m.set(stss.ini, tabela("stss", 0, [novos.length], novos.map((x) => [x])));
      }
      const sdtp = tab("sdtp");
      if (sdtp) {
        const c = corpo(b, sdtp);
        m.set(sdtp.ini, caixa("sdtp", Buffer.concat([c.subarray(0, 4), Buffer.from(manter.map((k) => c[4 + k] ?? 0))])));
      }
      for (const sbgp of caixas(b, a.stbl.ini + a.stbl.cab, a.stbl.ini + a.stbl.tam).filter((x) => x.tipo === "sbgp")) {
        const c = corpo(b, sbgp);
        const ini = c[0] === 1 ? 12 : 8;
        const grupos = expandirPares(c, ini);
        while (grupos.length < a.duracoes.length) grupos.push(0);
        const novos = compactar(manter.map((k) => grupos[k]));
        const d = Buffer.alloc(ini + 4 + novos.length * 8);
        c.copy(d, 0, 0, ini);
        d.writeUInt32BE(novos.length, ini);
        novos.forEach(([qtd, g], k) => (d.writeUInt32BE(qtd, ini + 4 + k * 8), d.writeUInt32BE(g, ini + 8 + k * 8)));
        m.set(sbgp.ini, caixa("sbgp", d));
      }
      return m;
    };

    // O moov muda de tamanho: se vier antes do mdat, todas as posições andam junto.
    const montar = (deslocamento: number) => {
      const todas = new Map([...trocas, ...tabelaAudio(deslocamento)]);
      const stcoV = filha(b, v.stbl, "stco"), co64V = filha(b, v.stbl, "co64");
      if (deslocamento && moov.ini < mdat.ini) {
        if (stcoV) {
          const c = corpo(b, stcoV);
          const n = contarEntradas(c, 4, 4);
          todas.set(stcoV.ini, tabela("stco", 0, [n], Array.from({ length: n }, (_, k) => [c.readUInt32BE(8 + k * 4) + deslocamento])));
        } else if (co64V) {
          const c = Buffer.from(corpo(b, co64V));
          for (let k = 0, n = contarEntradas(c, 4, 8); k < n; k++) c.writeBigUInt64BE(c.readBigUInt64BE(8 + k * 8) + BigInt(deslocamento), 8 + k * 8);
          todas.set(co64V.ini, caixa("co64", c));
        }
      }
      return reescrever(b, moov, todas);
    };
    let novoMoov = montar(0);
    if (moov.ini < mdat.ini) {
      const desl = novoMoov.length - moov.tam;
      novoMoov = montar(desl);
      if (novoMoov.length - moov.tam !== desl) return null; // stco virou co64 no meio do caminho: não arrisco
    }
    const dados = Buffer.concat([b.subarray(0, moov.ini), novoMoov, b.subarray(moov.ini + moov.tam)]);
    const durAntes = v.duracoes.reduce((s, d) => s + d, 0) / v.escala;
    return {
      dados,
      emendas: buracos.length,
      segundos: Math.round(buracos.reduce((s, x) => s + x.tam, 0) * 100) / 100,
      duracaoAntes: Math.round(durAntes * 100) / 100,
      duracaoDepois: Math.round((durV / v.escala) * 100) / 100,
    };
  } catch {
    return null;
  }
}
