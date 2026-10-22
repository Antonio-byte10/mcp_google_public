import { readdirSync } from "node:fs";
import path from "node:path";
import { comTravaDeArquivo } from "./trava-arquivo.js";
import { nomeArquivo, salvar, tamanhoMB, type Arquivo } from "./arquivos.js";
import { PASTA_ROTEIROS } from "./config.js";
import { perguntar, ultimaResposta, type Resposta } from "./notebooklm.js";
import { descreverCitacoes, type Citacao } from "./notebook-conversa.js";
import type { Prazo } from "./prazo.js";
import { duracaoAproximada, montarTrechos, PALAVRAS_POR_TRECHO } from "./video-longo.js";

// Roteiro de vídeo curto escrito pelo NotebookLM a partir das fontes do notebook (pesquisa → roteiro
// → vídeo). A pergunta já leva o formato do modo apresentador do flow_video_longo (cenário + falas
// no tamanho certo) e pede o TRECHO literal da fonte que comprova o fato: no teste de 07/10 o
// NotebookLM exagerou 3 falas ("os maiores jardineiros", tirou o "em cativeiro") e só a checagem
// pegou. O roteiro sai em saidas\notebooklm\roteiros\NN-assunto.md.

/** Marca a pergunta no chat: o "continuar" só aceita a última resposta se ela for de um roteiro. */
const MARCA = "[ROTEIRO PARA VÍDEO]";

export interface PedidoRoteiro {
  notebook: string;
  /** Assunto ou curiosidade; sem isso, o NotebookLM escolhe a mais surpreendente das fontes. */
  tema?: string;
  /** Quem apresenta (ex.: "Seu Jabuti, um jabuti de animação 3D de óculos redondos"). */
  personagem: string;
  /** Onde o personagem está (ex.: "jardim tropical ensolarado"). */
  lugar?: string;
  /** Número de falas = trechos do vídeo (4 ≈ 29 s). */
  falas: number;
  /** Voz do Flow sugerida (só vai para o arquivo e para a resposta). */
  voz?: string;
  titulo?: string;
  fontes?: string[];
}

export interface Roteiro {
  fato: string;
  trecho: string;
  cenario: string;
  falas: string[];
  legenda: string;
}

function montarPergunta(p: PedidoRoteiro): string {
  const [b0, b1] = PALAVRAS_POR_TRECHO.base, [e0, e1] = PALAVRAS_POR_TRECHO.extensao;
  const meio = Array.from({ length: Math.max(0, p.falas - 2) }, (_, i) => `FALA ${i + 2}: continuação da explicação, entre ${e0} e ${e1} palavras.`);
  return [
    `${MARCA} Escreva o roteiro de um vídeo curto (TikTok, cerca de ${duracaoAproximada(p.falas)} segundos) ${p.tema ? `sobre: ${p.tema}` : "sobre a curiosidade mais surpreendente das fontes"}.`,
    `Apresentador: ${p.personagem}.${p.lugar ? ` Lugar: ${p.lugar}.` : ""}`,
    "Como é o vídeo: um único plano contínuo; o personagem fica no mesmo lugar falando para a câmera, só com gestos (não anda, não troca de ambiente, nada novo entra em cena).",
    "Responda SOMENTE neste formato, um campo por linha, sem markdown e sem texto antes ou depois:",
    "FATO: a curiosidade em uma frase.",
    "TRECHO: copie literalmente, entre aspas, o trecho da fonte que comprova o fato.",
    "CENARIO: uma frase com o personagem, o lugar, a luz e um objeto de cena ligado ao assunto; sem ações.",
    `FALA 1: gancho começando com "Você sabia que", entre ${b0} e ${b1} palavras.`,
    ...meio,
    `FALA ${p.falas}: conclusão curta terminando com "Curtiu? Segue pra mais curiosidades!", entre ${e0} e ${e1} palavras no total.`,
    "LEGENDA: legenda do post com 4 a 6 hashtags.",
    "Regras: as falas só podem afirmar o que está no TRECHO e nas fontes; não exagere (nada de \"o maior\", \"o único\", \"sempre\" se a fonte não disser) e mantenha as condições da fonte (ex.: \"em cativeiro\", \"em algumas espécies\"); português do Brasil simples, animado e oral; frases curtas; sem aspas dentro das falas; sem números difíceis de falar; conte as palavras de cada fala.",
  ].join("\n");
}

