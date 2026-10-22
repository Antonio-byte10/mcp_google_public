import { spawn, type ChildProcess } from "node:child_process";
import { AVISO_NAVEGADOR, caminhoNavegador, PASTA_PERFIL, rotuloNavegador } from "./navegador-ativo.js";
import { haAutomacaoNoPerfil, liberarPerfil } from "./navegador-processos.js";
import { descreverDono, nomeDaTrava, quemSegura } from "./trava.js";

// O Google bloqueia login em navegador controlado por automação ("Esse navegador ou app pode
// não ser seguro"). Por isso o login é feito num navegador comum, sem Playwright, e a automação
// só reaproveita a sessão gravada no mesmo perfil.

let janelaLogin: ChildProcess | null = null;

/** O perfil fica travado enquanto a janela de login estiver aberta. */
export function janelaLoginAberta(): boolean {
  return janelaLogin !== null;
}

/** Abre o navegador normal (sem automação) para você fazer login manualmente. */
export async function iniciarLogin(): Promise<string> {
  if (janelaLogin) {
    return "A janela de login já está aberta. Faça login e feche a janela quando terminar.";
  }
  // Com a automação usando o perfil, o navegador comum abriria a página dentro dela (invisível).
  const dono = await quemSegura(nomeDaTrava(PASTA_PERFIL));
  if (dono) throw new Error(`Agora não dá para abrir o login: ${descreverDono(dono)}`);
  if (await haAutomacaoNoPerfil()) await liberarPerfil();
  janelaLogin = spawn(
    caminhoNavegador(),
    [
      `--user-data-dir=${PASTA_PERFIL}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://notebook.google.com/",
    ],
    { stdio: "ignore" },
  );
  janelaLogin.on("exit", () => {
    janelaLogin = null;
  });
  janelaLogin.on("error", () => {
    janelaLogin = null;
  });
  const aviso = AVISO_NAVEGADOR ? ` Aviso: ${AVISO_NAVEGADOR}` : "";
  return `Janela do ${rotuloNavegador()} aberta. Faça login na sua conta Google e feche a janela quando terminar.${aviso}`;
}
