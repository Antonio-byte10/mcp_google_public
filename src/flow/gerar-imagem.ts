// Geração e edição de imagem.
import { capturaDeErro, registrar } from "../arquivos.js";
import { conferirTetoDeHoje } from "../gastos.js";
import { alterarLotes, novoIdLote, type Lote, type Qualidade } from "../pendentes.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F, MODELOS_IMAGEM } from "../seletores.js";
import { type ModeloImagem, type ProporcaoImagem, type Progresso, medirEtapas, normalizar } from "./base.js";
import { inferirProporcaoImagem } from "./inferencia.js";
import { prepararModoDireto, digitarPrompt } from "./tela.js";
import { lerCreditos } from "./creditos.js";
import { configurarImagem } from "./configuracao.js";
import { comFlow, exigirTempoParaEnviar } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { lerFonteQuadro } from "./quadros.js";
import { adicionarPersonagens, adicionarReferencias, conferirPersonagens } from "./elementos.js";
import { midiasDoLote, acompanhar, atualizarPendentes, type ResultadoGeracao } from "./lotes.js";

export interface PedidoImagem {
  prompt: string;
  modelo: ModeloImagem;
  proporcao?: ProporcaoImagem;
  quantidade: number;
  /** Nomes de personagens do Flow para aparecer na imagem. */
  personagens?: string[];
  /** Imagens de referência (id do projeto ou arquivo do PC): editar, combinar, manter estilo. */
  referencias?: string[];
  /** Teto opcional de créditos para este envio (sem teto por padrão: a conta tem créditos diários). */
  maxCreditos?: number;
  qualidade: Qualidade;
  projeto?: string;
  simular?: boolean;
}

export function gerarImagem(pedido: PedidoImagem, prazo: Prazo, progressoDoApp: Progresso = () => {}): Promise<ResultadoGeracao> {
  const progresso = medirEtapas(progressoDoApp, "imagem");
  // Confere os arquivos antes de abrir o navegador (erro rápido e nada é enviado).
  const referencias = (pedido.referencias ?? []).map(lerFonteQuadro);
  return comFlow(prazo, async (p, r) => {
    const prompt = normalizar(pedido.prompt);
    const proporcao = pedido.proporcao ?? inferirProporcaoImagem(prompt);
    progresso("Abrindo o projeto no Flow...");
    const personagens = [...new Set((pedido.personagens ?? []).map(normalizar).filter(Boolean))];
    const projeto = await abrirProjeto(p, r, pedido.projeto);
    await prepararModoDireto(p);
    let { custo, resumo } = await configurarImagem(p, { modelo: pedido.modelo, proporcao, quantidade: pedido.quantidade });
    const elementos = personagens.length + referencias.length;
    if (personagens.length || referencias.length) {
      if (personagens.length) {
        progresso("Colocando os personagens no comando...");
        await adicionarPersonagens(p, personagens);
      }
      let refs: string[] = [];
      if (referencias.length) {
        progresso("Colocando as imagens de referência no comando...");
        refs = await adicionarReferencias(p, r, projeto, referencias);
      }
      // Confere (rápido, pelo resumo do botão) se continua imagem com o mesmo modelo e quantidade;
      // só refaz a configuração se algo mudou.
      const atual = normalizar(await p.locator(F.gatilhoConfig).first().innerText());
      if (!atual.includes(MODELOS_IMAGEM[pedido.modelo]) || !atual.includes(`x${pedido.quantidade}`)) {
        ({ custo, resumo } = await configurarImagem(p, { modelo: pedido.modelo, proporcao, quantidade: pedido.quantidade }));
      }
      await conferirPersonagens(p, elementos, "ao configurar a imagem");
      if (personagens.length) resumo += ` · personagens: ${personagens.join(", ")}`;
      if (refs.length) resumo += ` · referências: ${refs.join(", ")}`;
    }
    // Imagem costuma custar 0; só lê o saldo (leva uns segundos) quando custa algo.
    const saldoAntes = custo > 0 ? await lerCreditos(p) : null;
    const lote: Lote = {
      lote: novoIdLote(), tipo: "imagem", projeto, prompt, quantidade: pedido.quantidade, modelo: pedido.modelo, custo,
      qualidade: pedido.qualidade, criadoEm: new Date().toISOString(),
      existentes: r.doProjeto(projeto).map((m) => m.id), ids: [], baixados: {}, personagens, elementos,
    };
    const res: ResultadoGeracao = {
      lote: lote.lote, projeto: F.urlProjeto(projeto), configuracao: resumo, custoEstimado: custo, saldoAntes, saldoDepois: saldoAntes,
      quadros: [], avisos: [],
      relatorio: { lote: lote.lote, tipo: "imagem", custo, prompt, estado: "aguardando", arquivos: [], andamento: [], avisos: [] },
    };
    if (pedido.simular) return res;
    if (pedido.maxCreditos !== undefined && custo > pedido.maxCreditos) throw new Error(`Custo de ${custo} créditos passa do limite de ${pedido.maxCreditos}. Nada foi gerado.`);
    conferirTetoDeHoje(custo);
    if (saldoAntes !== null && custo > saldoAntes) throw new Error(`Saldo insuficiente: custa ${custo} créditos e você tem ${saldoAntes}. Nada foi gerado.`);

    await digitarPrompt(p, prompt);
    await conferirPersonagens(p, elementos, "ao digitar o prompt");
    const recebidas = r.imagensRecebidas;
    const erros = r.errosImagem.length;
    exigirTempoParaEnviar(prazo);
    await p.getByRole("button", { name: F.botaoGerar }).click();
    progresso(`Pedido enviado (${resumo}). Gerando...`);
    alterarLotes((ls) => [...ls, lote]);
    registrar({ acao: "enviado", lote: lote.lote, tipo: lote.tipo, modelo: lote.modelo, custo: lote.custo, prompt: lote.prompt });

    // A geração de imagem responde numa única chamada (ogiZ0b), em ~20 s.
    const limite = Date.now() + Math.max(5000, prazo.restante() - 6000); // sobra para baixar (link direto) e criar as prévias
    while (Date.now() < limite && r.imagensRecebidas === recebidas) await p.waitForTimeout(500);
    if (r.errosImagem.length > erros) {
      const cap = await capturaDeErro(p, "imagem-recusada");
      const alerta = await p.locator("[role=alert], .mat-mdc-snack-bar-label").allInnerTexts().catch(() => []);
      alterarLotes((ls) => ls.filter((l) => l.lote !== lote.lote));
      registrar({ lote: lote.lote, tipo: "imagem", estado: "recusada", prompt, erro: r.errosImagem.slice(erros), alerta, captura: cap });
      throw new Error(`O Flow recusou a geração da imagem${alerta.length ? `: ${alerta.join(" | ")}` : ""}. Tente reformular o prompt. Captura: ${cap}`);
    }
    // Com x2-x4 as outras chegam em respostas separadas; depois da primeira, no máximo 30 s.
    const limiteDemais = Math.min(limite, Date.now() + 30000);
    while (Date.now() < limiteDemais && midiasDoLote(r, lote).length < pedido.quantidade) await p.waitForTimeout(500);

    const [relatorio] = await acompanhar(p, r, [lote], prazo, progresso);
    res.relatorio = relatorio;
    if (custo > 0) res.saldoDepois = r.saldo ?? (await lerCreditos(p));
    atualizarPendentes([lote], [relatorio]);
    return res;
  });
}
