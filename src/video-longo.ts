import { EnvioNaoAconteceu, estenderVideo, exportarCenaFinal, gerarVideo, statusFlow, type Arquivo, type ModeloVideo, type ProporcaoVideo } from "./flow.js";
import { acrescentarVideo, alterar, lerVideos } from "./video-longo-estado.js";
import { lerLotes, lerResultados, type Lote } from "./pendentes.js";
import { CUSTO_VIDEO, MODELO_EXTENSAO_PADRAO } from "./seletores.js";
import { conferirTetoDeHoje } from "./gastos.js";
import { mensagemDeErro } from "./seguranca.js";
import type { Prazo } from "./prazo.js";

// Vídeo longo e contínuo (ex.: ~30 s para TikTok): um vídeo base de 8 s e extensões de ~7 s, cada uma
// partindo do fim da anterior (no Flow, "Estender" continua o movimento, a cena e o som). No fim o
// Flow junta tudo na cena e o MCP exporta um MP4 só (sem ffmpeg, sem créditos a mais).
//
// Cada passo depende do anterior estar pronto (~1-2 min por trecho), então o trabalho anda aos
// poucos: cada chamada (flow_video_longo ou flow_status) faz o que couber no tempo dela — no Claude
// Desktop, ~50 s: um envio OU um acompanhamento OU a exportação final. O estado fica em disco
// (saidas/videos-longos.json) e qualquer janela do Claude (Code ou Desktop) pode continuar.
//
// Nunca envia o mesmo trecho duas vezes: o envio é reservado no arquivo com o navegador travado,
// logo antes do clique que gasta créditos (aoEnviar).

export type ModeloLongo = Exclude<ModeloVideo, "omni-1.1-flash">;

interface Trecho {
  prompt: string;
  /** Lote do envio (reservado logo antes do clique). */
  lote?: string;
  /** Clipe pronto deste trecho (o vídeo base no primeiro). */
  clipe?: string;
  /** Créditos do envio (para desfazer a conta se o envio não acontecer). */
  custo?: number;
  /** Tentativas de envio que não couberam no tempo da chamada (Flow lento). */
  semTempo?: number;
}

export interface VideoLongo {
  id: string;
  titulo: string;
  criadoEm: string;
  modelo: ModeloLongo;
  proporcao: ProporcaoVideo;
  /** Teto opcional do vídeo inteiro (sem teto por padrão). */
  maxCreditos?: number;
  gasto: number;
  /** Id do projeto do Flow (fixado no primeiro envio). */
  projeto?: string;
  /** Elementos do vídeo base (as extensões herdam a imagem, a voz e o personagem do clipe anterior). */
  inicio: { personagens?: string[]; voz?: string; estiloVoz?: string; imagemInicio?: string; referencias?: string[] };
  /** Repete personagens e voz em cada extensão (ajuda a manter a voz igual). */
  elementosNasExtensoes?: boolean;
  trechos: Trecho[];
  base?: string;
  cena?: string;
  estado: "andamento" | "concluido" | "falhou";
  arquivo?: string;
  erro?: string;
  tentativasExportar?: number;
}

// Enviar um trecho leva ~25-40 s (abrir projeto, escolher modelo, abrir vídeo/cena, digitar, enviar).
const TEMPO_ENVIO_MS = 42000;
// Exportar a cena (o Flow monta o MP4 no servidor) leva ~15-30 s, mais abrir a página.
const TEMPO_EXPORTAR_MS = 40000;
const CONTINUIDADE = "Continuação exata do mesmo plano, sem corte: mesmo personagem, mesma voz, mesmo cenário e mesma luz; o movimento continua sem pausa.";

