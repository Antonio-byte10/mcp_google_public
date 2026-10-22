import { existsSync, readFileSync } from "node:fs";
import { comTravaDeArquivo, gravarJsonAtomico } from "./trava-arquivo.js";
import path from "node:path";
import { PASTA_SAIDAS } from "./config.js";
import { conferirTetoDeHoje } from "./gastos.js";
import { gerarVideo, type ModeloVideo, type ProporcaoVideo } from "./flow.js";
import { CUSTO_VIDEO } from "./seletores.js";
import { mensagemDeErro } from "./seguranca.js";
import type { Prazo } from "./prazo.js";

// Roteiro em lote: várias cenas de vídeo numa chamada (teto total opcional). Cada cena é enviada
// como um vídeo comum (gerarVideo só enviando); o acompanhamento e o download ficam com o
// flow_status. No Claude Desktop (~50 s por chamada) cabe uma cena por vez: as outras ficam na
// fila em saidas/roteiros.json e o flow_status continua enviando antes de acompanhar.

export interface CenaRoteiro {
  prompt: string;
  personagens?: string[];
  imagemInicio?: string;
  referencias?: string[];
  voz?: string;
  /** Lote do vídeo depois de enviada. */
  lote?: string;
  erro?: string;
}

export interface Roteiro {
  id: string;
  criadoEm: string;
  modelo: ModeloVideo;
  proporcao?: ProporcaoVideo;
  /** Teto total opcional do roteiro e quanto já foi gasto com ele. */
  maxCreditos?: number;
  gasto: number;
  projeto?: string;
  cenas: CenaRoteiro[];
}

const ARQUIVO = () => path.join(PASTA_SAIDAS, "roteiros.json");
// Envio de uma cena leva ~20-30 s (abrir o projeto, configurar, enviar e confirmar).
const TEMPO_POR_CENA_MS = 35000;

function lerRoteiros(): Roteiro[] {
  if (!existsSync(ARQUIVO())) return [];
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO(), "utf8"));
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

function salvarRoteiros(lista: Roteiro[]): void {
  gravarJsonAtomico(ARQUIVO(), lista);
}

/** Lê, altera e grava a lista de roteiros sob a trava do arquivo (outra janela pode gravar no meio). */
function alterarRoteiros(mudar: (lista: Roteiro[]) => Roteiro[]): void {
  comTravaDeArquivo(ARQUIVO(), () => salvarRoteiros(mudar(lerRoteiros())));
}

const pendentes = (r: Roteiro) => r.cenas.filter((c) => !c.lote && !c.erro);

/** Marca da reserva recusada: outra janela já enviou a cena (nada foi enviado por esta). */
const JA_ENVIADA = "já foi enviada por outra janela";

/**
 * Reserva o envio da cena na lista MAIS RECENTE do disco (chamada sob a trava, logo antes do clique que gasta
 * créditos): se outra janela já reservou ou marcou erro, lança e o clique não acontece. Só mexe nos campos da cena
 * e no gasto, sem regravar o roteiro velho que esta chamada leu antes de esperar o navegador.
 */
export function reservarCena(lista: Roteiro[], id: string, indice: number, lote: { lote: string; custo: number }): Roteiro[] {
  const r = lista.find((x) => x.id === id);
  const cena = r?.cenas[indice];
  if (!r || !cena) throw new Error(`Cena ${indice + 1} do roteiro ${id} não existe mais; nada foi enviado.`);
  if (cena.lote || cena.erro) throw new Error(`A cena ${indice + 1} ${JA_ENVIADA}; nada foi enviado de novo.`);
  cena.lote = lote.lote;
  r.gasto += lote.custo;
  return lista;
}

/**
 * Desfaz a reserva de uma cena cujo envio falhou depois de reservar: limpa o lote e devolve o
 * gasto, só se a reserva ainda é a nossa (mesmo lote) e a cena não foi marcada por outra janela.
 */
export function desfazerReservaCena(lista: Roteiro[], id: string, indice: number, lote: { lote: string; custo: number }): Roteiro[] {
  const r = lista.find((x) => x.id === id);
  const cena = r?.cenas[indice];
  if (!r || !cena || cena.lote !== lote.lote) return lista;
  cena.lote = undefined;
  r.gasto = Math.max(0, r.gasto - lote.custo);
  return lista;
}

/** Registra o erro de uma cena na versão atual do disco (sem sobrescrever uma cena já enviada). */
export function marcarErroCena(lista: Roteiro[], id: string, indice: number, erro: string): Roteiro[] {
  const cena = lista.find((x) => x.id === id)?.cenas[indice];
  if (cena && !cena.lote) cena.erro = erro;
  return lista;
}

