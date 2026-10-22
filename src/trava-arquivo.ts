import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

// Trava curta por arquivo de estado (roteiros.json, pendentes.json, videos longos, geracoes.jsonl…).
// Dentro de um processo o ciclo ler → alterar → gravar já é atômico porque é todo síncrono; o risco real
// são dois servidores (Claude Code e Claude Desktop) mexendo no mesmo arquivo ao mesmo tempo. A trava de
// perfil (trava.ts) só cobre quem usa o navegador, e o acompanhamento de status não usa. Por isso a trava
// aqui é um arquivo ".lock" criado com a flag "wx" (exclusiva) em volta do trecho, com espera curta.

const ESPERA_MAX_MS = 10_000;
// Trava esquecida (processo morto no meio do trecho): o trecho dura milissegundos, então 5 s é folga de sobra
// e, sendo menor que a espera máxima, uma queda não bloqueia as chamadas seguintes até estourar o prazo.
const OBSOLETA_MS = 5_000;

const seguradas = new Set<string>();
const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Executa `fn` com exclusão mútua sobre `arquivo` (entre chamadas e entre processos). Reentrante. */
export function comTravaDeArquivo<T>(arquivo: string, fn: () => T, esperaMaxMs = ESPERA_MAX_MS): T {
  const trava = arquivo + ".lock";
  if (seguradas.has(trava)) return fn();
  mkdirSync(path.dirname(trava), { recursive: true });
  const limite = Date.now() + esperaMaxMs;
  let semArquivo = 0; // voltas seguidas com EPERM/EACCES sem arquivo de trava existente
  for (;;) {
    try {
      closeSync(openSync(trava, "wx"));
      break;
    } catch (e) {
      const codigo = (e as NodeJS.ErrnoException).code;
      // No Windows, abrir um arquivo que está sendo apagado pode dar EPERM/EBUSY em vez de EEXIST.
      if (codigo !== "EEXIST" && codigo !== "EPERM" && codigo !== "EBUSY" && codigo !== "EACCES") throw e;
      let idade: number | null = null;
      try {
        idade = Date.now() - statSync(trava).mtimeMs;
      } catch {
        // Sem arquivo de trava: EEXIST/EBUSY foi corrida com a remoção (tenta de novo); EPERM/EACCES é pasta sem permissão.
        // No Windows isso também acontece por instantes durante a remoção da trava por outro processo: tolera poucas voltas.
        if ((codigo === "EPERM" || codigo === "EACCES") && ++semArquivo > 20) throw e;
      }
      if (idade !== null) semArquivo = 0;
      if (idade !== null && idade > OBSOLETA_MS) {
        try {
          unlinkSync(trava);
          continue;
        } catch {
          // outro processo removeu primeiro, ou não é um arquivo: segue para o prazo (nunca gira sem dormir)
        }
      }
      // O prazo vale em TODA volta, inclusive quando a trava sumiu entre o open e o stat.
      if (Date.now() > limite) throw new Error(`Não consegui a trava de ${path.basename(arquivo)} (outra janela está gravando); tente de novo.`);
      dormir(15);
    }
  }
  seguradas.add(trava);
  try {
    return fn();
  } finally {
    seguradas.delete(trava);
    try {
      unlinkSync(trava);
    } catch {
      // já removida
    }
  }
}

/** Grava por arquivo temporário único + rename: nunca deixa o destino pela metade. */
export function gravarJsonAtomico(arquivo: string, dados: unknown): void {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(dados, null, 2));
    renameSync(tmp, arquivo);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // nada a limpar
    }
    throw e;
  }
}
