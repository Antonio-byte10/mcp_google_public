// Elementos do comando: personagens, imagens de referência e vozes.
import { type Locator, type Page } from "playwright";
import { capturaDeErro } from "../arquivos.js";
import { type Prazo } from "../prazo.js";
import path from "node:path";
import { FLOW as F } from "../seletores.js";
import { mesmoNome } from "./base.js";
import { ehVideo, Rastreador } from "./rastreador.js";
import { fecharFlutuantes } from "./tela.js";
import { comFlow } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { type FonteQuadro } from "./quadros.js";

const personagensNaCaixa = (p: Page) => p.getByRole("button", { name: F.elementoPersonagem }).count();

/** Abre o seletor de elementos na aba Personagens (opcionalmente já filtrado por um nome). */
async function abrirSeletorPersonagens(p: Page, busca?: string): Promise<Locator> {
  const ov = p.locator(F.overlay);
  await fecharFlutuantes(p);
  await p.getByRole("button", { name: F.adicionarElementos }).first().click({ timeout: 10000 });
  await ov.getByRole("tab", { name: F.abaPersonagens }).click({ timeout: 10000 });
  const opcoes = ov.getByRole("listbox").getByRole("option");
  await opcoes.first().waitFor({ timeout: 5000 }).catch(() => {});
  if (busca) {
    await ov.getByRole("textbox", { name: F.pesquisarRecursos }).fill(busca);
    // Espera a lista filtrar (o nome procurado aparecer), em vez de uma pausa fixa.
    for (let i = 0; i < 12; i++) {
      await p.waitForTimeout(250);
      if ((await titulosDasOpcoes(opcoes)).some((t) => mesmoNome(t, busca))) break;
    }
  }
  return opcoes;
}

function titulosDasOpcoes(opcoes: Locator): Promise<string[]> {
  return opcoes.evaluateAll((els, sel) => els.map((e) => (e.querySelector(sel as string)?.textContent ?? "").trim()), F.tituloRecurso);
}

/** Coloca os personagens (pelo nome exato) como elementos na caixa de comando. */
export async function adicionarPersonagens(p: Page, nomes: string[]): Promise<void> {
  for (const nome of nomes) {
    const antes = await personagensNaCaixa(p);
    const opcoes = await abrirSeletorPersonagens(p, nome);
    const i = (await titulosDasOpcoes(opcoes)).findIndex((t) => mesmoNome(t, nome));
    if (i < 0) {
      await fecharFlutuantes(p);
      throw new Error(`Personagem "${nome}" não encontrado no projeto. Veja os nomes com flow_personagens ou crie com flow_personagem_criar. Nada foi gerado.`);
    }
    await opcoes.nth(i).locator("img").first().click();
    await p.waitForTimeout(500);
    const incluir = p.locator(F.overlay).getByRole("button", { name: F.botaoIncluir });
    if ((await personagensNaCaixa(p)) <= antes && (await incluir.isVisible().catch(() => false))) await incluir.click();
    const fim = Date.now() + 8000;
    while (Date.now() < fim && (await personagensNaCaixa(p)) <= antes) await p.waitForTimeout(400);
    await fecharFlutuantes(p);
    if ((await personagensNaCaixa(p)) <= antes) throw new Error(`O personagem "${nome}" não entrou no comando. Nada foi gerado.`);
  }
}

/** Abre o painel "+" (elementos) do comando já na aba pedida e devolve as opções da lista. */
async function abrirPainelElementos(p: Page, aba: string): Promise<Locator> {
  const ov = p.locator(F.overlay);
  await fecharFlutuantes(p);
  await p.getByRole("button", { name: F.adicionarElementos }).first().click({ timeout: 10000 });
  await ov.getByRole("tab", { name: aba, exact: true }).click({ timeout: 10000 });
  const opcoes = ov.getByRole("listbox", { name: F.listaRecursos }).getByRole("option");
  await opcoes.first().waitFor({ timeout: 8000 }).catch(() => {});
  return opcoes;
}