/** Envia as cenas que ainda faltam (de todos os roteiros) enquanto houver tempo. */
async function enviarCenas(prazo: Prazo, progresso: (m: string) => void, so?: string): Promise<string[]> {
  const linhas: string[] = [];
  for (const roteiro of lerRoteiros().filter((r) => !so || r.id === so)) {
    for (const [i, cena] of roteiro.cenas.entries()) {
      // Sempre o disco: outra janela pode ter enviado esta cena depois da leitura acima.
      const fresca = lerRoteiros().find((x) => x.id === roteiro.id)?.cenas[i];
      if (!fresca || fresca.lote || fresca.erro) continue;
      if (!prazo.sobra(TEMPO_POR_CENA_MS)) return linhas;
      const gasto = lerRoteiros().find((x) => x.id === roteiro.id)?.gasto ?? roteiro.gasto;
      const restante = roteiro.maxCreditos ? Math.max(1, roteiro.maxCreditos - gasto) : undefined;
      progresso(`Roteiro ${roteiro.id}: enviando a cena ${i + 1} de ${roteiro.cenas.length}…`);
      let reservada: { lote: string; custo: number } | undefined;
      try {
        const r = await gerarVideo(
          {
            prompt: cena.prompt, modelo: roteiro.modelo, proporcao: roteiro.proporcao, quantidade: 1, personagens: cena.personagens,
            imagemInicio: cena.imagemInicio, referencias: cena.referencias, voz: cena.voz, maxCreditos: restante,
            qualidade: "original", projeto: roteiro.projeto, apenasEnviar: true,
            // Reserva no arquivo com o navegador travado, logo antes do clique (grava a cena e o gasto).
            aoEnviar: (lote) => {
              alterarRoteiros((ls) => reservarCena(ls, roteiro.id, i, lote));
              reservada = lote;
            },
          },
          prazo,
          progresso,
        );
        linhas.push(`- cena ${i + 1}: enviada (${r.custoEstimado} créditos, lote ${r.lote})`);
      } catch (erro) {
        const msg = mensagemDeErro(erro);
        if (msg.includes(JA_ENVIADA)) continue; // outra janela enviou: nada a fazer aqui
        // Falhou depois de reservar: desfaz a reserva (lote fantasma e gasto inflado).
        if (reservada) {
          const lote = reservada;
          alterarRoteiros((ls) => desfazerReservaCena(ls, roteiro.id, i, lote));
        }
        // Falta de tempo não é erro da cena: ela continua na fila.
        if (/tempo desta chamada acabou|navegador estava ocupado/i.test(msg)) return linhas;
        alterarRoteiros((ls) => marcarErroCena(ls, roteiro.id, i, msg));
        linhas.push(`- cena ${i + 1}: NÃO enviada — ${msg}`);
      }
    }
  }
  return linhas;
}

export interface PedidoRoteiro {
  cenas: CenaRoteiro[];
  modelo: ModeloVideo;
  proporcao?: ProporcaoVideo;
  maxCreditos?: number;
  projeto?: string;
}

export async function criarRoteiro(pedido: PedidoRoteiro, prazo: Prazo, progresso: (m: string) => void = () => {}): Promise<string> {
  const estimado = CUSTO_VIDEO[pedido.modelo] * pedido.cenas.length;
  if (pedido.maxCreditos && estimado > pedido.maxCreditos) {
    throw new Error(`O roteiro custaria ~${estimado} créditos (${pedido.cenas.length} cenas × ${CUSTO_VIDEO[pedido.modelo]} com ${pedido.modelo}), acima de max_creditos_total = ${pedido.maxCreditos}. Nada foi enviado.`);
  }
  conferirTetoDeHoje(estimado); // o roteiro inteiro precisa caber no teto do dia
  const roteiro: Roteiro = {
    id: Date.now().toString(36), criadoEm: new Date().toISOString(), modelo: pedido.modelo, proporcao: pedido.proporcao,
    maxCreditos: pedido.maxCreditos, gasto: 0, projeto: pedido.projeto, cenas: pedido.cenas.map((c) => ({ ...c })),
  };
  alterarRoteiros((ls) => [...ls, roteiro]);
  const linhas = await enviarCenas(prazo, progresso, roteiro.id);
  const atual = lerRoteiros().find((r) => r.id === roteiro.id) ?? roteiro;
  const faltam = pendentes(atual).length;
  return [
    `Roteiro ${roteiro.id}: ${roteiro.cenas.length} cenas com ${pedido.modelo} (estimado ~${estimado} créditos${pedido.maxCreditos ? `; teto ${pedido.maxCreditos}` : ""}).`,
    ...linhas,
    faltam ? `${faltam} cena(s) ainda na fila: o flow_status envia as próximas e baixa as prontas.` : "Todas as cenas foram enviadas.",
    "Chame flow_status para acompanhar e baixar os vídeos (cada um leva ~1-3 min).",
  ].join("\n");
}

/** Usado pelo flow_status: envia as cenas que ficaram na fila (se houver tempo) e limpa roteiros terminados. */
export async function continuarRoteiros(prazo: Prazo, progresso: (m: string) => void = () => {}): Promise<string[]> {
  if (!lerRoteiros().some((r) => pendentes(r).length)) return [];
  const linhas = await enviarCenas(prazo, progresso);
  let faltam = 0;
  // Roteiro com todas as cenas enviadas (ou com erro) sai da fila; os vídeos seguem como lotes comuns.
  alterarRoteiros((restantes) => {
    faltam = restantes.reduce((s, r) => s + pendentes(r).length, 0);
    return restantes.filter((r) => pendentes(r).length);
  });
  if (faltam) linhas.push(`${faltam} cena(s) de roteiro ainda na fila (chame flow_status de novo).`);
  return linhas.length ? ["Roteiro:", ...linhas] : [];
}