const semCitacoes = (s: string) => s.replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "").replace(/\s+/g, " ").trim();

/** Lê os campos da resposta (tolera **negrito**, marcadores de lista e acentos no nome do campo). */
export function lerRoteiro(texto: string, falasEsperadas: number): Roteiro {
  const campos = new Map<string, string>();
  let atual = "";
  // O chat às vezes devolve tudo numa linha só ("FATO: … TRECHO: … FALA 1: …"): quebra antes de
  // cada rótulo em maiúsculas seguido de dois-pontos.
  const separado = texto.replace(/\s*(?:\*\*)?\b(FATO|TRECHO|CEN[AÁ]RIO|FALA\s*\d+|LEGENDA)(?:\*\*)?\s*:(?:\*\*)?/g, "\n$1:");
  for (const bruta of separado.split("\n")) {
    const linha = bruta.replace(/\*\*/g, "").replace(/^\s*[-*•]\s*/, "").trim();
    const m = /^(FATO|TRECHO|CEN[AÁ]RIO|FALA\s*\d+|LEGENDA)\s*:\s*(.*)$/i.exec(linha);
    if (m) {
      atual = m[1].toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
      campos.set(atual, m[2].trim());
    } else if (atual && linha) campos.set(atual, `${campos.get(atual)} ${linha}`.trim());
  }
  const falas: string[] = [];
  for (let i = 1; campos.has(`FALA ${i}`); i++) falas.push(semCitacoes(campos.get(`FALA ${i}`)!).replace(/^["“]|["”]$/g, ""));
  const faltando = ["FATO", "CENARIO", "LEGENDA"].filter((c) => !campos.get(c));
  if (faltando.length || falas.length < 2) {
    throw new Error(`A resposta do NotebookLM não veio no formato do roteiro (faltou ${[...faltando, falas.length < 2 ? "FALA 1/2" : ""].filter(Boolean).join(", ")}). Resposta:\n${texto.slice(0, 1500)}`);
  }
  if (falas.length !== falasEsperadas) throw new Error(`Pedi ${falasEsperadas} falas e vieram ${falas.length}. Resposta:\n${texto.slice(0, 1500)}`);
  return {
    fato: semCitacoes(campos.get("FATO")!),
    trecho: campos.get("TRECHO") ?? "",
    cenario: semCitacoes(campos.get("CENARIO")!).replace(/\.$/, ""),
    falas,
    legenda: semCitacoes(campos.get("LEGENDA")!),
  };
}

/** Próximo número livre em saidas\notebooklm\roteiros (01, 02, …). */
function proximoNumero(): string {
  let maior = 0;
  try {
    for (const nome of readdirSync(PASTA_ROTEIROS)) {
      const m = /^(\d{2,3})-/.exec(nome);
      if (m) maior = Math.max(maior, Number(m[1]));
    }
  } catch {
    // pasta ainda não existe
  }
  return String(maior + 1).padStart(2, "0");
}

