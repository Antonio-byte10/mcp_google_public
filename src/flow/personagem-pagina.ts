// Página de edição do personagem: nome, personalidade, voz, retrato, corpo e imagens.
import { type Locator, type Page } from "playwright";
import { comPrevia, dimensoesImagem, nomeArquivo, salvarFlow, type Arquivo } from "../arquivos.js";
import { conferirPagina, irPara } from "../navegador.js";
import { baixarComRedirecionamentoSeguro, saltoDoContexto } from "../download-seguro.js";
import { extensaoDaImagem, linkDeImagemDoFlowPermitido, linkDeMidiaPermitido } from "../seguranca.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F } from "../seletores.js";
import { normalizar, mesmoNome } from "./base.js";
import { fecharFlutuantes, digitarPrompt } from "./tela.js";

/**
 * Nomes dos personagens, lidos dos cartões do filtro "Personagens" do projeto. É a fonte
 * mais confiável: a aba Personagens do seletor de elementos pode demorar a tirar excluídos.
 */
export async function nomesDosPersonagens(p: Page): Promise<string[]> {
  await p.getByText(F.filtroPersonagens, { exact: true }).first().click({ timeout: 10000 });
  await p.getByRole("img", { name: F.miniaturaPersonagem }).first().waitFor({ timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(800);
  // Sem nenhum personagem, o Flow abre direto a tela de "Novo personagem".
  if (F.urlPersonagem.test(p.url()) || p.url().endsWith("/character")) return [];
  return (await p.locator(F.tile).allInnerTexts()).map((t) => t.split("\n")[0].trim()).filter(Boolean);
}

const LINK_PERSONAGEM = /\/project\/([0-9a-f-]{36})\/character\/([0-9a-f-]{36})/;
export const projetoDoLink = (nomeOuLink: string) => nomeOuLink.match(LINK_PERSONAGEM)?.[1];

/** Página do personagem a partir do link dela (ou só do id), para nomes repetidos como "Personagem sem nome". */
function linkDoPersonagem(nomeOuLink: string, projeto: string): string | undefined {
  const s = nomeOuLink.trim();
  const m = s.match(LINK_PERSONAGEM);
  if (m) return `${F.urlNovoPersonagem(m[1])}/${m[2]}`;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(s)) return `${F.urlNovoPersonagem(projeto)}/${s}`;
  return undefined;
}

/**
 * Abre a página do personagem: pelo link/id ou pelo cartão com o nome no filtro "Personagens" do
 * projeto. Devolve o id do personagem.
 */
export async function abrirPersonagem(p: Page, nome: string, projeto: string): Promise<string> {
  const link = linkDoPersonagem(nome, projeto);
  if (link) await irPara(p, link);
  else {
    const textos = await nomesDosPersonagens(p);
    const cartoes = p.locator(F.tile);
    const i = textos.findIndex((t) => mesmoNome(t, nome));
    if (i < 0) throw new Error(`Personagem "${nome}" não encontrado no projeto. Veja os nomes com flow_personagens.`);
    await cartoes.nth(i).click();
  }
  await p.waitForURL(F.urlPersonagem, { timeout: 15000 });
  conferirPagina(p);
  await p.getByRole("button", { name: F.personagemConcluir }).waitFor({ timeout: 20000 });
  await p.waitForTimeout(1200);
  return p.url().match(F.urlPersonagem)![1];
}

export async function definirNomePersonagem(p: Page, nome: string): Promise<void> {
  const campo = p.getByRole("textbox", { name: F.personagemNome });
  await p.getByRole("button", { name: F.personagemEditarNome }).click({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(400);
  await campo.fill(nome, { timeout: 8000 });
  await campo.press("Enter", { timeout: 5000 });
  await p.waitForTimeout(1200);
  if (!mesmoNome(await campo.inputValue({ timeout: 5000 }), nome)) throw new Error(`O Flow não aceitou o nome "${nome}".`);
}

/** Nome que está agora no campo da página do personagem ("" se não der para ler). */
export const nomeNaPagina = (p: Page) => p.getByRole("textbox", { name: F.personagemNome }).inputValue({ timeout: 3000 }).then((v) => normalizar(v), () => "");

export async function definirPersonalidade(p: Page, texto: string): Promise<void> {
  const campo = p.getByRole("textbox", { name: F.personagemPersonalidade });
  await campo.fill(texto);
  await campo.press("Tab");
  await p.waitForTimeout(1000);
}

/** Escolhe a voz (clicar numa voz da lista já a atribui ao personagem). */
export async function definirVoz(p: Page, voz: string): Promise<void> {
  const ov = p.locator(F.overlay);
  const selecionar = p.getByRole("button", { name: F.personagemVoz });
  if (!(await selecionar.isVisible().catch(() => false))) {
    // Já tem voz: remove para trocar.
    await p.getByRole("button", { name: F.personagemRemoverVoz, exact: true }).first().click({ timeout: 5000 });
    await selecionar.waitFor({ timeout: 8000 });
  }
  await selecionar.click();
  await ov.getByRole("heading", { name: F.personagemVozDialogo }).waitFor({ timeout: 10000 });
  await ov.getByRole("textbox", { name: F.pesquisarRecursos }).fill(voz);
  await p.waitForTimeout(1500);
  const opcoes = ov.getByRole("listbox").getByRole("option");
  const nomes = (await opcoes.allInnerTexts()).map((t) => t.replace(/voice_selection/g, "").trim().split("\n")[0].trim());
  const i = nomes.findIndex((n) => mesmoNome(n, voz));
  if (i < 0) {
    await fecharFlutuantes(p);
    throw new Error(`Voz "${voz}" não encontrada no Flow. Exemplos: Fenrir (masculina, animada), Puck, Charon, Kore, Aoede, Achernar (feminina, suave).`);
  }
  await opcoes.nth(i).click();
  await p.waitForTimeout(1500);
  // Desde 08/10/2026 o diálogo pode pedir a confirmação "Adicionar ao personagem".
  const adicionar = ov.getByRole("button", { name: F.personagemAdicionarVoz });
  if (await adicionar.isVisible().catch(() => false)) {
    await adicionar.click({ timeout: 5000 });
    await p.waitForTimeout(1200);
  }
  await fecharFlutuantes(p);
  if (await selecionar.isVisible().catch(() => false)) throw new Error(`A voz "${voz}" não ficou no personagem.`);
}

/** Imagem que o Flow mostra na página do personagem (endereço salvo ou o do servidor de mídia). */
const imagemDoFlow = (url: string) => linkDeImagemDoFlowPermitido(url) || linkDeMidiaPermitido(url);

export const abaAtiva = (aba: Locator) => aba.evaluate((e, classe) => e.classList.contains(classe), F.personagemAbaAtiva).catch(() => false);

const imagemPrincipal = (p: Page) => p.getByRole("img", { name: F.personagemImagem }).first().getAttribute("src", { timeout: 1000 }).catch(() => null);

/** Abre a aba Corpo e confere que ficou aberta (sem isso, a caixa de mudança mexeria no retrato). */
async function abrirAbaCorpo(p: Page): Promise<void> {
  const aba = p.getByRole("button", { name: F.personagemCorpo, exact: true });
  if (!(await abaAtiva(aba))) {
    const anterior = await imagemPrincipal(p);
    await aba.click({ timeout: 8000 });
    for (let i = 0; i < 15 && (await imagemPrincipal(p)) === anterior; i++) await p.waitForTimeout(300);
  }
  await p.waitForTimeout(600);
  if (!(await abaAtiva(aba))) throw new Error("A aba Corpo do personagem não abriu; o corpo não foi refeito.");
  const mostrar = p.getByRole("button", { name: F.historicoMostrar, exact: true });
  if (await mostrar.isVisible().catch(() => false)) await mostrar.click().catch(() => {});
}

/** Na aba Corpo aberta, escolhe a versão mais nova do histórico; true se ela virou a imagem do corpo. */
async function escolherCorpoMaisNovo(p: Page): Promise<boolean> {
  const versoes = p.locator(F.historicoImagem);
  const n = await versoes.count();
  const nova = versoes.nth(n - 1);
  const link = await nova.getAttribute("src", { timeout: 2000 });
  // Logo depois de gerar, a página já mostra a versão nova, mas sem salvá-la, e clicar nela não conta
  // como troca. Passando antes por outra versão, a troca acontece e fica salva (testado em 08/10/2026).
  if (n > 1) {
    await versoes.nth(n - 2).click({ timeout: 5000 });
    await p.waitForTimeout(1000);
  }
  await nova.click({ timeout: 5000 });
  for (let i = 0; i < 10 && (await imagemPrincipal(p)) !== link; i++) await p.waitForTimeout(300);
  return (await imagemPrincipal(p)) === link;
}

/**
 * Imagem de corpo inteiro (Nano Banana, ~25 s). Sem corpo ainda: botão "Criar corpo". Com corpo: o
 * Flow não mostra mais "Criar corpo"; abre a aba Corpo e pede a nova versão na caixa "O que você quer
 * mudar?". A versão nova entra no fim do histórico, mas só vira o corpo quando é escolhida nele.
 * Devolve false se não ficou pronto a tempo.
 */
export async function criarCorpo(p: Page, descricao: string, esperaMs: number): Promise<"criado" | "refeito" | false> {
  const criar = p.getByRole("button", { name: F.personagemCriarCorpo });
  const aba = p.getByRole("button", { name: F.personagemCorpo, exact: true });
  if (await criar.isVisible().catch(() => false)) {
    await criar.click({ timeout: 8000 });
    await p.waitForTimeout(1200);
    await digitarPrompt(p, normalizar(descricao), F.caixaPrompt, true);
    await p.getByRole("button", { name: F.botaoGerar }).click();
    return aba.waitFor({ timeout: esperaMs }).then(() => "criado" as const, () => false as const);
  }
  if (!(await aba.isVisible().catch(() => false))) {
    throw new Error(`Não achei "${F.personagemCriarCorpo}" nem a aba "${F.personagemCorpo}" na página do personagem. A tela pode ter mudado (rode diagnostico com completo=true).`);
  }
  await abrirAbaCorpo(p);
  const versoes = p.locator(F.historicoImagem);
  const antes = await versoes.count();
  await digitarPrompt(p, `Refaça esta imagem de corpo inteiro do mesmo personagem, com o mesmo rosto e o mesmo estilo: ${normalizar(descricao)}`, F.caixaPrompt, true);
  await p.getByRole("button", { name: F.botaoGerar }).click();
  const fim = Date.now() + esperaMs;
  while (Date.now() < fim) {
    await p.waitForTimeout(1000);
    if ((await versoes.count()) <= antes) continue;
    const link = await versoes.last().getAttribute("src", { timeout: 1000 }).catch(() => null);
    if (!link || !imagemDoFlow(link)) continue;
    if (await escolherCorpoMaisNovo(p)) return "refeito";
    throw new Error("A nova versão do corpo foi gerada, mas não consegui escolhê-la: ela está no histórico da aba Corpo na página do personagem (clique nela e em Concluir).");
  }
  return false;
}

/** Clica em Concluir e espera o Flow sair da página do personagem (antes de fechar o navegador). */
export async function concluirPersonagem(p: Page): Promise<void> {
  await p.getByRole("button", { name: F.personagemConcluir }).click({ timeout: 5000 }).catch(() => {});
  await p.waitForURL((u) => !F.urlPersonagem.test(u.toString()), { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1000);
}

export const textoDoCorpo = (r: "criado" | "refeito") => (r === "criado" ? "corpo inteiro" : "corpo inteiro refeito (a versão anterior continua no histórico da aba Corpo)");
export const CORPO_DEMOROU = "corpo (o Flow ainda estava gerando; se era para refazer, a versão nova aparece no histórico da aba Corpo e precisa ser escolhida com um clique na página do personagem)";

/**
 * Imagens do personagem para o chat: para cada aba (Retrato e, se existir, Corpo), baixa a imagem
 * que a página mostra, em tamanho cheio. O endereço é flow.google.com/asb/... ou, logo depois de
 * gerar, o servidor de mídia (flow-content.google/image/...).
 */
export async function imagensDoPersonagem(p: Page, nome: string, prazo: Prazo): Promise<Arquivo[]> {
  const arquivos: Arquivo[] = [];
  const img = p.getByRole("img", { name: F.personagemImagem }).first();
  for (const [aba, rotulo] of [[F.personagemRetrato, "retrato"], [F.personagemCorpo, "corpo"]] as const) {
    if (!prazo.sobra(8000)) break;
    const botao = p.getByRole("button", { name: aba, exact: true });
    if (!(await botao.isVisible().catch(() => false))) continue;
    try {
      const lerSrc = () => img.getAttribute("src", { timeout: 1000 }).catch(() => null);
      const antes = await lerSrc();
      await botao.click();
      await p.waitForTimeout(600);
      // Espera a imagem da aba carregar (no corpo: trocar a do retrato).
      let src = await lerSrc();
      for (let i = 0; i < 16 && (!src || !imagemDoFlow(src) || (rotulo === "corpo" && src === antes)); i++) {
        await p.waitForTimeout(400);
        src = await lerSrc();
      }
      if (!src || !imagemDoFlow(src)) {
        // Só a origem (sem o resto do endereço), para saber no log o que o Flow passou a usar.
        console.error(`[mcp-google] personagem: imagem do ${rotulo} com endereço não reconhecido (${src ? src.slice(0, src.startsWith("http") ? src.indexOf("/", 8) + 5 : 5) : "sem src"})`);
        continue;
      }
      const dados = await baixarComRedirecionamentoSeguro(saltoDoContexto(p.context()), src, imagemDoFlow, { rotulo: "do Flow", timeoutMs: 30000 }).catch(() => null);
      if (!dados) continue;
      const ext = extensaoDaImagem(dados);
      if (!ext) continue;
      const caminho = salvarFlow(nomeArquivo(`${nome} ${rotulo}`, ext), dados);
      const arq: Arquivo = { caminho, id: rotulo, tipo: "imagem", via: `${rotulo} do personagem`, tamanhoMB: Math.round((dados.length / 1048576) * 100) / 100, ...dimensoesImagem(dados) };
      arquivos.push(await comPrevia(p, arq, prazo));
    } catch {
      // sem essa imagem no chat; o personagem continua no Flow
    }
  }
  return arquivos;
}
