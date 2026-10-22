import { lstatSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";

// Regras de segurança usadas pelas outras partes. Ficam aqui para serem fáceis de revisar.

/** Sites em que a automação pode agir. Qualquer outro endereço na aba principal interrompe a tarefa. */
// drive.google.com e docs.google.com: só para levar os slides do Estúdio para o Apresentações Google (0.12.0).
const HOSTS_PERMITIDOS = new Set(["notebook.google.com", "flow.google.com", "drive.google.com", "docs.google.com"]);

/** Downloads só a partir do servidor de mídia do Flow, sempre https. */
const HOST_MIDIA = "flow-content.google";

export function hostPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.href === "about:blank") return true; // aba vazia antes da primeira navegação
    return u.protocol === "https:" && HOSTS_PERMITIDOS.has(u.hostname);
  } catch {
    return false;
  }
}

export function linkDeMidiaPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === HOST_MIDIA;
  } catch {
    return false;
  }
}

/**
 * Arquivos do NotebookLM (áudio, vídeo, slides, imagens): os links vêm das respostas do próprio
 * Google e apontam para lh3.googleusercontent.com, que redireciona para *.usercontent.google.com.
 * Qualquer outro endereço é recusado, antes e depois dos redirecionamentos.
 */
export function linkDoNotebookPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    // Só os servidores de arquivos do NotebookLM, não qualquer *.googleusercontent.com (que inclui
    // conteúdo de usuários, como Apps Script e Sites): lh3-lh6 e os de download de *.usercontent.google.com.
    // O NotebookLM redireciona o link do arquivo por lh3.google.com/rd-notebooklm/ (redirecionador do próprio Google).
    const redirecionador = /^lh[3-6]\.google\.com$/.test(u.hostname) && u.pathname.startsWith("/rd-notebooklm/");
    return u.protocol === "https:" && (redirecionador || /^lh[3-6]\.googleusercontent\.com$/.test(u.hostname) || /^(drum|contribution|[\w-]+-drum)\.usercontent\.google\.com$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Imagens que a página do personagem mostra: só https://flow.google.com/asb/... */
export function linkDeImagemDoFlowPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "flow.google.com" && u.pathname.startsWith("/asb/");
  } catch {
    return false;
  }
}

