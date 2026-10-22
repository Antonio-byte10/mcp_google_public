// Ferramentas de personagem: criar, editar, listar e excluir.
import { registrar, type Arquivo } from "../arquivos.js";
import { conferirPagina, irPara } from "../navegador.js";
import { mensagemDeErro } from "../seguranca.js";
import { type Prazo } from "../prazo.js";
import path from "node:path";
import { FLOW as F } from "../seletores.js";
import { type Progresso, normalizar, mesmoNome } from "./base.js";
import { ehVideo } from "./rastreador.js";
import { digitarPrompt } from "./tela.js";
import { comFlow } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { type FonteQuadro, lerFonteQuadro } from "./quadros.js";
import { nomesDosPersonagens, projetoDoLink, abrirPersonagem, definirNomePersonagem, nomeNaPagina, definirPersonalidade, definirVoz, criarCorpo, concluirPersonagem, textoDoCorpo, CORPO_DEMOROU, imagensDoPersonagem } from "./personagem-pagina.js";

// ---------- Personagens (criar, listar, editar, excluir) ----------

export interface PedidoPersonagem {
  nome: string;
  /** Aparência (gera o retrato com Nano Banana). */
  descricao?: string;
  /** Id de imagem do projeto ou caminho de PNG/JPG/WebP do PC: vira o retrato. */
  imagem?: string;
  personalidade?: string;
  /** Nome de uma voz do Flow (ex.: Fenrir, Kore, Puck, Charon, Aoede). */
  voz?: string;
  /** Corpo e roupa (gera uma segunda imagem, de corpo inteiro). */
  corpo?: string;
  projeto?: string;
}

export interface ResultadoPersonagem {
  nome: string;
  pagina: string;
  projeto: string;
  feito: string[];
  pendente: string[];
  arquivos: Arquivo[];
  /** Algo deu errado depois de o personagem existir (ex.: ficou com outro nome). */
  aviso?: string;
}

