import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { ehTelaDeLogin, hostPermitido } from "./seguranca.js";
import { infoCliente, type Prazo } from "./prazo.js";
import { nomeDaTrava, pegarTrava } from "./trava.js";
import { NAVEGADOR, PASTA_PERFIL, AVISO_NAVEGADOR, rotuloNavegador } from "./navegador-ativo.js";
import { esperar, liberarPerfil, matarMeuNavegador, pidsDoMeuNavegador, processoExiste } from "./navegador-processos.js";
import { abrirComNovasTentativas, criarFila, esperarSair, type Vaga } from "./navegador-fila.js";
import { acharExecutavel, opcoesDeLancamento } from "./navegador-tipos.js";
import { janelaLoginAberta } from "./navegador-login.js";

// Contexto do Playwright no perfil logado, fila/trava de uso e o vigia de prazo.

const NOME_TRAVA = nomeDaTrava(PASTA_PERFIL);

// Cookies que só existem quando a conta Google está logada.
const COOKIES_DE_SESSAO = ["SID", "__Secure-1PSID", "__Secure-3PSID"];

export const MENSAGEM_SEM_SESSAO = `A sessão do Google expirou ou não existe. Use login_iniciar, entre na conta na janela do ${rotuloNavegador()} e feche a janela.`;

// Quanto um processo espera o outro (Code × Desktop) liberar o navegador, no máximo.
const ESPERA_MAX_TRAVA_MS = 90000;
// Margem depois do fim da chamada antes de fechar à força um navegador que não terminou.
const MARGEM_VIGIA_MS = 10000;
// Quanto, no máximo, a próxima tarefa espera o processo do navegador anterior terminar.
const TETO_SAIDA_MS = 90000;

// ---------- Abrir e fechar o navegador da automação ----------

/** Abre o navegador com Playwright no perfil já logado. */
export async function abrirContexto(headless: boolean, timeoutMs = 30000): Promise<BrowserContext> {
  // O navegador guarda as abas para restaurar em Default/Sessions. Com as páginas pesadas do
  // Flow, isso chegou a 68 MB e fazia cada abertura levar 1-2 minutos. Não tem login
  // nem cookies ali (ficam em Default/Network), então dá para apagar sempre.
  try {
    rmSync(path.join(PASTA_PERFIL, "Default", "Sessions"), { recursive: true, force: true });
  } catch {
    // arquivo em uso: outro navegador está com o perfil (tratado ao abrir)
  }
  return chromium.launchPersistentContext(PASTA_PERFIL, opcoesDeLancamento(NAVEGADOR, acharExecutavel(NAVEGADOR.id, existsSync), headless, timeoutMs));
}

const PERFIL_OCUPADO = /exitCode=21|ProcessSingleton|existing browser session|has been closed|user data directory is already in use/i;

/**
 * Abre o navegador. Se o perfil estiver ocupado: janela comum ou outro processo vivo → avisa;
 * órfão → fecha; nada visível → o navegador anterior ainda está saindo, então tenta de novo em
 * intervalos curtos enquanto o prazo deixar (com margem para a tarefa) e por no máximo 2 minutos.
 */
async function abrirComRecuperacao(prazo: Prazo): Promise<BrowserContext> {
  const tempo = () => Math.min(30000, Math.max(5000, prazo.restante()));
  const limite = Date.now() + 120000;
  return abrirComNovasTentativas({
    abrir: () => abrirContexto(true, tempo()),
    ocupado: (erro) => PERFIL_OCUPADO.test(erro instanceof Error ? erro.message : String(erro)),
    limpar: liberarPerfil,
    podeTentar: () => prazo.sobra(15000) && Date.now() < limite,
    esperar,
    intervaloMs: 1500,
    naoAbriu: () => new Error(`O ${rotuloNavegador()} não abriu. Confira se ele está instalado e atualizado.${AVISO_NAVEGADOR ? ` ${AVISO_NAVEGADOR}` : ""}`),
    aindaFechando: () => new Error(`O ${rotuloNavegador()} da tarefa anterior ainda está fechando (o Windows está demorando para encerrá-lo). Tente de novo em instantes.`),
  });
}

/** Fecha o contexto; se o navegador não sair em alguns segundos (o Playwright esperaria para sempre), fecha à força. */
async function fecharComLimite(ctx: BrowserContext, ms = 8000): Promise<void> {
  const fechou = await Promise.race([ctx.close().then(() => true, () => true), esperar(ms).then(() => false)]);
  if (!fechou) {
    await matarMeuNavegador();
    await Promise.race([ctx.close().catch(() => {}), esperar(3000)]);
  }
}

// ---------- Fila (dentro do processo) + trava (entre processos) ----------

// O perfil só pode estar aberto em um navegador por vez. Dentro deste processo as tarefas
// entram numa fila (src/navegador-fila.ts); entre processos (Claude Code e Claude Desktop rodando
// o MCP ao mesmo tempo) vale a trava de src/trava.ts. Neste PC o navegador leva de 11 a 100 s
// para sair depois do close(): a resposta volta na hora, mas a fila e a trava só são soltas
// quando o processo dele termina (ou o teto passa), para a próxima abertura não dar de cara com
// o perfil ocupado.
const naFila = criarFila({
  // O "até" inclui o teto da saída: quem espera em outro processo não acha que travamos.
  pegarTrava: (prazo) =>
    pegarTrava(
      NOME_TRAVA,
      { pid: process.pid, app: infoCliente().cliente, desde: Date.now(), ate: Date.now() + prazo.restanteDuro() + MARGEM_VIGIA_MS + TETO_SAIDA_MS },
      Math.min(ESPERA_MAX_TRAVA_MS, Math.max(0, prazo.restante() - 8000)),
    ),
  // Este relógio não segura o processo vivo (o servidor precisa poder encerrar).
  esperar: (ms) => new Promise<void>((r) => setTimeout(r, ms).unref()),
  tetoSaidaMs: TETO_SAIDA_MS + 5000,
});

