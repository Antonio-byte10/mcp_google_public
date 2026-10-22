import net from "node:net";
import { createHash } from "node:crypto";
import path from "node:path";

// Trava do perfil do navegador entre processos (Claude Code e Claude Desktop rodando o MCP ao
// mesmo tempo). Usa um "named pipe" do Windows: só um processo consegue escutar no mesmo nome, e
// o sistema solta o nome sozinho quando o processo morre (mesmo morto à força) — não sobra trava
// abandonada, não há corrida de arquivo e PID reaproveitado não engana ninguém. Quem espera pode
// perguntar ao dono quem ele é e até quando pretende usar o navegador.

export interface InfoDaPosse {
  pid: number;
  /** Nome do app (claude-code, claude-ai…). */
  app: string;
  desde: number;
  /** Até quando o dono deveria terminar (ms desde 1970). */
  ate: number;
}

export interface Trava {
  soltar(): void;
}

export function nomeDaTrava(pastaPerfil: string): string {
  const hash = createHash("sha1").update(path.resolve(pastaPerfil).toLowerCase()).digest("hex").slice(0, 16);
  return process.platform === "win32" ? `\\\\.\\pipe\\mcp-google-${hash}` : path.join("/tmp", `mcp-google-${hash}.sock`);
}

function tentarTrava(nome: string, info: InfoDaPosse): Promise<net.Server | null> {
  return new Promise((ok, falha) => {
    const servidor = net.createServer((conexao) => conexao.end(JSON.stringify(info)));
    servidor.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? ok(null) : falha(e)));
    servidor.listen(nome, () => {
      servidor.unref(); // a trava nunca segura o processo vivo sozinha
      ok(servidor);
    });
  });
}

/** Pergunta ao dono atual quem ele é (ou undefined se não responder em 1 s). */
export function quemSegura(nome: string): Promise<InfoDaPosse | undefined> {
  return new Promise((ok) => {
    let dados = "";
    const c = net.connect(nome);
    const fim = (v?: InfoDaPosse) => {
      c.destroy();
      ok(v);
    };
    c.setTimeout(1000, () => fim());
    c.on("data", (d) => (dados += d));
    c.on("end", () => {
      try {
        fim(JSON.parse(dados) as InfoDaPosse);
      } catch {
        fim();
      }
    });
    c.on("error", () => fim());
  });
}

const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Mensagem clara para quando o navegador está com outro processo. */
export function descreverDono(dono: InfoDaPosse | undefined): string {
  if (!dono) return "O navegador está em uso por outra janela do Claude (Code ou Desktop). Tente de novo em instantes.";
  const app = dono.app === "claude-code" ? "o Claude Code" : dono.app === "desconhecido" ? "outro processo do mcp-google" : "o Claude Desktop";
  const atrasado = Date.now() > dono.ate + 30000;
  return atrasado
    ? `O navegador está com ${app} (processo ${dono.pid}) desde ${hora(dono.desde)} e já passou do tempo combinado; parece travado. Feche ou reinicie aquele app e tente de novo.`
    : `O navegador está em uso por ${app} (processo ${dono.pid}) desde ${hora(dono.desde)}; deve liberar até ${hora(dono.ate)}. Tente de novo em instantes.`;
}

/**
 * Pega a trava, esperando até `esperaMaxMs`. Se não conseguir, a mensagem diz quem está com o
 * navegador e se ele parece travado.
 */
export async function pegarTrava(nome: string, info: InfoDaPosse, esperaMaxMs: number): Promise<Trava> {
  const limite = Date.now() + esperaMaxMs;
  for (;;) {
    const servidor = await tentarTrava(nome, info);
    if (servidor) {
      let solta = false;
      return {
        soltar() {
          if (solta) return;
          solta = true;
          servidor.close();
        },
      };
    }
    if (Date.now() >= limite) throw new Error(descreverDono(await quemSegura(nome)));
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(50, limite - Date.now()))));
  }
}
