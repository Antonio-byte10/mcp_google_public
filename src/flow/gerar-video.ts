// Geração de vídeo (texto, quadros ou elementos).
import { capturaDeErro, registrar } from "../arquivos.js";
import { conferirTetoDeHoje } from "../gastos.js";
import { mensagemDeErro } from "../seguranca.js";
import { alterarLotes, novoIdLote, type Lote, type Qualidade } from "../pendentes.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F } from "../seletores.js";
import { type ModeloVideo, type ProporcaoVideo, type Progresso, medirEtapas, normalizar } from "./base.js";
import { inferirProporcao, inferirDuracao, maisProxima } from "./inferencia.js";
import { prepararModoDireto, digitarPrompt } from "./tela.js";
import { lerCreditos } from "./creditos.js";
import { type ModoVideo, escolherModoVideo, configurarVideo } from "./configuracao.js";
import { comFlow, exigirTempoParaEnviar, EnvioNaoAconteceu } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { type FonteQuadro, lerFonteQuadro, preenchidos, escolherQuadro } from "./quadros.js";
import { adicionarPersonagens, adicionarReferencias, adicionarVoz, conferirPersonagens } from "./elementos.js";
import { midiasDoLote, acompanhar, atualizarPendentes, type ResultadoGeracao, esperarIds } from "./lotes.js";

const DURACOES_OMNI = [4, 6, 8, 10];

export interface PedidoVideo {
  prompt: string;
  modelo: ModeloVideo;
  proporcao?: ProporcaoVideo;
  quantidade: number;
  duracao?: number; // só Omni 1.1 Flash (4, 6, 8 ou 10 s); os Veo são fixos em 8 s
  resolucao?: "360p" | "720p"; // só Omni 1.1 Flash
  imagemInicio?: string; // id de imagem do projeto ou caminho de arquivo
  imagemFim?: string;
  /** Nomes de personagens do Flow para aparecer no vídeo (consistência entre cenas). */
  personagens?: string[];
  /** Imagens de referência ("ingredientes": id do projeto ou arquivo do PC). */
  referencias?: string[];
  /** Voz do Flow para narração/falas (ex.: Fenrir) e estilo da performance. */
  voz?: string;
  estiloVoz?: string;
  /** Teto opcional de créditos para este envio (sem teto por padrão: a conta tem créditos diários). */
  maxCreditos?: number;
  qualidade: Qualidade;
  projeto?: string;
  simular?: boolean;
  /** Só envia e devolve o lote (sem esperar ficar pronto). */
  apenasEnviar?: boolean;
  /**
   * Chamado com o navegador travado, logo antes do clique que gasta créditos. Serve para reservar o
   * envio (ex.: um trecho do vídeo longo) e impedir que outra janela do Claude envie o mesmo; se
   * lançar erro, nada é enviado.
   */
  aoEnviar?: (lote: Lote) => void;
}

