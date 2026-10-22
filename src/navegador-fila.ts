import type { Prazo } from "./prazo.js";

// Regras puras da fila do perfil: a vez de cada tarefa, a espera pela saída do navegador e as
// novas tentativas de abrir. Quem mexe em processos, trava e relógio passa as funções por
// parâmetro, então dá para testar sem navegador (test/navegador-fila.test.mjs).

// ---------- Esperar o navegador sair ----------

export interface OpcoesSaida {
  /** O processo ainda existe? */
  existe(pid: number): boolean | Promise<boolean>;
  esperar(ms: number): Promise<void>;
  agora(): number;
  /** Passado o teto, libera assim mesmo. */
  tetoMs: number;
  intervaloMs: number;
}

/**
 * Espera os processos sumirem, perguntando a cada `intervaloMs`, até `tetoMs`. Devolve true se
 * todos saíram; false se passou do teto ou a checagem falhou (nunca lança: quem espera é liberado).
 */
export async function esperarSair(pids: number[], op: OpcoesSaida): Promise<boolean> {
  const limite = op.agora() + op.tetoMs;
  try {
    let vivos = pids;
    for (;;) {
      const restam: number[] = [];
      for (const pid of vivos) if (await op.existe(pid)) restam.push(pid);
      if (!restam.length) return true;
      if (op.agora() >= limite) return false;
      vivos = restam;
      await op.esperar(Math.min(op.intervaloMs, Math.max(0, limite - op.agora())));
    }
  } catch {
    return false;
  }
}

// ---------- Abrir com novas tentativas ----------

export interface OpcoesAbrir<T> {
  abrir(): Promise<T>;
  /** O erro é de perfil ocupado (ProcessSingleton)? */
  ocupado(erro: unknown): boolean;
  /**
   * Procura quem está com o perfil: lança erro com a causa (janela comum, outro processo vivo) ou
   * devolve true se fechou um órfão.
   */
  limpar(): Promise<boolean>;
  /** Ainda dá tempo de mais uma tentativa? */
  podeTentar(): boolean;
  esperar(ms: number): Promise<void>;
  intervaloMs: number;
  /** Erro para quando o navegador não abriu por outro motivo. */
  naoAbriu(erro: unknown): Error;
  /** Erro para quando o perfil continuou ocupado até o fim das tentativas. */
  aindaFechando(): Error;
}

/**
 * Abre o navegador. Com o perfil ocupado e nada visível para limpar, o navegador anterior ainda
 * está saindo (o Windows chega a levar dezenas de segundos): tenta de novo em intervalos curtos
 * enquanto `podeTentar()` deixar.
 */
export async function abrirComNovasTentativas<T>(op: OpcoesAbrir<T>): Promise<T> {
  const tentar = async (): Promise<{ ctx: T } | undefined> => {
    try {
      return { ctx: await op.abrir() };
    } catch (erro) {
      if (!op.ocupado(erro)) throw op.naoAbriu(erro);
      return undefined;
    }
  };
  let aberto = await tentar();
  if (aberto) return aberto.ctx;
  let limpou = await op.limpar();
  for (;;) {
    if (!limpou) await op.esperar(op.intervaloMs);
    limpou = false;
    if (!op.podeTentar()) break;
    aberto = await tentar();
    if (aberto) return aberto.ctx;
  }
  // Antes de desistir, confere de novo: se agora há uma causa visível, a mensagem dela é a certa.
  if (await op.limpar()) aberto = await tentar();
  if (aberto) return aberto.ctx;
  throw op.aindaFechando();
}

// ---------- Fila (dentro do processo) + trava (entre processos) ----------

export interface Vaga {
  /**
   * Entrega a espera pela saída do navegador: a resposta não espera por ela, mas a próxima
   * tarefa (deste e de outros processos) só começa depois que ela terminar.
   */
  liberarDepois(saida: Promise<unknown>): void;
}

export interface OpcoesFila {
  /** Pega a trava entre processos (a espera máxima é decidida por quem passa a função). */
  pegarTrava(prazo: Prazo): Promise<{ soltar(): void }>;
  esperar(ms: number): Promise<void>;
  /** Teto da espera pela saída, por garantia (a espera passada já deve ter o seu). */
  tetoSaidaMs: number;
}

/**
 * Cria a fila do perfil. Roda cada tarefa na vez dela, respeitando o prazo: quem espera demais na
 * fila desiste (sem furar a fila nem rodar junto com outra). A vaga e a trava só são soltas
 * quando a tarefa termina (bem ou mal) e a saída entregue em `liberarDepois` acaba, ou o teto passa.
 */
export function criarFila(op: OpcoesFila) {
  let fila: Promise<unknown> = Promise.resolve();
  let esperandoSaida = false;

  return function naFila<T>(tarefa: (vaga: Vaga) => Promise<T>, prazo: Prazo): Promise<T> {
    let desistiu = false;
    let comecou = false;
    const vez = fila.then(async () => {
      if (desistiu) throw new Error("desistiu da fila");
      comecou = true;
      const trava = await op.pegarTrava(prazo);
      let saida: Promise<unknown> = Promise.resolve();
      let execucao: Promise<T>;
      try {
        execucao = tarefa({ liberarDepois: (p) => void (saida = p) });
      } catch (erro) {
        execucao = Promise.reject(erro);
      }
      const liberada = execucao
        .then(
          () => {},
          () => {},
        )
        .then(() => {
          esperandoSaida = true;
          return Promise.race([saida, op.esperar(op.tetoSaidaMs)]);
        })
        .catch(() => {})
        .finally(() => {
          esperandoSaida = false;
          trava.soltar();
        });
      return { execucao, liberada };
    });
    fila = vez.then(
      (v) => v.liberada,
      () => {},
    );
    let relogio: NodeJS.Timeout | undefined;
    const desistencia = new Promise<T>((_, falha) => {
      relogio = setTimeout(() => {
        if (comecou) return;
        desistiu = true;
        falha(
          new Error(
            esperandoSaida
              ? "O navegador da tarefa anterior ainda está fechando (o Windows está demorando para encerrá-lo) e o tempo desta chamada acabou; nada foi feito. Tente de novo em instantes."
              : "Outra ferramenta deste mesmo app ainda está usando o navegador e o tempo desta chamada acabou; nada foi feito. Tente de novo em instantes.",
          ),
        );
      }, Math.max(0, prazo.restante() - 5000));
    });
    const resultado = vez.then((v) => v.execucao);
    return Promise.race([resultado.finally(() => clearTimeout(relogio)), desistencia]);
  };
}
