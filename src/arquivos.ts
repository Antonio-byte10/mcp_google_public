import type { Page } from "playwright";
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PASTA_FLOW, PASTA_NOTEBOOK, PASTA_SAIDAS } from "./config.js";
import type { Prazo } from "./prazo.js";
import { comTravaDeArquivo } from "./trava-arquivo.js";

// Arquivos salvos na pasta de saídas: nomes, verificação, miniaturas e o registro de gerações.
// Usado pelo Flow e pelo NotebookLM.

export interface Arquivo {
  caminho: string;
  id: string;
  tipo: "video" | "imagem" | "cena" | "audio" | "documento";
  via: string;
  tamanhoMB: number;
  duracao?: number;
  largura?: number;
  altura?: number;
  audio?: boolean;
  /** Miniatura JPEG (base64, até 640 px) para mostrar no chat. */
  previa?: string;
}

/** Lê duração, resolução e presença de áudio direto do cabeçalho do MP4 (também serve para .m4a). */
export function inspecionarMp4(arquivo: string) {
  const b = readFileSync(arquivo);
  if (b.subarray(4, 8).toString() !== "ftyp") throw new Error(`${arquivo} não é um MP4 válido.`);
  const m = b.indexOf("mvhd");
  let escala = 0, dur = 0;
  // MP4 fragmentado ou fora do padrão: sem duração no cabeçalho (não é erro, o arquivo já está salvo).
  if (m > 0 && m + 36 <= b.length) {
    const v = b[m + 4];
    escala = v ? b.readUInt32BE(m + 24) : b.readUInt32BE(m + 16);
    dur = v ? Number(b.readBigUInt64BE(m + 28)) : b.readUInt32BE(m + 20);
  }
  let largura = 0, altura = 0, i = 0;
  while ((i = b.indexOf("tkhd", i + 1)) > 0) {
    const tam = b.readUInt32BE(i - 4);
    if (tam < 16 || i - 4 + tam > b.length) continue;
    const w = b.readUInt32BE(i - 4 + tam - 8) >>> 16, h = b.readUInt32BE(i - 4 + tam - 4) >>> 16;
    if (w) [largura, altura] = [w, h];
  }
  return {
    duracao: escala ? Math.round((dur / escala) * 100) / 100 : 0,
    largura,
    altura,
    audio: b.indexOf("soun") > 0,
    tamanhoMB: tamanhoMB(arquivo),
  };
}

export const tamanhoMB = (arquivo: string) => Math.round((statSync(arquivo).size / 1048576) * 1000) / 1000;