export function gerarVideo(pedido: PedidoVideo, prazo: Prazo, progressoDoApp: Progresso = () => {}): Promise<ResultadoGeracao> {
  const progresso = medirEtapas(progressoDoApp, "vídeo");
  // Confere os arquivos antes de abrir o navegador (erro rápido e nada é enviado).
  const quadros = [pedido.imagemInicio, pedido.imagemFim].map((v) => (v ? lerFonteQuadro(v) : undefined));
  const personagens = [...new Set((pedido.personagens ?? []).map(normalizar).filter(Boolean))];
  let referencias: FonteQuadro[];
  try {
    referencias = (pedido.referencias ?? []).map(lerFonteQuadro);
  } catch (e) {
    return Promise.reject(e);
  }
  const voz = pedido.voz?.trim();
  if ((personagens.length || referencias.length || voz) && (quadros[0] || quadros[1])) {
    return Promise.reject(new Error("Use personagens/referencias/voz OU imagem_inicio/imagem_fim, não os dois: no Flow são modos diferentes (Elementos e Frames)."));
  }
  return comFlow(prazo, async (p, r) => {
    const avisos: string[] = [];
    // O estilo da voz vai no texto (no painel do Flow ele obrigaria a salvar uma voz nova no projeto).
    const prompt = normalizar(pedido.estiloVoz && voz ? `${pedido.prompt} Estilo da voz: ${pedido.estiloVoz}.` : pedido.prompt);
    const proporcao = pedido.proporcao ?? inferirProporcao(prompt);
    let duracao = pedido.duracao;
    const pedidaNoPrompt = inferirDuracao(prompt);
    if (pedido.modelo === "omni-1.1-flash") {
      const alvo = duracao ?? pedidaNoPrompt ?? 8;
      duracao = maisProxima(alvo, DURACOES_OMNI);
      if (duracao !== alvo) avisos.push(`Duração ajustada de ${alvo}s para ${duracao}s (opções: 4, 6, 8, 10).`);
    } else if ((duracao ?? pedidaNoPrompt) && (duracao ?? pedidaNoPrompt) !== 8) {
      avisos.push(`Os modelos Veo 3.1 geram sempre 8s; a duração pedida (${duracao ?? pedidaNoPrompt}s) foi ignorada. Para mais tempo, use flow_estender_video depois; para 4-10s, omni-1.1-flash.`);
    }

    progresso("Abrindo o projeto no Flow...");
    const projeto = await abrirProjeto(p, r, pedido.projeto);
    await prepararModoDireto(p);
    const saldoAntes = await lerCreditos(p);

    const modo: ModoVideo = quadros[0] || quadros[1] ? "frames" : "elementos";
    const usados: string[] = [];
    if (modo === "frames") {
      progresso("Colocando as imagens nos quadros...");
      await escolherModoVideo(p, "frames");
      if (quadros[0]) usados.push(await escolherQuadro(p, r, projeto, "Início", quadros[0]));
      if (quadros[1]) usados.push(await escolherQuadro(p, r, projeto, "Fim", quadros[1]));
    }
    const elementos = personagens.length + referencias.length + (voz ? 1 : 0);
    if (elementos) {
      // Cada passo avisa o progresso: se um deles demorar, o log ("etapa lenta") diz qual foi.
      progresso("Trocando para o modo Elementos...");
      await escolherModoVideo(p, "elementos");
      if (personagens.length) {
        progresso("Colocando os personagens...");
        await adicionarPersonagens(p, personagens);
        usados.push(`Personagens: ${personagens.join(", ")}`);
      }
      if (referencias.length) {
        progresso("Colocando as referências...");
        usados.push(`Referências: ${(await adicionarReferencias(p, r, projeto, referencias)).join(", ")}`);
      }
      if (voz) {
        progresso("Colocando a voz...");
        usados.push(await adicionarVoz(p, voz) + (pedido.estiloVoz ? ` (estilo no prompt: ${pedido.estiloVoz})` : ""));
      }
    }

    progresso("Configurando modelo e formato...");
    const { custo, resumo } = await configurarVideo(p, { modo, modelo: pedido.modelo, proporcao, quantidade: pedido.quantidade, duracao, resolucao: pedido.resolucao });
    if (modo === "frames" && (await preenchidos(p)) < usados.length) {
      throw new Error("As imagens saíram dos quadros ao configurar o formato. Nada foi gerado.");
    }
    await conferirPersonagens(p, elementos, "ao configurar o formato");
    const lote: Lote = {
      lote: novoIdLote(), tipo: "video", projeto, prompt, quantidade: pedido.quantidade, modelo: pedido.modelo, custo,
      qualidade: pedido.qualidade, criadoEm: new Date().toISOString(),
      existentes: r.doProjeto(projeto).map((m) => m.id), ids: [], baixados: {}, personagens, elementos,
    };
    const res: ResultadoGeracao = {
      lote: lote.lote, projeto: F.urlProjeto(projeto), configuracao: resumo, custoEstimado: custo, saldoAntes, saldoDepois: saldoAntes,
      quadros: usados, avisos,
      relatorio: { lote: lote.lote, tipo: "video", custo, prompt, estado: "aguardando", arquivos: [], andamento: [], avisos: [] },
    };
    if (pedido.simular) return res;
    if (pedido.maxCreditos !== undefined && custo > pedido.maxCreditos) {
      throw new Error(`Custo de ${custo} créditos passa do limite de ${pedido.maxCreditos}. Nada foi gerado. Aumente max_creditos se quiser mesmo gerar.`);
    }
    conferirTetoDeHoje(custo);
    if (saldoAntes !== null && custo > saldoAntes) {
      throw new Error(`Saldo insuficiente: a geração custa ${custo} créditos e você tem ${saldoAntes}. Nada foi gerado.`);
    }

    const tilesAntes = await p.locator(F.tile).count();
    await digitarPrompt(p, prompt);
    await conferirPersonagens(p, elementos, "ao digitar o prompt");
    exigirTempoParaEnviar(prazo);
    pedido.aoEnviar?.(lote);
    await p.getByRole("button", { name: F.botaoGerar }).click();
    progresso(`Pedido enviado (${resumo}, ${custo} créditos). Gerando...`);
    // Daqui em diante os créditos foram gastos: o lote fica salvo para flow_status achar.
    alterarLotes((ls) => [...ls, lote]);
    registrar({ acao: "enviado", lote: lote.lote, tipo: lote.tipo, modelo: lote.modelo, custo: lote.custo, prompt: lote.prompt });

    // Depois do clique os créditos já foram gastos: nenhum erro daqui em diante pode parecer
    // "nada aconteceu" (o Claude pediria de novo e pagaria duas vezes).
    try {
      await esperarIds(p, r, lote, prazo);
      if (!midiasDoLote(r, lote).length && prazo.sobra(10000)) {
        const novosTiles = (await p.locator(F.tile).count()) > tilesAntes;
        const alerta = await p.locator("[role=alert], .mat-mdc-snack-bar-label").allInnerTexts().catch(() => []);
        const cap = await capturaDeErro(p, "pedido-sem-resposta");
        if (novosTiles) {
          // Apareceu um bloco novo: a geração existe; o lote continua para o flow_status achar.
          res.avisos.push(`A geração apareceu no Flow, mas ainda não consegui identificá-la; o flow_status continua tentando (lote ${lote.lote}). Captura: ${cap}`);
        } else {
          alterarLotes((ls) => ls.filter((l) => l.lote !== lote.lote));
          registrar({ lote: lote.lote, tipo: "video", estado: "sem-resposta", prompt, alerta, captura: cap });
          throw new EnvioNaoAconteceu(`O Flow não mostrou a geração${alerta.length ? ` (mensagem: ${alerta.join(" | ")})` : ""}. Créditos provavelmente não foram gastos; confira com flow_creditos antes de tentar de novo. Captura: ${cap}`);
        }
      }
      // Roteiro em lote: só envia (o acompanhamento fica com o flow_status, para várias cenas de uma vez).
      if (pedido.apenasEnviar) {
        alterarLotes((ls) => ls.map((l) => (l.lote === lote.lote ? lote : l)));
        return res;
      }
      const [relatorio] = await acompanhar(p, r, [lote], prazo, progresso);
      res.relatorio = relatorio;
      res.saldoDepois = r.saldo; // null se o Flow ainda não informou o saldo novo
      atualizarPendentes([lote], [relatorio]);
    } catch (erro) {
      if (/não mostrou a geração/.test(String((erro as Error)?.message))) throw erro;
      res.relatorio.avisos.push(`O pedido foi enviado (créditos gastos), mas o acompanhamento falhou: ${mensagemDeErro(erro)}. NÃO gere de novo: use flow_status (lote ${lote.lote}).`);
    }
    return res;
  });
}