// ---------- Modo apresentador (cenário + falas → prompts) ----------
//
// O que os testes de 07/10 mostraram: as extensões (sempre Veo 3.1 Lite) não trocam de ambiente
// nem fazem ações grandes; pedir isso deixa o personagem hesitante. O que funciona é um plano único
// com o personagem falando para a câmera. As regras abaixo viram texto em todo trecho:
// - plano único, sem corte, mesma câmera e luz (nada de "close", "corta para", "vai até");
// - a fala começa no primeiro instante e ocupa o trecho inteiro (fala curta = segundos parados);
// - gestos no lugar, um diferente por trecho, e o movimento segue até o último quadro (a extensão
//   seguinte parte desse quadro: se ele for estático, o começo do próximo trecho também fica).
// O Veo fala ~2,3 palavras/s em português: ~15-19 palavras no 1º trecho (8 s) e ~13-17 nas
// extensões (~7 s cada).

export const GESTOS_PADRAO = [
  "gesticulando com as duas mãos e inclinando o corpo para a frente",
  "contando nos dedos e erguendo as sobrancelhas, surpreso",
  "apontando para a câmera e balançando a cabeça, empolgado",
  "abrindo os braços, admirado, e depois juntando as mãos",
  "levando a mão ao queixo, pensativo, e logo sorrindo",
  "batendo palmas uma vez e se inclinando para a câmera",
  "mexendo os ombros e a cabeça no ritmo da fala",
];

export const PALAVRAS_POR_TRECHO = { base: [15, 19], extensao: [13, 17] } as const;

const contarPalavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const semAspas = (s: string) => s.trim().replace(/^["“”']+|["“”']+$/g, "").replace(/"/g, "'");

export interface Apresentador {
  cenario: string;
  falas: string[];
  gestos?: string[];
  /** Despedida no último trecho (padrão: sorri e acena). */
  final?: string;
}

/** Monta os prompts do modo apresentador e devolve avisos sobre o tamanho das falas. */
export function montarTrechos(a: Apresentador): { trechos: string[]; avisos: string[] } {
  const avisos: string[] = [];
  const n = a.falas.length;
  const trechos = a.falas.map((bruta, i) => {
    const fala = semAspas(bruta);
    const palavras = contarPalavras(fala);
    const [min, max] = i === 0 ? PALAVRAS_POR_TRECHO.base : PALAVRAS_POR_TRECHO.extensao;
    if (palavras < min - 2) avisos.push(`Fala ${i + 1} tem ${palavras} palavras (ideal ${min}-${max}): vai sobrar tempo e o personagem fica parado no fim do trecho.`);
    if (palavras > max + 3) avisos.push(`Fala ${i + 1} tem ${palavras} palavras (ideal ${min}-${max}): o Veo pode cortar o fim da frase.`);
    const gesto = a.gestos?.[i]?.trim() || GESTOS_PADRAO[i % GESTOS_PADRAO.length];
    const ultimo = i === n - 1;
    const fim = ultimo ? ` Ao terminar a frase, ${a.final?.trim() || "sorri e acena para a câmera"}.` : " Continua gesticulando até o último instante, sem parar.";
    if (i === 0) {
      return (
        `${a.cenario.trim().replace(/\.?$/, ".")} Plano único contínuo, sem cortes, câmera na altura dos olhos com uma leve aproximação. ` +
        `O personagem já começa falando no primeiro segundo, olhando para a câmera, animado, ${gesto}. ` +
        `Ele diz em português do Brasil, em ritmo rápido e sem pausas: "${fala}"${fim}`
      );
    }
    return (
      "Continuação exata do mesmo plano, sem corte e sem mudar o cenário, a câmera ou a luz. " +
      `O personagem continua no mesmo lugar, olhando para a câmera, e já começa falando no primeiro instante, sem pausa, ${gesto}. ` +
      `Ele diz em português do Brasil, com a mesma voz e o mesmo ritmo: "${fala}"${fim}`
    );
  });
  return { trechos, avisos };
}

/**
 * Restrições visuais e estilo da voz escritos no fim de TODOS os trechos (não só no 1º, e sem depender
 * de voz ou de elementos_em_todos): cada extensão é um pedido novo ao Veo e esquece o que não vier nele.
 */
export function fixarNoTrecho(prompt: string, fixos: { restricoes?: string; estiloVoz?: string }): string {
  const limpo = (t?: string) => t?.trim().replace(/[.\s]+$/, "");
  const partes = [prompt.trim()];
  if (limpo(fixos.restricoes)) partes.push(`Regras fixas do vídeo inteiro: ${limpo(fixos.restricoes)}.`);
  if (limpo(fixos.estiloVoz)) partes.push(`Estilo da voz: ${limpo(fixos.estiloVoz)}.`);
  return partes.join(" ");
}

/** Duração aproximada do vídeo final: 8 s do vídeo base + ~7 s por extensão (emendas já fechadas). */
export const duracaoAproximada = (trechos: number) => 8 + 7 * (trechos - 1);

/** Reserva o envio do trecho (roda com o navegador travado, logo antes do clique). */
function reservar(id: string, indice: number): (lote: Lote) => void {
  return (lote) => {
    alterar(id, (v) => {
      if (v.estado !== "andamento") throw new Error(`O vídeo longo ${id} não está mais em andamento; nada foi enviado.`);
      if (v.trechos[indice].lote) throw new Error(`O trecho ${indice + 1} já foi enviado por outra janela do Claude; nada foi enviado de novo.`);
      v.trechos[indice].lote = lote.lote;
      v.trechos[indice].custo = lote.custo;
      v.gasto += lote.custo;
      v.projeto = lote.projeto; // id do projeto (o pedido podia vir com nome ou link)
    });
  };
}

const ehFaltaDeTempo = (msg: string) => /tempo desta chamada acabou|navegador estava ocupado|em uso por|já foi enviado por outra janela/i.test(msg);

export interface Avanco {
  linhas: string[];
  arquivos: Arquivo[];
}

/**
 * Dá o próximo passo de cada vídeo longo em andamento, enquanto houver tempo: registra os clipes
 * prontos, envia o próximo trecho ou exporta o vídeo final. Não espera geração (isso é o flow_status).
 */
export async function avancarVideosLongos(prazo: Prazo, progresso: (m: string) => void = () => {}, so?: string): Promise<Avanco> {
  const res: Avanco = { linhas: [], arquivos: [] };
  for (const { id } of lerVideos().filter((v) => v.estado === "andamento" && (!so || v.id === so))) {
    for (let passo = 0; passo < 20; passo++) {
      const v = lerVideos().find((x) => x.id === id);
      if (!v || v.estado !== "andamento") break;
      const n = v.trechos.length;
      const i = v.trechos.findIndex((t) => !t.clipe);

      // Todos os trechos prontos: o Flow junta a cena e o MCP baixa o MP4 final.
      if (i === -1) {
        if (!v.cena || !v.projeto) {
          alterar(id, (x) => ((x.estado = "falhou"), (x.erro = "Os trechos ficaram prontos, mas não sei qual é a cena para juntar. Veja flow_listar (seção Cenas) e baixe com flow_baixar.")));
          break;
        }
        if (!prazo.sobra(TEMPO_EXPORTAR_MS)) {
          res.linhas.push(`- ${id}: todos os ${n} trechos prontos; falta juntar (chame flow_status de novo).`);
          break;
        }
        progresso(`Vídeo longo ${id}: juntando os ${n} trechos num MP4…`);
        try {
          const arq = await exportarCenaFinal(prazo, v.projeto, v.cena, v.titulo, "_video-longo");
          alterar(id, (x) => ((x.estado = "concluido"), (x.arquivo = arq.caminho)));
          res.arquivos.push(arq);
          res.linhas.push(`- ${id}: PRONTO — ${n} trechos (~${duracaoAproximada(n)} s) em ${arq.caminho} (gasto ${v.gasto} créditos).`);
        } catch (erro) {
          const msg = mensagemDeErro(erro);
          const x = alterar(id, (y) => (y.tentativasExportar = (y.tentativasExportar ?? 0) + 1));
          if ((x.tentativasExportar ?? 0) >= 4) {
            alterar(id, (y) => ((y.estado = "falhou"), (y.erro = `A exportação da cena falhou 4 vezes (${msg}). Os trechos estão no Flow; baixe a cena ${v.cena} com flow_baixar.`)));
          }
          res.linhas.push(`- ${id}: exportação final não terminou (${msg}); tento de novo no próximo flow_status.`);
        }
        break;
      }

      const t = v.trechos[i];
      if (t.lote) {
        if (lerLotes().some((l) => l.lote === t.lote)) {
          res.linhas.push(`- ${id}: trecho ${i + 1}/${n} gerando no Flow (lote ${t.lote}).`);
          break;
        }
        const fim = lerResultados().find((r) => r.lote === t.lote);
        const clipe = fim?.clipe ?? fim?.ids[0];
        if (fim?.estado === "concluido" && clipe) {
          alterar(id, (x) => {
            x.trechos[i].clipe = clipe;
            if (i === 0) x.base = clipe;
            else if (fim.cena) x.cena = fim.cena;
          });
          res.linhas.push(`- ${id}: trecho ${i + 1}/${n} pronto.`);
          continue;
        }
        const motivo = !fim
          ? `o lote ${t.lote} do trecho ${i + 1} não foi encontrado (o envio pode não ter acontecido)`
          : fim.estado === "expirado"
            ? `o trecho ${i + 1} passou de 2 h sem ficar pronto`
            : `o trecho ${i + 1} falhou no Flow (pode ser bloqueio de política; o Flow costuma devolver os créditos)`;
        alterar(id, (x) => ((x.estado = "falhou"), (x.erro = `Parou porque ${motivo}. Confira flow_creditos e, se quiser continuar, chame flow_video_longo com retomar="${id}".`)));
        res.linhas.push(`- ${id}: PAROU — ${motivo}.`);
        break;
      }

      // Próximo envio.
      if (!prazo.sobra(TEMPO_ENVIO_MS)) {
        res.linhas.push(`- ${id}: trecho ${i + 1}/${n} pronto para enviar (chame flow_status de novo).`);
        break;
      }
      const restante = v.maxCreditos ? v.maxCreditos - v.gasto : undefined;
      if (restante !== undefined && restante < custoDoTrecho(v.modelo, i)) {
        alterar(id, (x) => ((x.estado = "falhou"), (x.erro = `O teto de ${v.maxCreditos} créditos acabou (gasto ${v.gasto}) antes do trecho ${i + 1}.`)));
        res.linhas.push(`- ${id}: PAROU — teto de créditos atingido.`);
        break;
      }
      progresso(`Vídeo longo ${id}: enviando o trecho ${i + 1} de ${n}…`);
      try {
        if (i === 0) {
          const r = await gerarVideo(
            {
              prompt: t.prompt, modelo: v.modelo, proporcao: v.proporcao, quantidade: 1, personagens: v.inicio.personagens, voz: v.inicio.voz,
              estiloVoz: v.inicio.estiloVoz, imagemInicio: v.inicio.imagemInicio, referencias: v.inicio.referencias, maxCreditos: restante,
              qualidade: "original", projeto: v.projeto, apenasEnviar: true, aoEnviar: reservar(id, 0),
            },
            prazo,
            progresso,
          );
          res.linhas.push(`- ${id}: trecho 1/${n} (vídeo base) enviado — ${r.configuracao}, ${r.custoEstimado} créditos.`);
        } else {
          const alvo = i === 1 ? v.base : v.cena;
          if (!alvo) throw new Error(`Falta ${i === 1 ? "o vídeo base" : "a cena"} para continuar o trecho ${i + 1}.`);
          const r = await estenderVideo(
            {
              id: alvo, prompt: t.prompt, modelo: v.modelo, maxCreditos: restante, projeto: v.projeto, apenasEnviar: true, apenasClipe: true, aoEnviar: reservar(id, i),
              ...(v.elementosNasExtensoes ? { personagens: v.inicio.personagens, voz: v.inicio.voz, estiloVoz: v.inicio.estiloVoz } : {}),
            },
            prazo,
            progresso,
          );
          // A cena nasce na primeira extensão; guardo já (o clipe ainda vai ficar pronto).
          const cena = lerLotes().find((l) => l.lote === r.lote)?.cena;
          if (cena) alterar(id, (x) => (x.cena = cena));
          res.linhas.push(`- ${id}: trecho ${i + 1}/${n} (extensão) enviado — ${r.configuracao}, ${r.custoEstimado} créditos.${r.avisos.length ? ` Aviso: ${r.avisos.join(" ")}` : ""}`);
        }
      } catch (erro) {
        const msg = mensagemDeErro(erro);
        const reservado = !!lerVideos().find((x) => x.id === id)?.trechos[i].lote;
        if (reservado && erro instanceof EnvioNaoAconteceu) {
          // O clique não virou geração (nada foi gasto): desfaz a reserva.
          const certo = /não começou no Flow/.test(msg);
          alterar(id, (x) => {
            x.trechos[i].lote = undefined;
            x.gasto = Math.max(0, x.gasto - (x.trechos[i].custo ?? custoDoTrecho(x.modelo, i)));
            x.trechos[i].custo = undefined;
            if (!certo) {
              x.estado = "falhou";
              x.erro = `Trecho ${i + 1}: ${msg} Confira flow_creditos; se o saldo não caiu, chame flow_video_longo com retomar="${id}".`;
            }
          });
          res.linhas.push(certo ? `- ${id}: trecho ${i + 1}/${n} não começou no Flow (nada foi gasto); vai de novo no próximo flow_status.` : `- ${id}: PAROU no trecho ${i + 1} — ${msg}`);
        } else if (reservado) {
          // O clique pode ter acontecido: segue como enviado (o flow_status confirma).
          res.linhas.push(`- ${id}: trecho ${i + 1}/${n} enviado, mas houve um erro depois (${msg}). NÃO reenvie; o flow_status confere.`);
        } else if (ehFaltaDeTempo(msg)) {
          const x = alterar(id, (y) => (y.trechos[i].semTempo = (y.trechos[i].semTempo ?? 0) + 1));
          const vezes = x.trechos[i].semTempo ?? 1;
          res.linhas.push(
            vezes >= 3
              ? `- ${id}: o trecho ${i + 1}/${n} não coube no tempo da chamada ${vezes} vezes seguidas (o Flow está lento agora; nada foi gasto). Espere alguns minutos e chame flow_status, ou continue pelo Claude Code (sem o limite de ~50 s).`
              : `- ${id}: trecho ${i + 1}/${n} não enviado agora (${msg}); vai no próximo flow_status.`,
          );
        } else {
          alterar(id, (x) => ((x.estado = "falhou"), (x.erro = `Trecho ${i + 1} não foi enviado: ${msg}`)));
          res.linhas.push(`- ${id}: PAROU no trecho ${i + 1} — ${msg} (nada foi gasto neste trecho).`);
        }
      }
      break; // o próximo passo depende deste ficar pronto
    }
  }
  return res;
}

/** Lotes em geração que pertencem a vídeos longos (para o acompanhamento focar neles). */
function lotesEmGeracao(id: string): string[] {
  const v = lerVideos().find((x) => x.id === id);
  const pendentes = new Set(lerLotes().map((l) => l.lote));
  return (v?.trechos ?? []).map((t) => t.lote).filter((l): l is string => !!l && pendentes.has(l));
}

/** Avança e acompanha um vídeo longo enquanto houver tempo (no Claude Code dá para ir longe). */
async function seguir(id: string, prazo: Prazo, progresso: (m: string) => void): Promise<Avanco> {
  const total: Avanco = { linhas: [], arquivos: [] };
  for (let volta = 0; volta < 12; volta++) {
    const a = await avancarVideosLongos(prazo, progresso, id);
    total.linhas.push(...a.linhas);
    total.arquivos.push(...a.arquivos);
    const v = lerVideos().find((x) => x.id === id);
    const lotes = lotesEmGeracao(id);
    if (!v || v.estado !== "andamento" || !lotes.length || !prazo.sobra(60000)) break;
    progresso(`Vídeo longo ${id}: esperando o trecho ficar pronto…`);
    for (const lote of lotes) await statusFlow(prazo, lote, progresso);
  }
  return total;
}

/** Custo padrão de um trecho: o 1º usa o modelo pedido; as extensões, o modelo que o Flow oferece. */
function custoDoTrecho(modelo: ModeloLongo, i: number): number {
  return CUSTO_VIDEO[i === 0 ? modelo : MODELO_EXTENSAO_PADRAO];
}

function descrever(v: VideoLongo): string {
  const prontos = v.trechos.filter((t) => t.clipe).length;
  const cab = `Vídeo longo ${v.id} "${v.titulo}": ${v.estado === "andamento" ? "em andamento" : v.estado} · ${prontos}/${v.trechos.length} trechos prontos · ${v.modelo} · ${v.proporcao} · gasto ${v.gasto}${v.maxCreditos ? ` de ${v.maxCreditos}` : ""} créditos`;
  const extra = [v.arquivo ? `Arquivo final: ${v.arquivo}` : "", v.erro ? `Motivo: ${v.erro}` : "", v.cena && v.projeto ? `Cena no Flow: https://flow.google.com/project/${v.projeto}/scene/${v.cena}` : ""].filter(Boolean);
  return [cab, ...extra].join("\n");
}

export interface PedidoVideoLongo {
  trechos: string[];
  titulo?: string;
  modelo: ModeloLongo;
  proporcao: ProporcaoVideo;
  /** Teto opcional (só se o usuário pedir). */
  maxCreditos?: number;
  projeto?: string;
  personagens?: string[];
  voz?: string;
  estiloVoz?: string;
  /** Restrições visuais repetidas em todos os trechos (ex.: "sem fogo, sem faíscas, mão mecânica fosca"). */
  restricoes?: string;
  imagemInicio?: string;
  referencias?: string[];
  /** Acrescenta às extensões um lembrete de continuidade (mesmo personagem, voz e estilo). */
  reforcarContinuidade: boolean;
  /** Repete personagens e voz em cada extensão. */
  elementosNasExtensoes: boolean;
  /** Avisos do modo apresentador (tamanho das falas), repetidos na resposta. */
  avisos?: string[];
}

export async function criarVideoLongo(pedido: PedidoVideoLongo, prazo: Prazo, progresso: (m: string) => void = () => {}): Promise<{ texto: string; arquivos: Arquivo[] }> {
  const n = pedido.trechos.length;
  const estimado = pedido.trechos.reduce((t, _, i) => t + custoDoTrecho(pedido.modelo, i), 0);
  if (pedido.maxCreditos && estimado > pedido.maxCreditos) {
    throw new Error(`O vídeo longo custaria ~${estimado} créditos (1º trecho ${CUSTO_VIDEO[pedido.modelo]} com ${pedido.modelo} + ${n - 1} extensões × ${CUSTO_VIDEO[MODELO_EXTENSAO_PADRAO]}), acima de max_creditos = ${pedido.maxCreditos}. Nada foi enviado.`);
  }
  conferirTetoDeHoje(estimado); // o vídeo inteiro precisa caber no teto do dia (não para no meio)
  if ((pedido.personagens?.length || pedido.referencias?.length || pedido.voz) && pedido.imagemInicio) {
    throw new Error("Use personagens/referencias/voz OU imagem_inicio no primeiro trecho, não os dois (no Flow são modos diferentes). Nada foi enviado.");
  }
  const emAndamento = lerVideos().filter((v) => v.estado === "andamento");
  if (emAndamento.length >= 3) {
    throw new Error(`Já há ${emAndamento.length} vídeos longos em andamento (${emAndamento.map((v) => v.id).join(", ")}). Termine-os com flow_status antes de começar outro.`);
  }
  const v: VideoLongo = {
    id: "vl" + Date.now().toString(36),
    titulo: (pedido.titulo?.trim() || pedido.trechos[0]).slice(0, 60),
    criadoEm: new Date().toISOString(),
    modelo: pedido.modelo,
    proporcao: pedido.proporcao,
    maxCreditos: pedido.maxCreditos,
    gasto: 0,
    projeto: undefined,
    // O estilo da voz já vai escrito em cada trecho (fixarNoTrecho); não repito pelo gerarVideo/estenderVideo.
    inicio: { personagens: pedido.personagens, voz: pedido.voz, imagemInicio: pedido.imagemInicio, referencias: pedido.referencias },
    elementosNasExtensoes: pedido.elementosNasExtensoes,
    trechos: pedido.trechos.map((prompt, i) => ({
      prompt: fixarNoTrecho(i > 0 && pedido.reforcarContinuidade ? `${prompt.trim()} ${CONTINUIDADE}` : prompt, { restricoes: pedido.restricoes, estiloVoz: pedido.estiloVoz }),
    })),
    estado: "andamento",
  };
  // O projeto pedido (nome/link) é resolvido no primeiro envio; até lá guardo o texto como veio.
  if (pedido.projeto) v.projeto = pedido.projeto;
  acrescentarVideo(v);
  const a = await seguir(v.id, prazo, progresso);
  const atual = lerVideos().find((x) => x.id === v.id) ?? v;
  return {
    texto: [
      `${descrever(atual)}`,
      `Custo estimado: ~${estimado} créditos (1º trecho ${CUSTO_VIDEO[pedido.modelo]} com ${pedido.modelo} + ${n - 1} × ${CUSTO_VIDEO[MODELO_EXTENSAO_PADRAO]} nas extensões, que o Flow faz com ${MODELO_EXTENSAO_PADRAO}). Duração final: ~${duracaoAproximada(n)} s (8 s do 1º trecho + ~7 s por extensão).`,
      ...(pedido.avisos?.length ? [`Avisos:\n- ${pedido.avisos.join("\n- ")}`] : []),
      ...a.linhas,
      atual.estado === "andamento"
        ? "Cada trecho leva ~1-2 min e depende do anterior: chame flow_status (repetindo) até aparecer PRONTO. Não chame flow_video_longo de novo para o mesmo vídeo."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    arquivos: a.arquivos,
  };
}

/** Retoma um vídeo longo que parou (trecho que falhou é enviado de novo; os prontos ficam). */
export async function retomarVideoLongo(id: string, prazo: Prazo, progresso: (m: string) => void = () => {}): Promise<{ texto: string; arquivos: Arquivo[] }> {
  const pendentes = new Set(lerLotes().map((l) => l.lote));
  alterar(id, (v) => {
    if (v.estado === "concluido") throw new Error(`O vídeo longo ${id} já está pronto: ${v.arquivo}`);
    const i = v.trechos.findIndex((t) => !t.clipe);
    if (i >= 0 && v.trechos[i].lote && !pendentes.has(v.trechos[i].lote!)) {
      const fim = lerResultados().find((r) => r.lote === v.trechos[i].lote);
      // Só libera o reenvio se o lote terminou sem clipe (falhou/expirou/sumiu).
      if (!(fim?.estado === "concluido" && (fim.clipe ?? fim.ids[0]))) v.trechos[i].lote = undefined;
    }
    v.estado = "andamento";
    v.erro = undefined;
    v.tentativasExportar = 0;
  });
  const a = await seguir(id, prazo, progresso);
  const atual = lerVideos().find((x) => x.id === id)!;
  return { texto: [descrever(atual), ...a.linhas].join("\n"), arquivos: a.arquivos };
}

/** Usado pelo flow_status: avança os vídeos longos e devolve as linhas do relatório. */
export async function continuarVideosLongos(prazo: Prazo, progresso: (m: string) => void = () => {}): Promise<Avanco> {
  if (!lerVideos().some((v) => v.estado === "andamento")) return { linhas: [], arquivos: [] };
  const a = await avancarVideosLongos(prazo, progresso);
  return { linhas: a.linhas.length ? ["Vídeo longo:", ...a.linhas] : [], arquivos: a.arquivos };
}

export function listarVideosLongos(): string {
  const lista = lerVideos();
  if (!lista.length) return "Nenhum vídeo longo criado ainda.";
  return lista.slice(-10).reverse().map(descrever).join("\n\n");
}