/**
 * Abre o navegador, roda `uso` e fecha. O PID do navegador é procurado em paralelo com a tarefa
 * (a consulta ao Windows leva de 1 a 8 s e não soma ao tempo da chamada); depois de fechar, a vaga
 * na fila fica presa até esse processo sair. Sem PID (consulta falhou ou o navegador já saiu), solta
 * logo depois de fechar, como antes. Um PID reaproveitado pelo Windows dentro do teto só faz a
 * próxima tarefa esperar até o teto.
 */
async function comNavegador<T>(prazo: Prazo, vaga: Vaga, uso: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const ctx = await abrirComRecuperacao(prazo);
  const pids = pidsDoMeuNavegador();
  try {
    return await uso(ctx);
  } finally {
    vaga.liberarDepois(pids.then((lista) => esperarSair(lista, { existe: processoExiste, esperar, agora: Date.now, tetoMs: TETO_SAIDA_MS, intervaloMs: 1000 })));
    await fecharComLimite(ctx);
  }
}

/**
 * Garante que a aba está num site permitido e logada. Chame depois de cada navegação.
 * Se o Google mandou para a tela de login, a sessão acabou.
 */
export function conferirPagina(pagina: Page): void {
  const url = pagina.url();
  if (ehTelaDeLogin(url)) throw new Error(MENSAGEM_SEM_SESSAO);
  if (!hostPermitido(url)) throw new Error(`Por segurança, parei: a página foi para um endereço inesperado (${new URL(url).hostname || url}).`);
}

/** Navega e confere o destino (site permitido e sessão ativa). */
export async function irPara(pagina: Page, url: string): Promise<void> {
  if (!hostPermitido(url)) throw new Error(`Endereço não permitido: ${url}`);
  await pagina.goto(url, { waitUntil: "domcontentloaded" });
  conferirPagina(pagina);
}

/**
 * Abre o navegador invisível no perfil logado, roda a tarefa e fecha. Um vigia garante que nada
 * passa muito do prazo: se a tarefa não terminar (ou o app cancelar a chamada), o navegador é
 * fechado à força — toda espera do Playwright falha na hora e o perfil fica livre.
 */
export function comPagina<T>(tarefa: (pagina: Page) => Promise<T>, prazo: Prazo): Promise<T> {
  return naFila(async (vaga) => {
    if (janelaLoginAberta()) throw new Error("Feche a janela de login antes de usar as ferramentas.");
    if (!prazo.sobra(8000)) throw new Error("O navegador estava ocupado e o tempo desta chamada acabou; nada foi feito. Tente de novo.");
    return comNavegador(prazo, vaga, async (ctx) => {
      let vigia: NodeJS.Timeout | undefined;
      let aoCancelar: (() => void) | undefined;
      const morte = new Promise<never>((_, falha) => {
        const matar = (motivo: string) => {
          // Espera o navegador morrer de fato antes de responder (e de fechar/liberar o perfil).
          void matarMeuNavegador().finally(() => falha(new Error(motivo)));
        };
        vigia = setTimeout(() => matar("A tarefa passou do tempo e o navegador foi fechado. Se algo foi enviado ao Google, confira com flow_status / notebook_estudio_status."), prazo.restanteDuro() + MARGEM_VIGIA_MS);
        aoCancelar = () => setTimeout(() => matar("A chamada foi cancelada pelo app e o navegador foi fechado."), MARGEM_VIGIA_MS);
        prazo.sinal?.addEventListener("abort", aoCancelar, { once: true });
      });
      morte.catch(() => {}); // a falha é tratada pela corrida abaixo
      try {
        const pagina = ctx.pages()[0] ?? (await ctx.newPage());
        // Nenhuma espera do Playwright passa do prazo da chamada (o padrão seria 30 s por ação).
        pagina.setDefaultTimeout(Math.max(3000, Math.min(30000, prazo.restante())));
        return await Promise.race([tarefa(pagina), morte]);
      } finally {
        clearTimeout(vigia);
        if (aoCancelar) prazo.sinal?.removeEventListener("abort", aoCancelar);
      }
    });
  }, prazo);
}

/** Confere se o perfil tem cookies de sessão do Google. Não lê nem devolve os valores. */
export function sessaoAtiva(prazo: Prazo): Promise<boolean> {
  return naFila(
    (vaga) =>
      comNavegador(prazo, vaga, async (ctx) => {
        const cookies = await ctx.cookies("https://www.google.com");
        return cookies.some((c) => COOKIES_DE_SESSAO.includes(c.name));
      }),
    prazo,
  );
}

/** Ao encerrar o servidor: fecha o navegador que este processo abriu (se ainda estiver aberto). */
export async function encerrarNavegador(): Promise<void> {
  await matarMeuNavegador();
}
