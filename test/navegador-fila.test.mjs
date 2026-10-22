// Testes da fila do perfil, da espera pela saída do navegador e das novas tentativas de abrir.
// Funções puras com as dependências por parâmetro: não abrem navegador. Rodar: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirComNovasTentativas, criarFila, esperarSair } from "../dist/navegador-fila.js";

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Relógio de mentira: cada `esperar` avança o tempo na hora. */
function relogio() {
  let t = 0;
  return { agora: () => t, esperar: async (ms) => void (t += ms), passou: () => t };
}

/** Prazo de mentira com `restante` fixo (a desistência da fila dispara em restante - 5 s). */
const prazo = (restante = 60000) => ({ restante: () => restante, sobra: (ms) => restante >= ms, restanteDuro: () => restante, decorrido: () => 0, curto: true, ate: Date.now() + restante });

// ---------- esperarSair ----------

test("esperarSair: sem PID não espera nada", async () => {
  const r = relogio();
  let perguntas = 0;
  assert.equal(await esperarSair([], { existe: () => (perguntas++, true), ...r, tetoMs: 90000, intervaloMs: 1000 }), true);
  assert.equal(perguntas, 0);
  assert.equal(r.passou(), 0);
});

test("esperarSair: espera até todos os PIDs sumirem", async () => {
  const r = relogio();
  const vivos = new Map([[10, 3], [20, 5]]); // quantas perguntas cada um ainda aguenta
  const existe = (pid) => {
    const n = vivos.get(pid);
    if (!n) return false;
    vivos.set(pid, n - 1);
    return true;
  };
  assert.equal(await esperarSair([10, 20], { existe, ...r, tetoMs: 90000, intervaloMs: 1000 }), true);
  assert.ok(r.passou() >= 4000 && r.passou() <= 6000, `esperou ${r.passou()} ms`);
});

test("esperarSair: passado o teto, libera assim mesmo", async () => {
  const r = relogio();
  assert.equal(await esperarSair([10], { existe: () => true, ...r, tetoMs: 5000, intervaloMs: 1000 }), false);
  assert.ok(r.passou() >= 5000 && r.passou() <= 6000, `esperou ${r.passou()} ms`);
});

test("esperarSair: erro na checagem não prende ninguém", async () => {
  const r = relogio();
  const existe = () => {
    throw new Error("falhou");
  };
  assert.equal(await esperarSair([10], { existe, ...r, tetoMs: 90000, intervaloMs: 1000 }), false);
});

// ---------- abrirComNovasTentativas ----------

function abertura(resultados, extra = {}) {
  const r = relogio();
  const chamadas = { abrir: 0, limpar: 0 };
  const fila = [...resultados];
  return {
    chamadas,
    relogio: r,
    op: {
      abrir: async () => {
        chamadas.abrir++;
        const x = fila.shift();
        if (x instanceof Error) throw x;
        return x;
      },
      ocupado: (e) => /ProcessSingleton/.test(e.message),
      limpar: async () => (chamadas.limpar++, false),
      podeTentar: () => r.passou() < 6000,
      esperar: r.esperar,
      intervaloMs: 1500,
      naoAbriu: () => new Error("não abriu"),
      aindaFechando: () => new Error("ainda fechando"),
      ...extra,
    },
  };
}
const singleton = () => new Error("Failed to create a ProcessSingleton for your profile directory");

test("abrir: abre de primeira sem procurar processos", async () => {
  const a = abertura(["ctx"]);
  assert.equal(await abrirComNovasTentativas(a.op), "ctx");
  assert.deepEqual(a.chamadas, { abrir: 1, limpar: 0 });
});

test("abrir: erro que não é de perfil ocupado vira 'não abriu' sem novas tentativas", async () => {
  const a = abertura([new Error("executável não encontrado")]);
  await assert.rejects(abrirComNovasTentativas(a.op), /não abriu/);
  assert.deepEqual(a.chamadas, { abrir: 1, limpar: 0 });
});

test("abrir: perfil ocupado tenta de novo em intervalos curtos até abrir", async () => {
  const a = abertura([singleton(), singleton(), singleton(), "ctx"]);
  assert.equal(await abrirComNovasTentativas(a.op), "ctx");
  assert.equal(a.chamadas.abrir, 4);
  assert.equal(a.chamadas.limpar, 1);
  assert.equal(a.relogio.passou(), 3 * 1500);
});

test("abrir: janela comum ou outro processo (erro de limpar) chega ao usuário como está", async () => {
  const a = abertura([singleton()], { limpar: async () => { throw new Error("janela comum aberta"); } });
  await assert.rejects(abrirComNovasTentativas(a.op), /janela comum aberta/);
  assert.equal(a.chamadas.abrir, 1);
});

test("abrir: sem prazo para mais tentativas, diz que o navegador anterior ainda está fechando", async () => {
  const a = abertura(Array.from({ length: 20 }, singleton));
  await assert.rejects(abrirComNovasTentativas(a.op), /ainda fechando/);
  assert.equal(a.chamadas.limpar, 2, "confere de novo quem segura o perfil antes de desistir");
  assert.ok(a.chamadas.abrir >= 3 && a.chamadas.abrir <= 6, `${a.chamadas.abrir} tentativas`);
});

