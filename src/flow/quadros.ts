// Quadros de início e fim (imagem para vídeo).
import { type Page } from "playwright";
import { capturaDeErro } from "../arquivos.js";
import { validarImagemLocal } from "../seguranca.js";
import path from "node:path";
import { FLOW as F } from "../seletores.js";
import { UUID } from "./base.js";
import { ehVideo, Rastreador } from "./rastreador.js";
import { fecharFlutuantes } from "./tela.js";

// ---------- Quadros (imagem → vídeo) ----------

export interface FonteQuadro {
  /** Id de uma imagem do projeto (de flow_gerar_imagem ou flow_listar). */
  id?: string;
  /** Caminho completo de um PNG/JPG/WebP do PC. */
  arquivo?: string;
}

export function lerFonteQuadro(valor: string): FonteQuadro {
  const id = valor.match(UUID)?.[0];
  if (id && !/[\\/]/.test(valor)) return { id };
  return { arquivo: validarImagemLocal(valor) };
}

export async function preenchidos(p: Page): Promise<number> {
  return p.getByRole("button", { name: F.quadroPreenchido }).count();
}

/** Abre o seletor de um quadro (Início/Fim) e escolhe uma imagem do projeto ou envia uma do PC. */
export async function escolherQuadro(p: Page, r: Rastreador, projeto: string, qual: "Início" | "Fim", fonte: FonteQuadro): Promise<string> {
  const ov = p.locator(F.overlay);
  const antes = await preenchidos(p);
  await p.getByRole("button", { name: qual, exact: true }).click({ timeout: 10000 });
  await ov.getByRole("heading", { name: F.seletorQuadro }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(1200);
  let descricao: string;

  if (fonte.id) {
    const m = r.doProjeto(projeto).find((x) => x.id === fonte.id);
    if (!m) throw new Error(`A imagem ${fonte.id} não está no projeto. Veja flow_listar.`);
    if (ehVideo(m)) throw new Error(`${fonte.id} é um vídeo; para o quadro use uma imagem.`);
    if (!m.miniatura) throw new Error(`Não consegui identificar a imagem ${fonte.id} na lista do Flow.`);
    const opcoes = ov.getByRole("listbox", { name: F.listaRecursos }).getByRole("option");
    await opcoes.first().waitFor({ timeout: 10000 });
    const indice = await opcoes.evaluateAll(
      (els, token) => els.findIndex((e) => (e.querySelector("img")?.getAttribute("src") ?? "").includes(token as string)),
      m.miniatura,
    );
    if (indice < 0) throw new Error(`A imagem ${fonte.id} não apareceu no seletor de quadros do Flow.`);
    // Clicar na miniatura costuma já colocar no quadro; se abrir só a prévia, confirma no botão.
    await opcoes.nth(indice).locator("img").first().click();
    await p.waitForTimeout(1500);
    const incluir = ov.getByRole("button", { name: F.botaoIncluir });
    if ((await preenchidos(p)) <= antes && (await incluir.isVisible().catch(() => false))) await incluir.click();
    descricao = `imagem do projeto "${m.titulo ?? m.id}"`;
  } else {
    const arquivo = fonte.arquivo!;
    const [seletor] = await Promise.all([
      p.waitForEvent("filechooser", { timeout: 15000 }),
      ov.getByRole("button", { name: F.botaoEnviarMidia }).click(),
    ]);
    await seletor.setFiles(arquivo);
    descricao = `arquivo ${path.basename(arquivo)}`;
    // Depois do envio a imagem aparece em "Envios"; em algumas versões já entra no quadro sozinha.
    const fim = Date.now() + 60000;
    while (Date.now() < fim && (await preenchidos(p)) <= antes) {
      const dialogoAberto = await ov.getByRole("heading", { name: F.seletorQuadro }).isVisible().catch(() => false);
      if (dialogoAberto) {
        const opcoes = ov.getByRole("listbox", { name: F.listaRecursos }).getByRole("option");
        const aba = ov.getByRole("tab", { name: F.abaEnvios });
        if ((await aba.getAttribute("aria-selected").catch(() => "true")) !== "true") await aba.click().catch(() => {});
        if ((await opcoes.count()) && !(await ov.getByText(/Enviando|Carregando|%/).count())) {
          await opcoes.first().click().catch(() => {});
        }
      }
      await p.waitForTimeout(1500);
    }
  }

  const fim = Date.now() + 15000;
  while (Date.now() < fim && (await preenchidos(p)) <= antes) await p.waitForTimeout(500);
  if ((await preenchidos(p)) <= antes) {
    const cap = await capturaDeErro(p, `quadro-${qual}`);
    throw new Error(`A imagem não entrou no quadro "${qual}" do Flow. Nada foi gerado. Captura: ${cap}`);
  }
  await fecharFlutuantes(p);
  return `${qual}: ${descricao}`;
}