async function esperarElementoNovo(p: Page, antes: number, o_que: string): Promise<void> {
  const incluir = p.locator(F.overlay).getByRole("button", { name: F.botaoIncluir });
  // Às vezes o clique só abre a prévia do recurso (com "Incluir no comando") e ela demora a
  // aparecer: confere as duas coisas a cada volta (antes, olhava o botão uma vez só e a voz levava
  // ~30 s para entrar, o que estourava o tempo do Claude Desktop).
  const fim = Date.now() + 10000;
  while (Date.now() < fim && (await personagensNaCaixa(p)) <= antes) {
    if (await incluir.isVisible().catch(() => false)) await incluir.click({ timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(300);
  }
  await fecharFlutuantes(p);
  if ((await personagensNaCaixa(p)) <= antes) {
    const cap = await capturaDeErro(p, "elemento");
    throw new Error(`${o_que} não entrou no comando do Flow. Nada foi gerado. Captura: ${cap}`);
  }
}

/**
 * Coloca imagens como referência (elementos) no comando: imagens do projeto pelo id ou arquivos
 * do PC (enviados pelo próprio painel). É assim que o Flow edita/combina imagens e faz
 * "ingredientes para vídeo". Devolve a descrição de cada uma.
 */
export async function adicionarReferencias(p: Page, r: Rastreador, projeto: string, fontes: FonteQuadro[]): Promise<string[]> {
  const usadas: string[] = [];
  for (const fonte of fontes) {
    const antes = await personagensNaCaixa(p);
    if (fonte.id) {
      const m = r.doProjeto(projeto).find((x) => x.id === fonte.id);
      if (!m) throw new Error(`A imagem ${fonte.id} não está no projeto. Veja flow_listar. Nada foi gerado.`);
      if (ehVideo(m)) throw new Error(`${fonte.id} é um vídeo; como referência use uma imagem. Nada foi gerado.`);
      if (!m.miniatura) throw new Error(`Não consegui identificar a imagem ${fonte.id} na lista do Flow. Nada foi gerado.`);
      const opcoes = await abrirPainelElementos(p, F.abaImagens);
      const procurar = () =>
        opcoes.evaluateAll((els, token) => els.findIndex((e) => (e.querySelector("img")?.getAttribute("src") ?? "").includes(token as string)), m.miniatura);
      let indice = await procurar();
      // A lista só mostra as mais recentes: busca pelo título e, se precisar, rola até achar.
      if (indice < 0 && m.titulo) {
        await p.locator(F.overlay).getByRole("textbox", { name: F.pesquisarRecursos }).fill(m.titulo);
        for (let i = 0; i < 12 && indice < 0; i++) {
          await p.waitForTimeout(300);
          indice = await procurar();
        }
      }
      for (let i = 0; i < 20 && indice < 0 && (await opcoes.count()); i++) {
        await opcoes.last().scrollIntoViewIfNeeded().catch(() => {});
        await p.waitForTimeout(400);
        indice = await procurar();
      }
      if (indice < 0) {
        await fecharFlutuantes(p);
        throw new Error(`A imagem ${fonte.id} não aparece entre as imagens do Flow. Se for o retrato de um personagem, use personagens: ["Nome"] em vez de referência. Nada foi gerado.`);
      }
      await opcoes.nth(indice).locator("img").first().click();
      await esperarElementoNovo(p, antes, `A imagem ${fonte.id}`);
      usadas.push(`imagem do projeto "${m.titulo ?? m.id}"`);
    } else if (fonte.arquivo) {
      const ov = p.locator(F.overlay);
      await abrirPainelElementos(p, F.abaEnvios);
      const opcoes = ov.getByRole("listbox", { name: F.listaRecursos }).getByRole("option");
      const enviosAntes = await opcoes.count();
      const [seletor] = await Promise.all([
        p.waitForEvent("filechooser", { timeout: 15000 }),
        ov.getByRole("button", { name: F.botaoEnviarMidia }).click(),
      ]);
      await seletor.setFiles(fonte.arquivo);
      // O envio pode já colocar a imagem no comando; senão ela aparece em "Envios" para clicar.
      const fim = Date.now() + 60000;
      while (Date.now() < fim && (await personagensNaCaixa(p)) <= antes) {
        const painelAberto = await ov.getByRole("listbox", { name: F.listaRecursos }).isVisible().catch(() => false);
        if (painelAberto && (await opcoes.count()) > enviosAntes && !(await ov.getByText(/Enviando|Carregando|%/).count())) {
          await opcoes.first().locator("img").first().click().catch(() => {});
          await p.waitForTimeout(800);
          const incluir = ov.getByRole("button", { name: F.botaoIncluir });
          if ((await personagensNaCaixa(p)) <= antes && (await incluir.isVisible().catch(() => false))) await incluir.click().catch(() => {});
        }
        await p.waitForTimeout(1200);
      }
      await esperarElementoNovo(p, antes, `O arquivo ${path.basename(fonte.arquivo)}`);
      usadas.push(`arquivo ${path.basename(fonte.arquivo)}`);
    }
  }
  return usadas;
}

/** Vozes disponíveis no Flow (nome + descrição em inglês, ex.: "Fenrir Male, excitable, younger pitch"). */
async function vozesDisponiveis(p: Page): Promise<{ nome: string; descricao: string }[]> {
  const opcoes = await abrirPainelElementos(p, F.abaVozes);
  const textos = await textosDasVozes(p, opcoes);
  await fecharFlutuantes(p);
  return textos.map((t) => {
    const [nome, ...resto] = t.split(" ");
    return { nome, descricao: resto.join(" ") };
  });
}

/**
 * Textos das vozes ("Fenrir Male, excitable, younger pitch"), rolando a lista até carregar todas
 * (ela carrega aos poucos) e sem o nome do ícone que vem junto no texto ("voice_selection").
 */
async function textosDasVozes(p: Page, opcoes: Locator): Promise<string[]> {
  const ler = async () =>
    (await opcoes.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim().split(" ").filter((w) => !/^[a-z]+(_[a-z]+)+$/.test(w)).join(" "));
  // A lista é virtualizada: ao rolar, as primeiras saem da página. Acumula na ordem em que aparecem.
  const vistas: string[] = [];
  const juntar = (lista: string[]) => {
    for (const t of lista) if (t && !vistas.includes(t)) vistas.push(t);
  };
  juntar(await ler());
  for (let i = 0; i < 20; i++) {
    const antes = vistas.length;
    await opcoes.last().scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(500);
    juntar(await ler());
    if (vistas.length === antes) break;
  }
  return vistas;
}

/** Coloca uma voz do Flow como elemento do comando (narração/falas), com estilo de performance opcional. */
export async function adicionarVoz(p: Page, nome: string): Promise<string> {
  const antes = await personagensNaCaixa(p);
  const opcoes = await abrirPainelElementos(p, F.abaVozes);
  // Filtra pela busca do painel (a lista é virtualizada: a posição muda ao rolar).
  await p.locator(F.overlay).getByRole("textbox", { name: F.pesquisarRecursos }).fill(nome.trim());
  const ehAVoz = (t: string) => t.split(" ").filter((w) => !/^[a-z]+(_[a-z]+)+$/.test(w))[0]?.toLowerCase() === nome.trim().toLowerCase();
  let indice = -1;
  let textos: string[] = [];
  for (let i = 0; i < 12 && indice < 0; i++) {
    await p.waitForTimeout(300);
    textos = (await opcoes.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    indice = textos.findIndex(ehAVoz);
  }
  if (indice < 0) {
    await fecharFlutuantes(p);
    throw new Error(`Voz "${nome}" não existe no Flow (veja flow_vozes). Nada foi gerado.`);
  }
  // Clicar na voz já a coloca no comando (e fecha o painel). O estilo não vai pelo painel: lá ele
  // obriga a salvar uma "voz personalizada" no projeto; vai escrito no prompt (ver gerarVideo).
  await opcoes.nth(indice).click();
  await esperarElementoNovo(p, antes, `A voz ${nome}`);
  return `voz ${textos[indice].split(" ").filter((w) => !/^[a-z]+(_[a-z]+)+$/.test(w)).join(" ")}`;
}

export async function conferirPersonagens(p: Page, quantos: number, etapa: string): Promise<void> {
  if (quantos && (await personagensNaCaixa(p)) < quantos) {
    throw new Error(`Os personagens saíram do comando ${etapa}. Nada foi gerado.`);
  }
}

/** Vozes do Flow (para o parâmetro voz dos vídeos e personagens). */
export function listarVozes(prazo: Prazo, projeto?: string): Promise<{ nome: string; descricao: string }[]> {
  return comFlow(prazo, async (p, r) => {
    await abrirProjeto(p, r, projeto);
    return vozesDisponiveis(p);
  });
}
