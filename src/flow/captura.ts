// Download e verificação: captura dos arquivos que o Flow entrega e exportação de cenas.
import { type Page } from "playwright";
import { dimensoesImagem, inspecionarMp4, nomeArquivo, registrar, salvarFlow, type Arquivo } from "../arquivos.js";
import { baixarComRedirecionamentoSeguro, saltoDoContexto } from "../download-seguro.js";
import { irPara } from "../navegador.js";
import { fecharEmendas } from "../emendas.js";
import { extensaoDaImagem, linkDeMidiaPermitido } from "../seguranca.js";
import { type Qualidade } from "../pendentes.js";
import path from "node:path";
import { FLOW as F } from "../seletores.js";
import { ehVideo, Rastreador } from "./rastreador.js";

// ---------- Download e verificação ----------

function baixarLink(p: Page, link: string): Promise<Buffer> {
  return baixarComRedirecionamentoSeguro(saltoDoContexto(p.context()), link, linkDeMidiaPermitido, { rotulo: "do servidor de mídia do Flow", timeoutMs: 120000 });
}

/** Maior texto (base64 de um arquivo) dentro de uma resposta batchexecute. */
function maiorTextoNaResposta(corpo: string): string | null {
  let maior: string | null = null;
  const visitar = (no: unknown): void => {
    if (typeof no === "string") {
      if (no.length > 10000 && (!maior || no.length > maior.length)) maior = no;
    } else if (Array.isArray(no)) no.forEach(visitar);
  };
  for (const linha of corpo.split("\n")) {
    if (!linha.startsWith("[[")) continue;
    try {
      for (const e of JSON.parse(linha) as unknown[][]) {
        if (e[0] === "wrb.fr" && typeof e[2] === "string") visitar(JSON.parse(e[2]));
      }
    } catch {
      // formato inesperado
    }
  }
  return maior;
}

/**
 * Intercepta uma chamada do Flow que traz um arquivo em base64. Quando o arquivo vem, o MCP
 * fica com ele e a página recebe uma resposta vazia (assim ela não tenta baixar pelo
 * navegador, o que derruba o navegador invisível). Nenhum erro escapa daqui: as mensagens de erro
 * do Playwright nesse ponto incluem os cabeçalhos da requisição, com os cookies da sessão.
 */
async function interceptarArquivo(p: Page, padrao: RegExp, extrair: (corpo: string) => string | null, entregar: (b64: string) => void, timeoutMs: number): Promise<void> {
  await p.route(padrao, async (rota) => {
    try {
      const resp = await rota.fetch({ timeout: Math.max(30000, timeoutMs) });
      const corpo = await resp.text();
      const b64 = extrair(corpo);
      if (b64) {
        entregar(b64);
        await rota.fulfill({ response: resp, body: ")]}'\n" });
        return;
      }
      await rota.fulfill({ response: resp, body: corpo });
    } catch {
      await rota.abort().catch(() => {});
    }
  });
}

/**
 * Pede ao Flow a versão aprimorada (1080p/GIF de vídeo, 2K de imagem) e captura o arquivo sem
 * deixar a página baixar (o gerenciador de downloads derruba o navegador invisível):
 * - imagem 2K: vem em base64 na resposta SPrCad, que é interceptada (o GIF, na QZasKb);
 * - vídeo: o Flow cria uma versão nova ("<id>_upsampled") e a página busca o link dela; o
 *   pedido é bloqueado e o MCP baixa o mesmo link.
 * Testado em 06/10/2026: nenhum dos dois gastou créditos.
 */
async function capturarAprimorado(p: Page, video: boolean, qualidade: Exclude<Qualidade, "original">, esperaMs: number): Promise<Buffer> {
  let entregar!: (v: { dados?: Buffer; link?: string }) => void;
  const pronto = new Promise<{ dados?: Buffer; link?: string }>((ok) => (entregar = ok));
  await interceptarArquivo(p, F.rpcAprimorado, maiorTextoNaResposta, (b64) => entregar({ dados: Buffer.from(b64, "base64") }), esperaMs);
  await p.route(F.linkAprimorado, (rota) => {
    entregar({ link: rota.request().url() });
    return rota.abort();
  });
  try {
    const botao = p.getByRole("button", { name: F.botaoBaixar });
    await botao.waitFor({ timeout: 30000 });
    await p.waitForTimeout(1000);
    await botao.click();
    await p.locator(F.overlay).getByRole("menuitem", { name: F.opcaoDownload[qualidade] }).click();
    let espera: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      pronto,
      new Promise<never>((_, falha) => {
        espera = setTimeout(
          () => falha(new Error(`O Flow ainda está preparando a versão ${qualidade}. Tente flow_baixar de novo em instantes (o que já foi processado fica no Flow).`)),
          esperaMs,
        );
      }),
    ]).finally(() => clearTimeout(espera));
    if (r.dados) return r.dados;
    return await baixarLink(p, r.link!);
  } finally {
    await p.unroute(F.rpcAprimorado).catch(() => {});
    await p.unroute(F.linkAprimorado).catch(() => {});
  }
}

/**
 * Baixa uma mídia (vídeo ou imagem).
 * Original: pelo link direto do arquivo que o Flow guardou (rápido, não gasta nada).
 * 1080p (vídeo), 2K (imagem) e GIF: o Flow processa na hora (ver capturarAprimorado).
 */
