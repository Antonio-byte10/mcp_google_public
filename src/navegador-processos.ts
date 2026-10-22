import { execFile, spawnSync } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NAVEGADOR, PASTA_PERFIL, rotuloNavegador } from "./navegador-ativo.js";

const execFileP = promisify(execFile);
export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- Processos do navegador neste perfil ----------

interface ProcessoNavegador {
  pid: number;
  pai: number;
  /** true = aberto pelo Playwright (--remote-debugging-pipe); false = janela comum (ex.: login). */
  automacao: boolean;
}

/** Processos principais do navegador que estão usando o NOSSO perfil (nunca outros perfis do usuário). */
async function processosDoPerfil(): Promise<ProcessoNavegador[]> {
  if (process.platform !== "win32") return [];
  const ps = `Get-CimInstance Win32_Process -Filter "Name='${NAVEGADOR.processo}'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 15000, windowsHide: true });
    const alvo = `--user-data-dir=${path.resolve(PASTA_PERFIL)}`.toLowerCase();
    const lista = ([] as Record<string, unknown>[]).concat(JSON.parse(stdout.trim() || "[]"));
    return lista
      .filter((p) => {
        const c = String(p.CommandLine ?? "").toLowerCase();
        const i = c.indexOf(alvo);
        // Confere o fim do caminho para não confundir "perfil" com "perfil2".
        return i >= 0 && ["", '"', " "].includes(c[i + alvo.length] ?? "");
      })
      .map((p) => ({ pid: Number(p.ProcessId), pai: Number(p.ParentProcessId), automacao: /--remote-debugging-pipe/i.test(String(p.CommandLine)) }));
  } catch {
    return [];
  }
}

/** Há um navegador de automação (Playwright) usando o perfil? */
export async function haAutomacaoNoPerfil(): Promise<boolean> {
  return (await processosDoPerfil()).some((e) => e.automacao);
}

async function processoNode(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileP("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 8000, windowsHide: true });
    return /node\.exe/i.test(stdout);
  } catch {
    return false;
  }
}

function matarArvore(pid: number): void {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 8000 });
}

/** PIDs do navegador de automação aberto por ESTE processo (para esperar a saída depois de fechar). */
export async function pidsDoMeuNavegador(): Promise<number[]> {
  return (await processosDoPerfil()).filter((e) => e.automacao && e.pai === process.pid).map((e) => e.pid);
}

/**
 * O processo ainda está rodando? Checagem barata (sem PowerShell), boa para perguntar a cada
 * segundo. No Windows, um processo morto com taskkill /F conta como encerrado na hora, mesmo que
 * ainda apareça no tasklist por dezenas de segundos; testado em 15/10: um perfil assim já reabre.
 */
export function processoExiste(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // existe, só não temos permissão
  }
}

/** Fecha à força o navegador da automação aberto por ESTE processo (quando travou). */
export async function matarMeuNavegador(): Promise<void> {
  for (const e of await processosDoPerfil()) if (e.automacao && e.pai === process.pid) matarArvore(e.pid);
}

/**
 * O navegador não abriu porque o perfil está ocupado: identifica quem está com ele. Janela comum
 * (login) nunca é fechada; navegador de automação órfão (o processo que o abriu morreu) é fechado.
 * Devolve true se limpou algo e vale tentar de novo.
 */
export async function liberarPerfil(): Promise<boolean> {
  let limpou = false;
  for (const e of await processosDoPerfil()) {
    if (!e.automacao) {
      throw new Error(`O perfil do mcp-google está aberto numa janela comum do ${rotuloNavegador()} (processo ${e.pid}), provavelmente a de login. Feche essa janela e tente de novo.`);
    }
    if (e.pai === process.pid || !(await processoNode(e.pai))) {
      matarArvore(e.pid); // sobrou de uma tarefa travada ou de um processo do MCP que morreu
      limpou = true;
    } else {
      throw new Error(`O perfil está em uso por outro processo do mcp-google (processo ${e.pai}), talvez uma versão antiga ainda aberta. Reinicie o Claude Desktop e reconecte o Claude Code (/mcp).`);
    }
  }
  if (limpou) await esperar(1500);
  return limpou;
}
