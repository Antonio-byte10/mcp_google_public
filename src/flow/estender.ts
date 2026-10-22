// Extensão de vídeo e de cena (+8 s).
import { type Locator, type Page } from "playwright";
import { capturaDeErro, registrar } from "../arquivos.js";
import { conferirTetoDeHoje } from "../gastos.js";
import { irPara } from "../navegador.js";
import { alterarLotes, novoIdLote, type Lote } from "../pendentes.js";
import { type Prazo } from "../prazo.js";
import { CUSTO_VIDEO, FLOW as F, MODELOS_FLOW } from "../seletores.js";
import { type ModeloVideo, UUID, type Progresso, medirEtapas, normalizar } from "./base.js";
import { STATUS_PRONTO, ehVideo, descreverStatus } from "./rastreador.js";
import { fecharFlutuantes, prepararModoDireto, digitarPrompt } from "./tela.js";
import { lerCreditos } from "./creditos.js";
import { numeroDeCreditos, escolherModoVideo } from "./configuracao.js";
import { comFlow, EnvioNaoAconteceu } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { adicionarPersonagens, adicionarVoz, conferirPersonagens } from "./elementos.js";
import { midiasDoLote, acompanhar, atualizarPendentes, type ResultadoGeracao, esperarIds } from "./lotes.js";

// Depois do clique de estender: ~9 s até a cena e ~10-18 s até o Flow confirmar a geração (fZytfe).
const TEMPO_APOS_CLIQUE_EXTENSAO_MS = 25000;

export interface PedidoExtensao {
  /** Vídeo ou cena a continuar. Numa cena, a continuação parte do último clipe. */
  id: string;
  prompt: string;
  modelo: Exclude<ModeloVideo, "omni-1.1-flash">;
  /** Teto opcional de créditos para este envio (sem teto por padrão: a conta tem créditos diários). */
  maxCreditos?: number;
  projeto?: string;
  /** Só envia e devolve o lote (o flow_status acompanha). */
  apenasEnviar?: boolean;
  /** Passo do vídeo longo: o lote termina quando o clipe fica pronto, sem exportar a cena. */
  apenasClipe?: boolean;
  /** Ver PedidoVideo.aoEnviar. */
  aoEnviar?: (lote: Lote) => void;
  /** Elementos também na extensão (a caixa do modo de extensão aceita, como na geração normal). */
  personagens?: string[];
  voz?: string;
  estiloVoz?: string;
}

/** Abre a cena e deixa o último clipe selecionado (o "+" da linha do tempo fica nele). */
async function selecionarUltimoClipe(p: Page, projeto: string, cena: string): Promise<Locator> {
  await irPara(p, F.urlCena(projeto, cena));
  await p.getByRole("button", { name: F.botaoBaixarCena }).waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  const ultimo = p.locator(F.ultimoClipe).first();
  await ultimo.waitFor({ timeout: 10000 });
  // O clique que seleciona é no corpo do clipe (miniaturas); na borda do contêiner não pega.
  // O "+" só aparece no clipe já selecionado, então clicar no meio de um não selecionado é seguro.
  for (let i = 0; i < 3 && !(await ultimo.getAttribute("class"))?.includes("selected"); i++) {
    await ultimo.locator(F.corpoDoClipe).first().click();
    await p.waitForTimeout(700);
  }
  if (!(await ultimo.getAttribute("class"))?.includes("selected")) {
    throw new Error("Não consegui selecionar o último clipe da cena (a tela do Flow pode ter mudado). Nada foi gerado.");
  }
  const dentro = ultimo.getByRole("button", { name: F.botaoAdicionarClipe });
  return (await dentro.count()) ? dentro.first() : p.getByRole("button", { name: F.botaoAdicionarClipe }).first();
}

/**
 * Continua um vídeo ou uma cena (+8 s). De um vídeo, o Flow cria uma cena (cópia do original + clipe
 * novo); de uma cena, o clipe novo entra no fim dela. Entrega a cena inteira num MP4 só.
 */