export function criarPersonagem(pedido: PedidoPersonagem, prazo: Prazo, progresso: Progresso = () => {}): Promise<ResultadoPersonagem> {
  const nome = normalizar(pedido.nome);
  if (!nome) return Promise.reject(new Error("Informe o nome do personagem."));
  if (!pedido.imagem && !pedido.descricao) return Promise.reject(new Error("Informe a aparência (descricao) ou uma imagem para o personagem."));
  let fonte: FonteQuadro | undefined;
  try {
    fonte = pedido.imagem ? lerFonteQuadro(pedido.imagem) : undefined;
  } catch (erro) {
    return Promise.reject(erro);
  }
  return comFlow(prazo, async (p, r) => {
    const feito: string[] = [];
    const pendente: string[] = [];
    progresso("Abrindo o projeto no Flow...");
    const projeto = await abrirProjeto(p, r, pedido.projeto);

    // Nome único: é por ele que o personagem é escolhido nas gerações.
    const jaExiste = (await nomesDosPersonagens(p)).some((t) => mesmoNome(t, nome));
    if (jaExiste) throw new Error(`Já existe um personagem chamado "${nome}". Use outro nome ou flow_personagem_editar.`);

    progresso("Criando o personagem...");
    let pagina = "";
    try {
      await irPara(p, F.urlNovoPersonagem(projeto));
      await p.getByRole("button", { name: F.personagemDoProjeto }).waitFor({ timeout: 30000 });
      await p.waitForTimeout(1000);
      const ov = p.locator(F.overlay);
      if (fonte?.id) {
        const m = r.doProjeto(projeto).find((x) => x.id === fonte!.id);
        if (!m || ehVideo(m) || !m.miniatura) throw new Error(`A imagem ${fonte.id} não está no projeto (veja flow_listar).`);
        await p.getByRole("button", { name: F.personagemDoProjeto }).click();
        const lista = ov.getByRole("listbox", { name: F.listaRecursos }).getByRole("option");
        await lista.first().waitFor({ timeout: 10000 });
        const indice = await lista.evaluateAll(
          (els, token) => els.findIndex((e) => (e.querySelector("img")?.getAttribute("src") ?? "").includes(token as string)),
          m.miniatura,
        );
        if (indice < 0) throw new Error(`A imagem ${fonte.id} não apareceu no seletor do Flow.`);
        await lista.nth(indice).click();
        // Hoje o clique na imagem já cria o personagem e fecha o diálogo; antes era preciso confirmar.
        const dialogo = ov.getByRole("heading", { name: F.personagemSelecionarMidia });
        await dialogo.waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
        if (await dialogo.isVisible().catch(() => false)) await ov.getByRole("button", { name: F.personagemAdicionarMidia }).click({ timeout: 8000 });
        feito.push(`retrato a partir da imagem "${m.titulo ?? m.id}"`);
      } else if (fonte?.arquivo) {
        const [seletor] = await Promise.all([
          p.waitForEvent("filechooser", { timeout: 15000 }),
          p.getByRole("button", { name: F.personagemEnviar, exact: true }).click(),
        ]);
        await seletor.setFiles(fonte.arquivo);
        feito.push(`retrato a partir do arquivo ${path.basename(fonte.arquivo)}`);
      } else {
        await digitarPrompt(p, normalizar(pedido.descricao!), F.caixaPrompt, true);
        await p.getByRole("button", { name: F.botaoGerar }).click();
        feito.push("retrato gerado pela descrição (Nano Banana)");
      }

      // O Flow cria o personagem na hora (endereço /character/<id>) e gera o retrato em ~25 s.
      // Nome, personalidade e voz já podem ser preenchidos enquanto o retrato é gerado.
      await p.waitForURL(F.urlPersonagem, { timeout: Math.min(45000, Math.max(10000, prazo.restante() - 10000)) });
      conferirPagina(p);
      pagina = p.url();
      await p.getByRole("textbox", { name: F.personagemNome }).waitFor({ timeout: 15000 });
      await p.waitForTimeout(800);

      await definirNomePersonagem(p, nome);
      feito.push(`nome "${nome}"`);
      if (pedido.personalidade) {
        await definirPersonalidade(p, pedido.personalidade);
        feito.push("personalidade");
      }
      if (pedido.voz) {
        if (prazo.sobra(12000)) {
          await definirVoz(p, pedido.voz);
          feito.push(`voz ${pedido.voz}`);
        } else pendente.push(`voz ${pedido.voz}`);
      }
      progresso("Esperando o retrato...");
      const retrato = await p
        .getByRole("img", { name: F.personagemImagem })
        .first()
        .waitFor({ timeout: Math.min(60000, Math.max(2000, prazo.restante() - 8000)) })
        .then(() => true, () => false);
      if (!retrato) {
        // O retrato continua sendo gerado no Google; o personagem já existe com o nome certo.
        pendente.push("retrato (ainda sendo gerado no Flow; veja com flow_personagem_editar em instantes)");
        if (pedido.corpo) pendente.push("corpo");
      } else if (pedido.corpo) {
        if (prazo.sobra(40000)) {
          progresso("Gerando o corpo inteiro...");
          const corpo = await criarCorpo(p, pedido.corpo, Math.min(60000, prazo.restante() - 10000));
          if (corpo) feito.push(textoDoCorpo(corpo));
          else pendente.push(CORPO_DEMOROU);
        } else pendente.push("corpo");
      }

      const arquivos = retrato ? await imagensDoPersonagem(p, nome, prazo) : [];
      if (retrato) await concluirPersonagem(p);
      registrar({ personagem: nome, acao: "criar", pagina, feito, pendente });
      return { nome, pagina, projeto: F.urlProjeto(projeto), feito, pendente, arquivos };
    } catch (erro) {
      // O personagem nasce assim que o Flow recebe a imagem ou a descrição: um erro daqui em diante
      // não pode deixá-lo perdido como "Personagem sem nome". Termina o nome se der; senão, avisa.
      if (!pagina && !F.urlPersonagem.test(p.url())) await p.waitForURL(F.urlPersonagem, { timeout: 4000 }).catch(() => {});
      if (!pagina && !F.urlPersonagem.test(p.url())) throw erro;
      pagina ||= p.url();
      const motivo = mensagemDeErro(erro).split("\n")[0];
      let ficou = await nomeNaPagina(p);
      if (!mesmoNome(ficou, nome) && prazo.sobra(8000)) {
        await definirNomePersonagem(p, nome).catch(() => {});
        ficou = await nomeNaPagina(p);
        if (mesmoNome(ficou, nome)) feito.push(`nome "${nome}"`);
      }
      const faltam = [
        pedido.personalidade && !feito.includes("personalidade") ? "personalidade" : "",
        pedido.voz && !feito.some((f) => f.startsWith("voz")) && !pendente.some((x) => x.startsWith("voz")) ? `voz ${pedido.voz}` : "",
        pedido.corpo && !feito.some((f) => f.startsWith("corpo")) && !pendente.some((x) => x.startsWith("corpo")) ? "corpo" : "",
      ].filter(Boolean);
      pendente.push(...faltam);
      const nomeCerto = mesmoNome(ficou, nome);
      const corrigir = `corrija com flow_personagem_editar usando nome: "${pagina}" (o link evita confusão com outros sem nome) e novo_nome: "${nome}".`;
      const aviso = nomeCerto
        ? `O personagem foi criado, mas parou no meio: ${motivo}`
        : ficou
          ? `O personagem foi criado, mas ficou com o nome "${ficou}" (o Flow deu erro: ${motivo}). Para acertar, ${corrigir}`
          : `O personagem foi criado, mas não consegui conferir o nome dele (o Flow deu erro: ${motivo}). Veja com flow_personagens; se estiver como "${F.personagemSemNome}", ${corrigir}`;
      registrar({ personagem: nome, acao: "criar", pagina, feito, pendente, erro: motivo, nomeNoFlow: ficou });
      return { nome: ficou || nome, pagina, projeto: F.urlProjeto(projeto), feito, pendente, arquivos: [], aviso };
    }
  });
}