export async function baixarMidia(p: Page, r: Rastreador, id: string, qualidade: Qualidade, sufixo: string, esperaMs = 120000): Promise<Arquivo> {
  const g = () => r.midias.get(id)!;
  const video = ehVideo(g());
  if (video && qualidade === "2k") throw new Error("2K é só para imagens. Para vídeo use original, 1080p ou gif.");
  if (!video && (qualidade === "1080p" || qualidade === "gif")) throw new Error("1080p e GIF são só para vídeos. Para imagem use original ou 2k.");
  const link = () => (video ? g().linkVideo : g().linkImagem);
  const titulo = g().titulo ?? g().prompt ?? id;
  const mb = (b: Buffer) => Math.round((b.length / 1048576) * 100) / 100;

  let dados: Buffer;
  let via: string;
  if (qualidade === "original") {
    if (!link()) {
      await irPara(p, F.urlMidia(g().projeto, id));
      for (let tentativa = 0; tentativa < 2 && !link(); tentativa++) {
        if (tentativa) await p.reload({ waitUntil: "domcontentloaded" });
        for (let i = 0; i < 40 && !link(); i++) await p.waitForTimeout(500);
      }
    }
    if (!link()) throw new Error(`Não encontrei o link do arquivo de ${id}.`);
    dados = await baixarLink(p, link()!);
    via = "arquivo original";
  } else {
    await irPara(p, F.urlMidia(g().projeto, id));
    dados = await capturarAprimorado(p, video, qualidade, esperaMs);
    via = `versão ${qualidade} do Flow`;
  }

  if (video && dados.subarray(4, 8).toString() === "ftyp") {
    const caminho = salvarFlow(nomeArquivo(titulo, "mp4", qualidade === "1080p" ? `${sufixo}_1080p` : sufixo), dados);
    return { caminho, id, tipo: "video", via, ...inspecionarMp4(caminho) };
  }
  if (dados.subarray(0, 4).toString() === "GIF8") {
    const caminho = salvarFlow(nomeArquivo(titulo, "gif", sufixo), dados);
    return { caminho, id, tipo: "video", via, tamanhoMB: mb(dados) };
  }
  const ext = extensaoDaImagem(dados);
  if (!ext || video) throw new Error("O arquivo recebido do Flow não é do tipo esperado; nada foi salvo.");
  const caminho = salvarFlow(nomeArquivo(titulo, ext, qualidade === "2k" ? `${sufixo}_2k` : sufixo), dados);
  return { caminho, id, tipo: "imagem", via, tamanhoMB: mb(dados), ...dimensoesImagem(dados) };
}

/**
 * Exporta uma cena (vídeo estendido = clipes juntos) e salva o MP4.
 * O Flow monta o arquivo no servidor e devolve o MP4 inteiro (em base64) na resposta IxdSwd.
 * Se a página recebesse essa resposta, tentaria baixar pelo navegador, o que derruba o navegador
 * invisível. Então a resposta é interceptada: o MCP fica com o arquivo e a página recebe
 * uma resposta vazia.
 */
export async function exportarCena(p: Page, projeto: string, cena: string, titulo: string, esperaMs: number, sufixo = "_cena"): Promise<Arquivo> {
  await irPara(p, F.urlCena(projeto, cena));
  const botao = p.getByRole("button", { name: F.botaoBaixarCena });
  await botao.waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  let entregar!: (b64: string) => void;
  const pronto = new Promise<string>((ok) => (entregar = ok));
  // Resposta da exportação: [3, "", "", 3, "<mp4 em base64>"] quando termina (2 = ainda montando).
  const extrairCena = (corpo: string): string | null => {
    for (const linha of corpo.split("\n")) {
      if (!linha.startsWith("[[")) continue;
      try {
        for (const e of JSON.parse(linha) as unknown[][]) {
          if (e[0] !== "wrb.fr" || typeof e[2] !== "string") continue;
          const d = JSON.parse(e[2]);
          if (d[0] === 3 && typeof d[4] === "string" && d[4].length > 1000) return d[4];
        }
      } catch {
        // formato inesperado: deixa passar
      }
    }
    return null;
  };
  await interceptarArquivo(p, F.rpcExportarCena, extrairCena, entregar, esperaMs);
  try {
    await botao.click();
    let espera: ReturnType<typeof setTimeout> | undefined;
    const b64 = await Promise.race([
      pronto,
      new Promise<never>((_, falha) => {
        espera = setTimeout(() => falha(new Error("A exportação da cena não terminou a tempo.")), esperaMs);
      }),
    ]).finally(() => clearTimeout(espera));
    const dados = Buffer.from(b64, "base64");
    if (dados.subarray(4, 8).toString() !== "ftyp") throw new Error("A cena exportada não é um MP4 válido.");
    const nome = titulo || (await p.getByRole("textbox", { name: F.tituloProjeto }).inputValue().catch(() => "")) || "cena";
    // Cada extensão Lite rende ~7 s num espaço de 8 s: a exportação deixa ~1 s parado e mudo em
    // cada emenda. Salvo a versão sem esses buracos e guardo o original do Flow ao lado.
    const corrigido = fecharEmendas(dados);
    if (!corrigido) {
      const caminho = salvarFlow(nomeArquivo(nome, "mp4", sufixo), dados);
      return { caminho, id: cena, tipo: "cena", via: "exportação da cena", ...inspecionarMp4(caminho) };
    }
    const original = salvarFlow(nomeArquivo(nome, "mp4", `${sufixo}_original-flow`), dados);
    const caminho = salvarFlow(nomeArquivo(nome, "mp4", sufixo), corrigido.dados);
    registrar({ tipo: "emendas", cena, emendas: corrigido.emendas, segundos: corrigido.segundos, arquivo: caminho, original });
    const via = `exportação da cena; ${corrigido.emendas} emenda(s) parada(s) removida(s) (${corrigido.duracaoAntes} s → ${corrigido.duracaoDepois} s); original do Flow em ${path.basename(original)}`;
    return { caminho, id: cena, tipo: "cena", via, ...inspecionarMp4(caminho) };
  } finally {
    await p.unroute(F.rpcExportarCena).catch(() => {});
  }
}
