// Projetos do Flow: listar, criar, abrir e definir o padrão.
import { type Page } from "playwright";
import { conferirPagina, irPara } from "../navegador.js";
import { lerConfig, salvarConfig } from "../config.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F } from "../seletores.js";
import { UUID, ehUuid, normalizar } from "./base.js";
import { Rastreador } from "./rastreador.js";
import { comFlow } from "./sessao.js";

async function renomearProjeto(p: Page, titulo: string): Promise<void> {
  const campo = p.getByRole("textbox", { name: F.tituloProjeto });
  await campo.fill(titulo);
  await campo.press("Enter");
  await p.waitForTimeout(1000);
}

function idDeProjeto(projeto?: string): string | undefined {
  return projeto?.match(UUID)?.[0];
}

export interface ProjetoFlow {
  id: string;
  titulo: string;
  link: string;
  criadoEm?: string;
}

/** Lê os projetos da conta na página inicial do Flow (resposta UpteDb; a tela é o plano B). */
async function lerProjetos(p: Page): Promise<ProjetoFlow[]> {
  const resposta = p.waitForResponse((r) => F.rpcProjetos.test(r.url()), { timeout: 20000 }).catch(() => null);
  await irPara(p, F.url);
  const lista = new Map<string, ProjetoFlow>();
  const r = await resposta;
  const corpo = r ? await r.text().catch(() => "") : "";
  // Projeto: [id, [título, null, [criado em segundos, nanos], miniatura, ...]]
  const procurar = (no: unknown): void => {
    if (!Array.isArray(no)) return;
    if (ehUuid(no[0]) && Array.isArray(no[1]) && typeof no[1][0] === "string" && Array.isArray(no[1][2]) && typeof no[1][2][0] === "number") {
      lista.set(no[0], { id: no[0], titulo: no[1][0], link: F.urlProjeto(no[0]), criadoEm: new Date(no[1][2][0] * 1000).toISOString() });
      return;
    }
    no.forEach(procurar);
  };
  for (const linha of corpo.split("\n")) {
    if (!linha.startsWith("[[")) continue;
    try {
      for (const e of JSON.parse(linha) as unknown[][]) if (e[0] === "wrb.fr" && typeof e[2] === "string") procurar(JSON.parse(e[2]));
    } catch {
      // formato inesperado: fica com o que der
    }
  }
  if (!lista.size) {
    // Plano B: os links "Abrir projeto" da tela (sem data; o título é o texto do cartão).
    await p.locator(F.linkProjeto).first().waitFor({ timeout: 15000 }).catch(() => {});
    for (const link of await p.locator(F.linkProjeto).all()) {
      const id = (await link.getAttribute("href"))?.match(UUID)?.[0];
      const titulo = normalizar((await link.locator("xpath=..").innerText().catch(() => "")).split("\n")[0] ?? "");
      if (id && !lista.has(id)) lista.set(id, { id, titulo, link: F.urlProjeto(id) });
    }
  }
  return [...lista.values()];
}

/** Acha o projeto pelo nome (sem diferença de maiúsculas e acentos). */
function acharProjetoPorNome(projetos: ProjetoFlow[], nome: string): ProjetoFlow {
  const simples = (t: string) => normalizar(t).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const achados = projetos.filter((x) => simples(x.titulo) === simples(nome));
  if (achados.length === 1) return achados[0];
  if (achados.length > 1) {
    throw new Error(`Há ${achados.length} projetos chamados "${nome}": ${achados.map((x) => x.link).join(", ")}. Use o link ou o id.`);
  }
  const nomes = projetos.map((x) => x.titulo).filter(Boolean).slice(0, 15);
  throw new Error(`Não existe projeto do Flow chamado "${nome}". Projetos: ${nomes.join(" · ") || "(nenhum)"}. Para criar, use flow_projeto_criar.`);
}

/** Cria um projeto novo na página inicial e dá o nome. */
async function novoProjeto(p: Page, r: Rastreador, titulo: string): Promise<string> {
  await irPara(p, F.url);
  await p.getByRole("button", { name: F.botaoNovoProjeto }).click({ timeout: 30000 });
  await p.waitForURL(new RegExp(`/project/${UUID.source}`, "i"), { timeout: 30000 });
  const novo = p.url().match(UUID)![0];
  r.projetoAtual = novo;
  await p.locator(F.caixaPrompt).first().waitFor({ timeout: 30000 });
  await renomearProjeto(p, titulo);
  return novo;
}