export interface EdicaoPersonagem {
  nome: string;
  novoNome?: string;
  personalidade?: string;
  voz?: string;
  corpo?: string;
  projeto?: string;
}

export function editarPersonagem(pedido: EdicaoPersonagem, prazo: Prazo, progresso: Progresso = () => {}): Promise<ResultadoPersonagem> {
  return comFlow(prazo, async (p, r) => {
    const feito: string[] = [];
    const pendente: string[] = [];
    // Com o link da página, o projeto vem dele (e não é preciso abrir a grade do projeto).
    const projeto = projetoDoLink(pedido.nome) ?? (await abrirProjeto(p, r, pedido.projeto));
    await abrirPersonagem(p, pedido.nome, projeto);
    const pagina = p.url();
    // O nome pode ter vindo como link da página: o nome de verdade é o do campo.
    let nome = (await nomeNaPagina(p)) || normalizar(pedido.nome);
    if (pedido.novoNome) {
      await definirNomePersonagem(p, normalizar(pedido.novoNome));
      nome = normalizar(pedido.novoNome);
      feito.push(`nome "${nome}"`);
    }
    if (pedido.personalidade) {
      await definirPersonalidade(p, pedido.personalidade);
      feito.push("personalidade");
    }
    if (pedido.voz) {
      await definirVoz(p, pedido.voz);
      feito.push(`voz ${pedido.voz}`);
    }
    if (pedido.corpo) {
      if (prazo.sobra(35000)) {
        progresso("Gerando o corpo inteiro...");
        const corpo = await criarCorpo(p, pedido.corpo, Math.min(60000, prazo.restante() - 10000));
        if (corpo) feito.push(textoDoCorpo(corpo));
        else pendente.push(CORPO_DEMOROU);
      } else pendente.push("corpo");
    }
    const arquivos = await imagensDoPersonagem(p, nome, prazo);
    await concluirPersonagem(p);
    registrar({ personagem: nome, acao: "editar", pagina, feito, pendente });
    return { nome, pagina, projeto: F.urlProjeto(projeto), feito, pendente, arquivos };
  });
}

/** Lista os nomes dos personagens do projeto. */
export function listarPersonagens(prazo: Prazo, projeto?: string): Promise<{ projeto: string; nomes: string[] }> {
  return comFlow(prazo, async (p, r) => {
    const id = await abrirProjeto(p, r, projeto);
    return { projeto: F.urlProjeto(id), nomes: [...new Set(await nomesDosPersonagens(p))] };
  });
}

/** Exclui um personagem (permanente no Flow). */
export function excluirPersonagem(prazo: Prazo, nome: string, projeto?: string): Promise<string> {
  return comFlow(prazo, async (p, r) => {
    const id = projetoDoLink(nome) ?? (await abrirProjeto(p, r, projeto));
    await abrirPersonagem(p, nome, id);
    const real = (await nomeNaPagina(p)) || nome;
    await p.getByRole("button", { name: F.personagemExcluir, exact: true }).click({ timeout: 8000 });
    const ov = p.locator(F.overlay);
    await ov.getByText(F.personagemExcluirAviso).waitFor({ timeout: 8000 });
    await ov.getByRole("button", { name: F.personagemExcluir, exact: true }).click();
    await p.waitForURL((u) => !F.urlPersonagem.test(u.toString()), { timeout: 15000 });
    registrar({ personagem: real, acao: "excluir" });
    return `Personagem "${real}" excluído do Flow.`;
  });
}