test("abrir: se a conferência final limpou um órfão, tenta uma última vez", async () => {
  let n = 0;
  const a = abertura([singleton(), "ctx"], { limpar: async () => ++n === 2, podeTentar: () => false });
  assert.equal(await abrirComNovasTentativas(a.op), "ctx");
  assert.equal(n, 2);
  assert.equal(a.chamadas.abrir, 2);
});

test("abrir: erro diferente numa nova tentativa vira 'não abriu'", async () => {
  const a = abertura([singleton(), new Error("crash")]);
  await assert.rejects(abrirComNovasTentativas(a.op), /não abriu/);
});

// ---------- criarFila ----------

function filaDeTeste(tetoSaidaMs = 2000) {
  const log = [];
  let travas = 0;
  const naFila = criarFila({
    pegarTrava: async () => {
      travas++;
      log.push("trava");
      return { soltar: () => (travas--, log.push("solta")) };
    },
    esperar: pausa,
    tetoSaidaMs,
  });
  return { naFila, log, travas: () => travas };
}

/** Promessa controlável por fora. */
function controle() {
  let ok, falha;
  const p = new Promise((a, b) => ((ok = a), (falha = b)));
  return { p, ok, falha };
}

test("fila: a resposta volta na hora; a próxima tarefa espera o navegador sair", async () => {
  const f = filaDeTeste();
  const saida = controle();
  const t0 = Date.now();
  const r1 = await f.naFila(async (vaga) => {
    vaga.liberarDepois(saida.p);
    return "um";
  }, prazo());
  assert.equal(r1, "um");
  assert.ok(Date.now() - t0 < 200, "a resposta não pode esperar a saída");
  let comecou2 = false;
  const r2 = f.naFila(async () => ((comecou2 = true), "dois"), prazo());
  await pausa(100);
  assert.equal(comecou2, false, "a segunda não pode começar antes da saída");
  assert.equal(f.travas(), 1, "a trava continua presa até a saída");
  saida.ok();
  assert.equal(await r2, "dois");
  await pausa(10);
  assert.equal(f.travas(), 0);
  assert.deepEqual(f.log, ["trava", "solta", "trava", "solta"]);
});

test("fila: tarefa que falha também espera a saída antes de liberar", async () => {
  const f = filaDeTeste();
  const saida = controle();
  await assert.rejects(
    f.naFila(async (vaga) => {
      vaga.liberarDepois(saida.p);
      throw new Error("deu ruim");
    }, prazo()),
    /deu ruim/,
  );
  assert.equal(f.travas(), 1);
  saida.ok();
  assert.equal(await f.naFila(async () => "depois", prazo()), "depois");
});

test("fila: saída que nunca termina é liberada pelo teto", async () => {
  const f = filaDeTeste(300);
  await f.naFila(async (vaga) => vaga.liberarDepois(new Promise(() => {})), prazo());
  const t0 = Date.now();
  assert.equal(await f.naFila(async () => "ok", prazo()), "ok");
  const esperou = Date.now() - t0;
  assert.ok(esperou >= 250 && esperou < 1500, `esperou ${esperou} ms`);
});

test("fila: erro na espera pela saída não prende a fila", async () => {
  const f = filaDeTeste();
  await f.naFila(async (vaga) => vaga.liberarDepois(Promise.reject(new Error("powershell"))), prazo());
  assert.equal(await f.naFila(async () => "ok", prazo()), "ok");
  await pausa(10);
  assert.equal(f.travas(), 0);
});

test("fila: sem liberarDepois, solta logo depois da tarefa (comportamento antigo)", async () => {
  const f = filaDeTeste();
  await f.naFila(async () => "a", prazo());
  await pausa(10);
  assert.equal(f.travas(), 0);
});

test("fila: quem desiste esperando a saída recebe a mensagem certa e nunca roda", async () => {
  const f = filaDeTeste(5000);
  const saida = controle();
  await f.naFila(async (vaga) => vaga.liberarDepois(saida.p), prazo());
  let rodou = false;
  await assert.rejects(f.naFila(async () => (rodou = true), prazo(5100)), /ainda está fechando/);
  saida.ok();
  assert.equal(await f.naFila(async () => "ok", prazo()), "ok");
  assert.equal(rodou, false);
});

test("fila: quem desiste esperando outra tarefa recebe a mensagem de sempre", async () => {
  const f = filaDeTeste();
  const fim = controle();
  const r1 = f.naFila(() => fim.p, prazo());
  await assert.rejects(f.naFila(async () => "x", prazo(5100)), /Outra ferramenta deste mesmo app/);
  fim.ok("um");
  assert.equal(await r1, "um");
});

test("fila: erro ao pegar a trava chega a quem chamou e não trava a fila", async () => {
  let primeira = true;
  const naFila = criarFila({
    pegarTrava: async () => {
      if (primeira) {
        primeira = false;
        throw new Error("em uso por outro app");
      }
      return { soltar() {} };
    },
    esperar: pausa,
    tetoSaidaMs: 1000,
  });
  await assert.rejects(naFila(async () => "x", prazo()), /em uso por outro app/);
  assert.equal(await naFila(async () => "ok", prazo()), "ok");
});
