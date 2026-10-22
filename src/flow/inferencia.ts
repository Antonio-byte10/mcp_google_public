// Inferência de proporção e duração a partir do prompt ou de uma imagem do PC.
import { dimensoesImagem } from "../arquivos.js";
import { readFileSync } from "node:fs";
import { validarImagemLocal } from "../seguranca.js";
import { type ProporcaoVideo, type ProporcaoImagem } from "./base.js";

// ---------- Inferência a partir do prompt ----------

export function inferirProporcao(prompt: string): ProporcaoVideo {
  // O \b do JS não entende acentos: os limites da palavra são explícitos (letras com acento contam).
  return /(^|[^\p{L}\d])(vertical|9:16|stories|story|reels?|tiktok|shorts|formato retrato)(?![\p{L}\d])/iu.test(prompt) ? "9:16" : "16:9";
}

export function inferirProporcaoImagem(prompt: string): ProporcaoImagem {
  if (/(^|[^\p{L}\d])(quadrad[oa]|1:1|avatar|ícone|icone|logo|foto de perfil)(?![\p{L}\d])/iu.test(prompt)) return "1:1";
  if (/\b(3:4)\b/.test(prompt)) return "3:4";
  if (/\b(4:3)\b/.test(prompt)) return "4:3";
  return inferirProporcao(prompt);
}

export function inferirDuracao(prompt: string): number | undefined {
  // "8 segundos", "10s" — mas não "anos 80s".
  const m = prompt.match(/(?<!anos\s)(?<![\p{L}\d])(\d{1,2})\s*(s|seg|segundos?)(?![\p{L}\d])/iu);
  return m ? Number(m[1]) : undefined;
}

export function maisProxima(valor: number, opcoes: number[]): number {
  return opcoes.reduce((a, b) => (Math.abs(b - valor) < Math.abs(a - valor) ? b : a));
}

/** Proporção do Flow mais próxima de uma imagem do PC (para a edição sair no mesmo formato). */
export function proporcaoDoArquivo(arquivo: string): ProporcaoImagem | undefined {
  try {
    const { largura, altura } = dimensoesImagem(readFileSync(validarImagemLocal(arquivo)));
    if (!largura || !altura) return undefined;
    const opcoes: [ProporcaoImagem, number][] = [["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 3 / 4], ["9:16", 9 / 16]];
    return opcoes.reduce((a, b) => (Math.abs(Math.log(b[1] / (largura / altura))) < Math.abs(Math.log(a[1] / (largura / altura))) ? b : a))[0];
  } catch {
    return undefined;
  }
}