/**
 * Abre o projeto pedido (id, link ou nome), o padrão salvo em config.json, ou cria um projeto
 * "Claude MCP" quando não há padrão.
 */
export async function abrirProjeto(p: Page, r: Rastreador, projeto?: string): Promise<string> {
  let pedido = idDeProjeto(projeto);
  if (projeto?.trim() && !pedido) pedido = acharProjetoPorNome(await lerProjetos(p), projeto).id;
  const id = pedido ?? lerConfig().flowProjeto;
  if (id) {
    r.projetoAtual = id;
    const listas = r.listasRecebidas;
    await irPara(p, F.urlProjeto(id));
    const abriu = await p
      .locator(F.caixaPrompt)
      .first()
      .waitFor({ timeout: 30000 })
      .then(() => p.url().includes(id), () => false);
    conferirPagina(p);
    if (abriu) {
      // Sem a lista do projeto não dá para separar mídias novas das antigas: recarrega uma vez.
      if (!(await r.esperarLista(listas))) {
        const outra = r.listasRecebidas;
        await p.reload({ waitUntil: "domcontentloaded" });
        conferirPagina(p);
        if (!(await r.esperarLista(outra, 20000))) throw new Error("A lista de mídias do projeto não carregou no Flow (página lenta?). Nada foi feito; tente de novo.");
      }
      return id;
    }
    if (pedido) throw new Error(`Não consegui abrir o projeto ${pedido} no Flow.`);
    // O endereço continua sendo o do projeto: ele existe, só demorou. Não cria outro por isso.
    if (p.url().includes(id)) throw new Error("O projeto padrão do Flow demorou demais para abrir. Nada foi feito; tente de novo.");
  }
  const novo = await novoProjeto(p, r, "Claude MCP");
  salvarConfig({ ...lerConfig(), flowProjeto: novo });
  return novo;
}

export function listarProjetos(prazo: Prazo): Promise<{ projetos: ProjetoFlow[]; padrao?: string }> {
  return comFlow(prazo, async (p) => ({ projetos: await lerProjetos(p), padrao: lerConfig().flowProjeto }));
}

/** Cria um projeto com nome único (o nome serve para escolher o projeto depois). */
export function criarProjeto(prazo: Prazo, nome: string, padrao: boolean): Promise<ProjetoFlow & { padrao: boolean }> {
  const titulo = normalizar(nome);
  if (!titulo) return Promise.reject(new Error("Dê um nome ao projeto."));
  return comFlow(prazo, async (p, r) => {
    const repetido = (await lerProjetos(p)).find((x) => normalizar(x.titulo).toLowerCase() === titulo.toLowerCase());
    if (repetido) throw new Error(`Já existe um projeto chamado "${repetido.titulo}" (${repetido.link}). Use esse ou escolha outro nome.`);
    const id = await novoProjeto(p, r, titulo);
    const lido = normalizar(await p.getByRole("textbox", { name: F.tituloProjeto }).inputValue().catch(() => ""));
    if (lido && lido !== titulo) throw new Error(`O projeto foi criado (${F.urlProjeto(id)}), mas o nome ficou "${lido}". Renomeie no Flow.`);
    if (padrao) salvarConfig({ ...lerConfig(), flowProjeto: id });
    return { id, titulo, link: F.urlProjeto(id), padrao };
  });
}

/** Muda o projeto padrão (usado quando a ferramenta não recebe 'projeto'). */
export function definirProjetoPadrao(prazo: Prazo, projeto: string): Promise<ProjetoFlow> {
  return comFlow(prazo, async (p) => {
    const projetos = await lerProjetos(p);
    const id = idDeProjeto(projeto);
    const alvo = id ? projetos.find((x) => x.id === id) ?? { id, titulo: "", link: F.urlProjeto(id) } : acharProjetoPorNome(projetos, projeto);
    if (id && !projetos.some((x) => x.id === id)) {
      // Não está na lista (pode ser antigo demais para a página inicial): confere abrindo.
      await irPara(p, F.urlProjeto(id));
      const abriu = await p.locator(F.caixaPrompt).first().waitFor({ timeout: 30000 }).then(() => p.url().includes(id), () => false);
      if (!abriu) throw new Error(`Não consegui abrir o projeto ${id}. O padrão não mudou.`);
    }
    salvarConfig({ ...lerConfig(), flowProjeto: alvo.id });
    return alvo;
  });
}