export function estenderVideo(pedido: PedidoExtensao, prazo: Prazo, progressoDoApp: Progresso = () => {}): Promise<ResultadoGeracao> {
  const progresso = medirEtapas(progressoDoApp, "extensão");
  return comFlow(prazo, async (p, r) => {
    const voz = pedido.voz?.trim();
    const personagens = [...new Set((pedido.personagens ?? []).map(normalizar).filter(Boolean))];
    const prompt = normalizar(pedido.estiloVoz && voz ? `${pedido.prompt} Estilo da voz: ${pedido.estiloVoz}.` : pedido.prompt);
    const alvo = pedido.id.match(UUID)?.[0];
    if (!alvo) throw new Error("Informe o id do vídeo ou da cena a estender (aparece em flow_listar).");
    progresso("Abrindo o projeto no Flow...");
    const projeto = await abrirProjeto(p, r, pedido.projeto);
    const ehCena = r.cenas.has(alvo);
    if (ehCena) {
      const clipes = r.clipesDaCena(alvo);
      if (!clipes.length) throw new Error(`A cena ${alvo} ainda não carregou os clipes. Tente de novo em instantes.`);
      const ultimo = r.midias.get(clipes[clipes.length - 1].id);
      if (ultimo?.status !== undefined && ultimo.status !== STATUS_PRONTO) {
        throw new Error(`O último clipe da cena ainda está ${descreverStatus(ultimo.status)}. Espere ficar pronto (flow_status) e estenda depois.`);
      }
    } else {
      const original = r.doProjeto(projeto).find((m) => m.id === alvo);
      if (!original) throw new Error(`${alvo} não é um vídeo nem uma cena do projeto ${F.urlProjeto(projeto)}. Veja flow_listar.`);
      if (!ehVideo(original)) throw new Error(`${alvo} é uma imagem. Para animar uma imagem use flow_gerar_video com imagem_inicio.`);
      if (original.status !== STATUS_PRONTO) throw new Error(`O vídeo ${alvo} ainda está ${descreverStatus(original.status)}.`);
    }

    // O modelo da extensão é o Flow que escolhe (aparece no menu "Estender (…)"); aqui só o modo.
    progresso("Preparando a caixa de comando...");
    await prepararModoDireto(p);
    await escolherModoVideo(p, "elementos");
    await fecharFlutuantes(p);
    const saldoAntes = await lerCreditos(p);
    // Tudo que já existe (inclusive os clipes da cena) nunca é o clipe novo.
    const existentes = [
      ...new Set([...(ehCena ? [] : [alvo]), ...r.doProjeto(projeto).map((m) => m.id), ...(ehCena ? r.clipesDaCena(alvo).map((c) => c.id) : [])]),
    ];

    let mais: Locator;
    if (ehCena) {
      progresso("Abrindo a cena e preparando a extensão a partir do último clipe...");
      mais = await selecionarUltimoClipe(p, projeto, alvo);
    } else {
      progresso("Abrindo o vídeo e preparando a extensão...");
      await irPara(p, F.urlMidia(projeto, alvo));
      await p.getByRole("button", { name: F.botaoBaixar }).waitFor({ timeout: 30000 });
      await p.waitForTimeout(1500);
      mais = p.getByRole("button", { name: F.botaoAdicionarClipe }).first();
    }
    await mais.click({ timeout: 10000 });
    await p.locator(F.overlay).getByRole("menuitem", { name: F.opcaoEstender }).click({ timeout: 10000 });
    const modo = p.getByRole("button", { name: F.modoExtensao });
    await modo.waitFor({ timeout: 10000 });
    // "Estender (Veo 3.1 - Lite) close": o Flow decide o modelo; se não for o pedido, segue e avisa
    // (o custo real é lido mais abaixo e passa pelo max_creditos, se houver).
    const textoModo = normalizar((await modo.innerText()).replace(/\bclose\b/g, ""));
    const modelo = (Object.keys(MODELOS_FLOW) as ModeloVideo[]).find((m) => textoModo.includes(MODELOS_FLOW[m]));
    if (!modelo) throw new Error(`Não reconheci o modelo da extensão ("${textoModo}"). A interface pode ter mudado. Nada foi gerado.`);
    const rotulo = MODELOS_FLOW[modelo];
    const avisosModelo = modelo === pedido.modelo ? [] : [`O Flow só oferece estender com ${rotulo} (pedido: ${MODELOS_FLOW[pedido.modelo]}); a extensão usou ${rotulo}.`];
    const elementos = personagens.length + (voz ? 1 : 0);
    if (elementos) {
      if (personagens.length) {
        progresso("Colocando os personagens na extensão...");
        await adicionarPersonagens(p, personagens);
      }
      if (voz) {
        progresso("Colocando a voz na extensão...");
        await adicionarVoz(p, voz);
      }
      progresso("Escrevendo o prompt da extensão...");
      if (!(await modo.isVisible().catch(() => false))) throw new Error("O modo de extensão fechou ao colocar os elementos. Nada foi gerado.");
      await conferirPersonagens(p, elementos, "da extensão");
    }
    await digitarPrompt(p, prompt, F.caixaPrompt, true);
    await conferirPersonagens(p, elementos, "da extensão ao digitar o prompt");

    // O custo aparece na dica do botão de gerar.
    const gerar = p.getByRole("button", { name: F.botaoGerar });
    await gerar.hover();
    await p.waitForTimeout(1000);
    const dica = await p.locator(F.overlay).getByText(F.textoCusto).first().innerText().catch(() => "");
    const custo = numeroDeCreditos(dica) ?? CUSTO_VIDEO[modelo];
    const avisos = [...avisosModelo, ...(numeroDeCreditos(dica) === null ? [`Não consegui ler o custo na tela; usei o valor conhecido (${custo}).`] : [])];
    if (pedido.maxCreditos !== undefined && custo > pedido.maxCreditos) throw new Error(`Custo de ${custo} créditos passa do limite de ${pedido.maxCreditos}. Nada foi gerado.`);
    conferirTetoDeHoje(custo);
    if (saldoAntes !== null && custo > saldoAntes) throw new Error(`Saldo insuficiente: custa ${custo} créditos e você tem ${saldoAntes}. Nada foi gerado.`);

    const lote: Lote = {
      lote: novoIdLote(), tipo: "extensao", projeto, prompt, quantidade: 1, modelo, custo,
      qualidade: "original", criadoEm: new Date().toISOString(), existentes, ids: [], baixados: {},
      cena: ehCena ? alvo : undefined, apenasClipe: pedido.apenasClipe, personagens, elementos,
    };
    r.cena = null;
    const pedidasAntes = r.extensoesPedidas;
    const confirmadasAntes = r.extensoesConfirmadas.length;
    // A extensão precisa da página aberta por ~20 s depois do clique (cena + pedido de geração).
    // Basta o pedido de geração sair (~11 s); a confirmação, se não couber, o flow_status confere.
    if (!prazo.sobra(20000)) throw new EnvioNaoAconteceu("O tempo desta chamada acabou antes da extensão (ela precisa de ~20 s depois do clique): nada foi gerado nem gasto. Peça de novo.");
    pedido.aoEnviar?.(lote);
    await gerar.click();
    progresso(`Extensão enviada (${rotulo}, ${custo} créditos). Esperando o Flow confirmar...`);
    alterarLotes((ls) => [...ls, lote]);
    registrar({ acao: "enviado", lote: lote.lote, tipo: lote.tipo, modelo: lote.modelo, custo: lote.custo, prompt: lote.prompt, cena: ehCena ? alvo : undefined });
    // O Flow cria a cena (rqZuUc, ~9 s; estendendo uma cena pode reaproveitar a mesma) e só depois
    // pede a geração (fZytfe). Fechar a página antes disso cancela a extensão: espera a confirmação.
    const limite = Date.now() + Math.min(TEMPO_APOS_CLIQUE_EXTENSAO_MS, prazo.restante() - 3000);
    while (Date.now() < limite && r.extensoesConfirmadas.length === confirmadasAntes) await p.waitForTimeout(400);
    lote.cena = r.cena ?? (ehCena ? alvo : p.url().match(new RegExp(`/scene/(${UUID.source})`, "i"))?.[1]);
    const clipe = r.extensoesConfirmadas[confirmadasAntes];
    if (clipe) {
      lote.ids = [clipe];
    } else if (r.extensoesPedidas === pedidasAntes) {
      // O pedido de geração nunca saiu: nada foi gasto. Tira o lote e avisa sem ambiguidade.
      alterarLotes((ls) => ls.filter((l) => l.lote !== lote.lote));
      const cap = await capturaDeErro(p, "extensao-sem-pedido");
      registrar({ lote: lote.lote, tipo: "extensao", estado: "sem-resposta", prompt, captura: cap });
      throw new EnvioNaoAconteceu(`A extensão não começou no Flow (o pedido de geração não saiu); nada foi gasto. Pode pedir de novo. Captura: ${cap}`);
    }
    alterarLotes((ls) => ls.map((l) => (l.lote === lote.lote ? lote : l)));

    const res: ResultadoGeracao = {
      lote: lote.lote, projeto: F.urlProjeto(projeto), configuracao: `Estender ${ehCena ? "cena" : "vídeo"} · ${rotulo} · +8s${voz ? ` · voz ${voz}` : ""}${personagens.length ? ` · personagens: ${personagens.join(", ")}` : ""}`, custoEstimado: custo,
      saldoAntes, saldoDepois: saldoAntes, quadros: [], avisos,
      relatorio: { lote: lote.lote, tipo: "extensao", custo, prompt, estado: "aguardando", arquivos: [], andamento: [], avisos: [] },
    };
    if (!lote.cena) res.avisos.push("Não identifiquei a cena criada; o clipe novo pode ser baixado sozinho com flow_baixar.");
    if (pedido.apenasEnviar) return res;
    await esperarIds(p, r, lote, prazo);
    res.saldoDepois = r.saldo; // null se o Flow ainda não informou o saldo novo
    if (!prazo.sobra(20000)) {
      // Pouco tempo (Claude Desktop): deixa o lote salvo e responde já; flow_status continua.
      res.relatorio.andamento = midiasDoLote(r, lote).map((m) => `${m.id}: ${descreverStatus(m.status)}`);
      alterarLotes((ls) => ls.map((l) => (l.lote === lote.lote ? lote : l)));
      return res;
    }
    await abrirProjeto(p, r, projeto);
    const [relatorio] = await acompanhar(p, r, [lote], prazo, progresso);
    res.relatorio = relatorio;
    atualizarPendentes([lote], [relatorio]);
    return res;
  });
}