/** A página caiu na tela de login do Google: a sessão expirou ou foi encerrada. */
export function ehTelaDeLogin(url: string): boolean {
  try {
    return new URL(url).hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

// ---------- Mensagens de erro ----------

/**
 * Texto de erro seguro para devolver ao Claude ou gravar em log.
 * Erros do Playwright trazem um "Call log" com os cabeçalhos da requisição, INCLUSIVE os
 * cookies da sessão do Google. Aqui o log é cortado e qualquer cookie/token que sobrar é apagado.
 */
export function mensagemDeErro(erro: unknown): string {
  let msg = erro instanceof Error ? erro.message : String(erro);
  msg = msg.split(/\n\s*Call log:/i)[0];
  // Logs do navegador ao abrir trazem a linha de comando inteira (com o usuário do Windows): não servem ao Claude.
  msg = msg.split(/\n\s*Browser logs:/i)[0];
  // Cabeçalhos sensíveis, em linha própria ou no meio do texto (JSON, "x: y").
  msg = msg.replace(/\b(cookie|set-cookie|authorization|x-goog-[\w-]+)(["']?\s*[:=]\s*["']?)[^"'\n]*/gi, "$1$2[removido]");
  msg = msg.replace(/\b((?:__Secure-|__Host-)[\w-]+|[A-Z0-9_]*SID[\w-]*|NID|AEC)=[^;\s"']+/g, "$1=[removido]");
  msg = msg.replace(/SAPISID(?:1P|3P)?HASH\s+\S+/g, "SAPISIDHASH [removido]");
  msg = msg.replace(/([?&](Signature|Expires|KeyName|at|f\.sid)=)[^&\s"]+/g, "$1[removido]");
  return msg.length > 800 ? msg.slice(0, 800) + "…" : msg;
}

// ---------- Arquivos entregues ao visualizador do chat ----------

const NOME_DE_SAIDA = /^[\w.-]+\.(jpg|jpeg|png|webp|gif|mp4|m4a|pdf|pptx|md|csv)$/i;
export const TAMANHO_MAX_PARA_CHAT = 60 * 1024 * 1024;

/** O visualizador consegue entregar este arquivo (só pelo nome; o caminho é conferido em caminhoDeSaida). */
export const entregavelAoVisualizador = (nome: string) => NOME_DE_SAIDA.test(nome);

/**
 * O visualizador do Claude Desktop pede arquivos pelo nome (botões Baixar/Assistir).
 * Só vale um nome simples (sem pastas, sem "..") de imagem ou vídeo, e só de dentro da
 * pasta de saídas. Devolve o caminho completo.
 */
export function caminhoDeSaida(pastas: string | string[], nome: string): string {
  if (path.basename(nome) !== nome || nome.includes("..") || !NOME_DE_SAIDA.test(nome)) throw new Error("Nome de arquivo inválido.");
  // Procura o nome em cada pasta permitida (saidas\flow, saidas\notebooklm…), na ordem.
  let caminho = "";
  let info;
  for (const pasta of Array.isArray(pastas) ? pastas : [pastas]) {
    const base = path.resolve(pasta);
    const c = path.resolve(base, nome);
    if (path.dirname(c) !== base) throw new Error("Nome de arquivo inválido.");
    try {
      info = lstatSync(c);
    } catch {
      continue;
    }
    caminho = c;
    break;
  }
  if (!info || !info.isFile()) throw new Error("Arquivo não encontrado.");
  if (info.size > TAMANHO_MAX_PARA_CHAT) {
    throw new Error(`Arquivo grande demais para o chat (${Math.round(info.size / 1048576)} MB). Ele está em ${caminho}.`);
  }
  return caminho;
}

// ---------- Arquivos locais enviados ao Google ----------

const TAMANHO_MAX_IMAGEM = 20 * 1024 * 1024;
const ASSINATURAS: { tipo: string; extensoes: string[]; confere: (b: Buffer) => boolean }[] = [
  { tipo: "PNG", extensoes: [".png"], confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { tipo: "JPEG", extensoes: [".jpg", ".jpeg"], confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { tipo: "WebP", extensoes: [".webp"], confere: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];

/**
 * Caminho de arquivo local e absoluto. Caminhos de rede (\\servidor\pasta, //servidor, \\?\) são recusados:
 * só de olhar um deles o Windows tenta conectar por SMB e pode entregar o hash da senha (NTLM) a um
 * servidor de fora, se um texto malicioso induzir o Claude a pedir esse caminho.
 */
function caminhoLocalAbsoluto(caminho: string, oQue: string): string {
  if (/^[\\/]{2}/.test(caminho)) throw new Error(`Por segurança, caminhos de rede não são aceitos (${caminho}). Copie o arquivo para o PC.`);
  if (!path.isAbsolute(caminho)) throw new Error(`Use o caminho completo ${oQue} (recebi "${caminho}").`);
  return path.normalize(caminho);
}

/**
 * Confere um arquivo de imagem antes de enviá-lo ao Flow: caminho absoluto, arquivo comum
 * (não atalho/link), até 20 MB, extensão de imagem e conteúdo que é mesmo PNG, JPEG ou WebP.
 * Isso impede que um pedido mal-intencionado faça o MCP enviar outro tipo de arquivo do PC
 * (documentos, chaves, senhas) para a conta Google.
 */
export function validarImagemLocal(caminho: string): string {
  const arquivo = caminhoLocalAbsoluto(caminho, "da imagem");
  let info;
  try {
    info = lstatSync(arquivo);
  } catch {
    throw new Error(`Imagem não encontrada: ${arquivo}`);
  }
  if (info.isSymbolicLink()) throw new Error("Por segurança, atalhos/links simbólicos não são aceitos. Use o arquivo original.");
  if (!info.isFile()) throw new Error(`${arquivo} não é um arquivo.`);
  if (info.size > TAMANHO_MAX_IMAGEM) throw new Error(`A imagem tem ${(info.size / 1048576).toFixed(1)} MB; o limite é 20 MB.`);
  const ext = path.extname(arquivo).toLowerCase();
  const formato = ASSINATURAS.find((a) => a.extensoes.includes(ext));
  if (!formato) throw new Error(`Formato não aceito (${ext || "sem extensão"}). Use PNG, JPG ou WebP.`);
  const cabecalho = Buffer.alloc(12);
  const fd = openSync(arquivo, "r");
  try {
    readSync(fd, cabecalho, 0, 12, 0);
  } finally {
    closeSync(fd);
  }
  if (!formato.confere(cabecalho)) throw new Error(`${arquivo} não é um ${formato.tipo} de verdade (o conteúdo não bate com a extensão).`);
  return arquivo;
}

// ---------- Arquivos locais enviados como fonte do NotebookLM ----------

const TAMANHO_MAX_FONTE = 200 * 1024 * 1024; // limite do NotebookLM por arquivo
const zip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const ftyp = (b: Buffer) => b.subarray(4, 8).toString() === "ftyp";
const semBytesNulos = (b: Buffer) => !b.includes(0);
const FORMATOS_FONTE: { tipo: string; extensoes: string[]; confere: (b: Buffer) => boolean }[] = [
  { tipo: "PDF", extensoes: [".pdf"], confere: (b) => b.subarray(0, 5).toString() === "%PDF-" },
  { tipo: "documento do Office/EPUB", extensoes: [".docx", ".pptx", ".xlsx", ".epub"], confere: zip },
  { tipo: "texto", extensoes: [".txt", ".md", ".markdown", ".csv", ".html", ".htm"], confere: semBytesNulos },
  ...ASSINATURAS,
  { tipo: "MP3", extensoes: [".mp3"], confere: (b) => b.subarray(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { tipo: "WAV", extensoes: [".wav"], confere: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WAVE" },
  { tipo: "OGG", extensoes: [".ogg", ".opus"], confere: (b) => b.subarray(0, 4).toString() === "OggS" },
  { tipo: "FLAC", extensoes: [".flac"], confere: (b) => b.subarray(0, 4).toString() === "fLaC" },
  { tipo: "AAC", extensoes: [".aac"], confere: (b) => b[0] === 0xff && (b[1] & 0xf6) === 0xf0 },
  { tipo: "MP4/M4A", extensoes: [".m4a", ".mp4"], confere: ftyp },
];
export const EXTENSOES_FONTE = FORMATOS_FONTE.flatMap((f) => f.extensoes);

/**
 * Confere um arquivo antes de enviá-lo como fonte do NotebookLM: caminho absoluto, arquivo comum
 * (não atalho/link), até 200 MB, extensão de documento/imagem/áudio e conteúdo compatível com ela.
 * Assim um pedido mal-intencionado não consegue mandar para a conta Google arquivos como chaves,
 * senhas ou configurações (.env, .pem, id_rsa…), que não estão na lista.
 */
export function validarArquivoFonte(caminho: string): string {
  const arquivo = caminhoLocalAbsoluto(caminho, "do arquivo");
  let info;
  try {
    info = lstatSync(arquivo);
  } catch {
    throw new Error(`Arquivo não encontrado: ${arquivo}`);
  }
  if (info.isSymbolicLink()) throw new Error("Por segurança, atalhos/links simbólicos não são aceitos. Use o arquivo original.");
  if (!info.isFile()) throw new Error(`${arquivo} não é um arquivo.`);
  if (info.size === 0) throw new Error(`${arquivo} está vazio.`);
  if (info.size > TAMANHO_MAX_FONTE) throw new Error(`${path.basename(arquivo)} tem ${(info.size / 1048576).toFixed(0)} MB; o limite do NotebookLM é 200 MB.`);
  const ext = path.extname(arquivo).toLowerCase();
  const formato = FORMATOS_FONTE.find((f) => f.extensoes.includes(ext));
  if (!formato) throw new Error(`Formato não aceito (${ext || "sem extensão"}). Aceitos: ${EXTENSOES_FONTE.join(" ")}.`);
  const cabecalho = Buffer.alloc(Math.min(8192, info.size));
  const fd = openSync(arquivo, "r");
  try {
    readSync(fd, cabecalho, 0, cabecalho.length, 0);
  } finally {
    closeSync(fd);
  }
  if (!formato.confere(cabecalho)) throw new Error(`${path.basename(arquivo)} não é um ${formato.tipo} de verdade (o conteúdo não bate com a extensão).`);
  return arquivo;
}

/** Descobre a extensão certa pelo conteúdo baixado (o Flow entrega JPEG, mas pode mudar). */
export function extensaoDaImagem(b: Buffer): string | null {
  for (const a of ASSINATURAS) if (a.confere(b)) return a.extensoes[0].slice(1);
  return null;
}
