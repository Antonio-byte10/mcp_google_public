import type { Page, Response } from "playwright";
import { irPara } from "./navegador.js";
import { esperaAte, type Progresso } from "./notebook-base.js";
import { DRIVE as D } from "./seletores.js";
import type { Prazo } from "./prazo.js";

// Leva um .pptx para o Google Apresentações pela tela do Drive (o NotebookLM não exporta slides):
// envia o arquivo ao Meu Drive, abre no Apresentações, "Salvar como apresentação Google" e manda o
// .pptx enviado para a lixeira. Mapeado em 07/10/2026.

const MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Envia o .pptx ao Meu Drive e devolve o id do arquivo no Drive. */
export async function enviarPptxAoDrive(p: Page, nome: string, dados: Buffer, prazo: Prazo, progresso: Progresso = () => {}): Promise<string> {
  progresso("Abrindo o Google Drive...");
  await irPara(p, D.url);
  const novo = p.getByRole("button", { name: D.botaoNovo }).first();
  await novo.waitFor({ timeout: esperaAte(prazo, 30000) });
  let entregar!: (id: string) => void;
  const enviado = new Promise<string>((ok) => (entregar = ok));
  const ouvir = async (r: Response) => {
    if (!D.respostaUpload.test(r.url())) return;
    const id = D.idNaResposta.exec(await r.text().catch(() => ""))?.[1];
    if (id) entregar(id);
  };
  p.on("response", ouvir);
  try {
    await novo.click();
    const escolha = p.waitForEvent("filechooser", { timeout: 10000 });
    await p.getByRole("menuitem", { name: D.menuUpload }).click();
    await (await escolha).setFiles({ name: nome, mimeType: MIME_PPTX, buffer: dados });
    progresso(`Enviando "${nome}" ao Drive (${Math.round(dados.length / 1048576)} MB)...`);
    let espera: ReturnType<typeof setTimeout> | undefined;
    return await Promise.race([
      enviado,
      new Promise<never>((_, falha) => {
        espera = setTimeout(() => falha(new Error("O envio ao Google Drive não terminou a tempo.")), esperaAte(prazo, 240000));
      }),
    ]).finally(() => clearTimeout(espera));
  } finally {
    p.off("response", ouvir);
  }
}

/** Fecha o aviso "Esta é a edição de arquivos do Office", que aparece com atraso e tapa o menu. */
async function fecharAvisoOffice(p: Page): Promise<void> {
  const entendi = p.getByRole("button", { name: D.avisoEntendi, exact: true });
  for (let i = 0; i < 3; i++) {
    if (await entendi.isVisible().catch(() => false)) await entendi.click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(700);
  }
}

async function itemDoMenuArquivo(p: Page, nome: RegExp): Promise<void> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await fecharAvisoOffice(p);
    await p.locator(D.menuArquivo).click();
    const item = p.locator(D.itemMenu).filter({ hasText: nome }).first();
    if (await item.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      await item.click();
      return;
    }
    await p.keyboard.press("Escape");
  }
  throw new Error(`Não achei "${nome.source}" no menu Arquivo do Apresentações (a tela pode ter mudado).`);
}

export interface Conversao {
  link: string;
  /** O .pptx enviado foi para a lixeira do Drive (fica lá 30 dias). */
  pptxNaLixeira: boolean;
}

/** Converte o .pptx (já no Drive) em Apresentações Google e manda o .pptx para a lixeira. */
export async function converterEmApresentacao(p: Page, idPptx: string, prazo: Prazo, progresso: Progresso = () => {}): Promise<Conversao> {
  progresso("Abrindo o arquivo no Google Apresentações...");
  await irPara(p, D.urlApresentacao(idPptx));
  await p.locator(D.menuArquivo).waitFor({ timeout: esperaAte(prazo, 40000) });
  const novaAba = p.context().waitForEvent("page", { timeout: esperaAte(prazo, 30000) });
  progresso("Salvando como apresentação Google...");
  await itemDoMenuArquivo(p, D.salvarComoGoogle);
  const aba = await novaAba;
  let id: string | undefined;
  for (let i = 0; i < 40 && !id; i++) {
    const achado = D.idApresentacao.exec(aba.url())?.[1];
    if (achado && achado !== idPptx) id = achado;
    else await p.waitForTimeout(500);
  }
  await aba.close().catch(() => {});
  if (!id) throw new Error("O Apresentações não abriu a cópia convertida. Confira no Drive (Meu Drive) antes de tentar de novo.");
  // O .pptx enviado só serviu para a conversão: vai para a lixeira (recuperável por 30 dias).
  let pptxNaLixeira = false;
  if (prazo.sobra(8000)) {
    try {
      await itemDoMenuArquivo(p, D.moverParaLixeira);
      pptxNaLixeira = await p.getByText(D.confirmacaoLixeira).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    } catch {
      // fica no Drive; a resposta avisa
    }
  }
  return { link: D.urlApresentacao(id), pptxNaLixeira };
}