function montarArquivo(p: PedidoRoteiro, r: Roteiro, resposta: Resposta, avisos: string[], notebookId: string, titulo: string): string {
  const palavras = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const pedido = {
    titulo, cenario: r.cenario, falas: r.falas, modelo: "veo-3.1-fast", proporcao: "9:16", ...(p.voz ? { voz: p.voz } : {}),
  };
  const custo = 20 + 10 * (r.falas.length - 1);
  return [
    `# Roteiro — "${titulo}"`,
    "",
    `Gerado pelo NotebookLM em ${new Date().toLocaleString("pt-BR")} (notebook \`${notebookId}\`), com \`notebook_roteiro\`.`,
    `Formato: vertical 9:16, ${r.falas.length} trechos (~${duracaoAproximada(r.falas.length)} s), \`flow_video_longo\` no modo apresentador.${p.voz ? ` Voz: **${p.voz}**.` : ""}`,
    "",
    "## Fato",
    r.fato,
    "",
    "## Trecho da fonte (checagem)",
    r.trecho || "(o NotebookLM não copiou o trecho: confira o fato nas fontes antes de gerar o vídeo)",
    "",
    ...(resposta.trechos?.length
      ? ["Trechos citados pelo NotebookLM (como estão nas fontes):", "", descreverCitacoes(resposta.trechos, Infinity), ""]
      : resposta.citacoes.length
        ? ["Fontes citadas:", ...resposta.citacoes.map((c) => `- ${c}`), ""]
        : []),
    "## Cenário (`cenario`)",
    r.cenario,
    "",
    "## Falas (`falas`, uma por trecho)",
    ...r.falas.map((f, i) => `${i + 1}. ${f} *(${palavras(f)} palavras)*`),
    "",
    ...(avisos.length ? ["## Avisos", ...avisos.map((a) => `- ${a}`), ""] : []),
    "## Pedido para o vídeo",
    `Custo: 20 (1º trecho em Fast) + ${r.falas.length - 1} × 10 (extensões, sempre Lite) = **${custo} créditos** da cota diária.`,
    "",
    "```json",
    JSON.stringify(pedido, null, 2),
    "```",
    "",
    "## Legenda (para a postagem)",
    `${r.legenda} — marcar como **conteúdo gerado por IA**.`,
    "",
  ].join("\n");
}

export interface ResultadoRoteiro {
  pendente: boolean;
  notebook: string;
  roteiro?: Roteiro;
  avisos: string[];
  arquivo?: Arquivo;
  titulo?: string;
  citacoes: string[];
  /** Trecho exato da fonte de cada [n] da resposta. */
  trechos?: Citacao[];
}

/**
 * Pede o roteiro ao notebook (ou, com continuar, lê a resposta que ficou sendo escrita), confere o
 * formato e o tamanho das falas e salva o .md. Não gera vídeo: isso é o flow_video_longo.
 */
export async function escreverRoteiro(prazo: Prazo, p: PedidoRoteiro, continuar = false): Promise<ResultadoRoteiro> {
  let resposta: Resposta;
  if (continuar) {
    resposta = await ultimaResposta(prazo, p.notebook);
    if (!resposta.pendente && !resposta.pergunta?.includes(MARCA)) {
      throw new Error("A última pergunta do chat deste notebook não é de um roteiro. Chame notebook_roteiro sem 'continuar'.");
    }
  } else {
    resposta = await perguntar(prazo, p.notebook, montarPergunta(p), { fontes: p.fontes });
  }
  if (resposta.pendente) return { pendente: true, notebook: resposta.id, avisos: [], citacoes: [] };
  const roteiro = lerRoteiro(resposta.texto, p.falas);
  const { avisos } = montarTrechos({ cenario: roteiro.cenario, falas: roteiro.falas });
  if (!roteiro.trecho) avisos.push("O NotebookLM não copiou o trecho da fonte: confira o fato antes de gerar o vídeo.");
  const titulo = (p.titulo?.trim() || p.tema?.trim() || roteiro.fato).slice(0, 60);
  const md = montarArquivo(p, roteiro, resposta, avisos, resposta.id, titulo);
  // Número e gravação sob a mesma trava: duas janelas não pegam o mesmo número.
  const caminho = comTravaDeArquivo(path.join(PASTA_ROTEIROS, "numeracao"), () =>
    salvar(`${proximoNumero()}-${nomeArquivo(titulo, "md").replace(/^[\d_-]+_/, "")}`, md, PASTA_ROTEIROS));
  return {
    pendente: false,
    notebook: resposta.id,
    roteiro,
    avisos,
    titulo,
    citacoes: resposta.citacoes,
    trechos: resposta.trechos,
    arquivo: { caminho, id: path.basename(caminho, ".md"), tipo: "documento", via: "roteiro do NotebookLM", tamanhoMB: tamanhoMB(caminho) },
  };
}