/** "6.51 MB" ou "12 KB". */
export const formatarTamanho = (mb: number) => (mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`);

/** Largura e altura de um PNG, JPEG ou WebP (para conferir o que foi baixado). */
export function dimensoesImagem(b: Buffer): { largura: number; altura: number } {
  if (b[0] === 0x89) return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") {
    const tipo = b.subarray(12, 16).toString();
    if (tipo === "VP8X") return { largura: 1 + b.readUIntLE(24, 3), altura: 1 + b.readUIntLE(27, 3) };
    if (tipo === "VP8L") { const v = b.readUInt32LE(21); return { largura: 1 + (v & 0x3fff), altura: 1 + ((v >> 14) & 0x3fff) }; }
    if (tipo === "VP8 ") return { largura: b.readUInt16LE(26) & 0x3fff, altura: b.readUInt16LE(28) & 0x3fff };
    return { largura: 0, altura: 0 };
  }
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) break;
    const marca = b[i + 1];
    const tam = b.readUInt16BE(i + 2);
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
      return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    }
    i += 2 + tam;
  }
  return { largura: 0, altura: 0 };
}

export function nomeArquivo(titulo: string, extensao: string, sufixo = ""): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  const carimbo = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  const slug = titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50).toLowerCase() || "midia";
  return `${carimbo}_${slug}${sufixo}.${extensao}`;
}

const MIMES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".gif": "image/gif",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
};

export function tipoMime(caminho: string): string {
  return MIMES[path.extname(caminho).toLowerCase()] ?? "application/octet-stream";
}

/** Grava numa das pastas de saídas (só o nome do arquivo é usado: nunca sai da pasta). */
export function salvar(destinoBase: string, dados: Buffer | string, pasta = PASTA_SAIDAS): string {
  mkdirSync(pasta, { recursive: true });
  // Nunca sobrescreve: dois arquivos com o mesmo nome no mesmo segundo ganham -2, -3…
  const nome = path.basename(destinoBase);
  const ext = path.extname(nome);
  const base = nome.slice(0, nome.length - ext.length);
  // Criação exclusiva ("wx"): testar existsSync e gravar depois deixava duas gravações simultâneas escolherem o mesmo nome.
  for (let n = 1; n < 1000; n++) {
    const destino = path.join(pasta, n === 1 ? nome : `${base}-${n}${ext}`);
    try {
      writeFileSync(destino, dados, { flag: "wx" });
      return destino;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error(`Não consegui um nome livre para ${nome} em ${pasta}.`);
}

/** Imagens e vídeos do Flow: saidas\flow. */
export const salvarFlow = (destinoBase: string, dados: Buffer | string) => salvar(destinoBase, dados, PASTA_FLOW);
/** Relatórios, áudios, slides, tabelas… do NotebookLM: saidas\notebooklm. */
export const salvarNotebook = (destinoBase: string, dados: Buffer | string) => salvar(destinoBase, dados, PASTA_NOTEBOOK);

export function registrar(entrada: object): void {
  mkdirSync(PASTA_SAIDAS, { recursive: true });
  const arquivo = path.join(PASTA_SAIDAS, "geracoes.jsonl");
  const linha = JSON.stringify({ quando: new Date().toISOString(), ...entrada }) + "\n";
  // Serializado com outras janelas: no Windows duas escritas simultâneas podem dar EBUSY ou misturar linhas.
  comTravaDeArquivo(arquivo, () => appendFileSync(arquivo, linha));
}

export async function capturaDeErro(p: Page, nome: string): Promise<string> {
  const pasta = path.join(PASTA_SAIDAS, "_erros");
  mkdirSync(pasta, { recursive: true });
  const arq = path.join(pasta, nomeArquivo(nome, "png"));
  await p.screenshot({ path: arq }).catch(() => {});
  return arq;
}

// ---------- Miniaturas ----------

const LADO_PREVIA = 640;
const ENDERECO_PREVIA = "https://previa.mcp-google.invalid/arquivo";

/**
 * Cria a miniatura do arquivo salvo, usando o próprio navegador ativo (sem bibliotecas extras): abre uma
 * aba vazia, entrega o arquivo por uma rota interna (nada sai para a rede), desenha a imagem
 * ou um quadro do vídeo num canvas reduzido e devolve um JPEG pequeno em base64.
 * Falhar aqui nunca atrapalha o download: o arquivo já está salvo.
 */
async function criarPrevia(p: Page, arq: Arquivo): Promise<string | undefined> {
  const mime = tipoMime(arq.caminho);
  if (!mime.startsWith("image/") && mime !== "video/mp4") return undefined;
  const aba = await p.context().newPage();
  try {
    const dados = readFileSync(arq.caminho);
    await aba.route(ENDERECO_PREVIA, (rota) =>
      rota.fulfill({ body: dados, contentType: mime, headers: { "Access-Control-Allow-Origin": "*" } }),
    );
    const b64 = await aba.evaluate(
      async ({ url, video, lado }) => {
        const desenhar = (fonte: CanvasImageSource, w: number, h: number) => {
          const escala = Math.min(1, lado / Math.max(w, h));
          const c = document.createElement("canvas");
          c.width = Math.round(w * escala);
          c.height = Math.round(h * escala);
          c.getContext("2d")!.drawImage(fonte, 0, 0, c.width, c.height);
          return c.toDataURL("image/jpeg", 0.8).split(",")[1];
        };
        if (video) {
          const v = document.createElement("video");
          v.crossOrigin = "anonymous";
          v.muted = true;
          v.preload = "auto";
          v.src = url;
          await new Promise((ok, falha) => {
            v.onloadeddata = ok;
            v.onerror = () => falha(new Error("vídeo"));
          });
          v.currentTime = Math.min(1, (v.duration || 2) / 3);
          await new Promise((ok) => (v.onseeked = ok));
          return desenhar(v, v.videoWidth, v.videoHeight);
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await img.decode();
        return desenhar(img, img.naturalWidth, img.naturalHeight);
      },
      { url: ENDERECO_PREVIA, video: mime === "video/mp4", lado: LADO_PREVIA },
    );
    return typeof b64 === "string" && b64.length > 100 ? b64 : undefined;
  } catch {
    return undefined;
  } finally {
    await aba.close().catch(() => {});
  }
}

export async function comPrevia<T extends Arquivo>(p: Page, arq: T, prazo: Prazo): Promise<T> {
  if (!prazo.sobra(4000)) return arq;
  const espera = new Promise<undefined>((ok) => setTimeout(() => ok(undefined), Math.min(8000, prazo.restante() - 2000)));
  const previa = await Promise.race([criarPrevia(p, arq), espera]);
  return previa ? { ...arq, previa } : arq;
}
