// Diagnóstico das telas do Flow (só leitura).
import { type Locator, type Page } from "playwright";
import { irPara } from "../navegador.js";
import { mensagemDeErro } from "../seguranca.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F, MODELOS_FLOW, MODELOS_IMAGEM } from "../seletores.js";
import { normalizar, nomeExato } from "./base.js";
import { fecharFlutuantes } from "./tela.js";
import { lerCreditos } from "./creditos.js";
import { numeroDeCreditos, abrirConfig } from "./configuracao.js";
import { comFlow } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { nomesDosPersonagens, abrirPersonagem, abaAtiva } from "./personagem-pagina.js";

/** Lê o que o Flow mostra para cada parte importante da tela. Não gera nada. */
export function diagnosticarFlow(prazo: Prazo, completo = false): Promise<string[]> {
  return comFlow(prazo, async (p, r) => {
    const itens: string[] = [];
    const ok = (cond: boolean, texto: string) => itens.push(`${cond ? "OK" : "FALHA"} - ${texto}`);
    const projeto = await abrirProjeto(p, r, undefined);
    ok(true, `projeto abre (${F.urlProjeto(projeto)}), ${r.doProjeto(projeto).length} mídias lidas da rede`);
    ok(await p.locator(F.chipAgente).first().isVisible().catch(() => false), "botão do modo Agente");
    ok(await p.locator(F.gatilhoConfig).first().isVisible().catch(() => false), "menu de configuração");
    try {
      await abrirConfig(p);
      const ov = p.locator(F.overlay);
      ok(await ov.getByRole("radio", { name: F.abaImagem }).isVisible(), "aba Imagem");
      // Frames só aparece na aba Vídeo (o menu abre na última aba usada).
      await ov.getByRole("radio", { name: F.abaVideo }).click();
      await p.waitForTimeout(500);
      ok(await ov.getByRole("radio", { name: F.modoFrames }).isVisible(), "modo Frames (imagem → vídeo)");
      ok(await ov.getByRole("button", { name: F.menuModelo }).isVisible(), "menu de modelos");
      ok(numeroDeCreditos(await ov.getByText(F.textoCusto).first().locator("..").innerText()) !== null, "custo exibido antes de gerar");
      if (completo) {
        // Modelos de vídeo e de imagem que as ferramentas aceitam (só lê o menu; nada é escolhido).
        for (const [aba, modelos] of [[F.abaVideo, MODELOS_FLOW], [F.abaImagem, MODELOS_IMAGEM]] as const) {
          await ov.getByRole("radio", { name: aba }).click();
          await p.waitForTimeout(400);
          await ov.getByRole("button", { name: F.menuModelo }).click();
          await ov.getByRole("menuitem").first().waitFor({ timeout: 4000 }).catch(() => {});
          const nomes = (await ov.getByRole("menuitem").allInnerTexts()).map((t) => normalizar(t.replace(/arrow_drop_down|expand_more|check/g, "")));
          const faltam = Object.values(modelos).filter((m) => !nomes.some((n) => nomeExato(m).test(n)));
          ok(!faltam.length, `modelos de ${aba === F.abaVideo ? "vídeo" : "imagem"} no menu${faltam.length ? `: faltam ${faltam.join(", ")} (o menu mostra ${nomes.join(", ") || "nada"}) → MODELOS_${aba === F.abaVideo ? "FLOW" : "IMAGEM"}` : ""}`);
          await p.keyboard.press("Escape");
          await p.waitForTimeout(300);
          if (!(await ov.getByRole("radio", { name: F.abaVideo }).isVisible().catch(() => false))) await abrirConfig(p);
        }
      }
      await fecharFlutuantes(p);
    } catch (erro) {
      ok(false, `menu de configuração: ${mensagemDeErro(erro)}`);
    }
    if (completo) {
      // Painel "+" dos elementos (personagens, vozes, imagens): abre e fecha sem colocar nada.
      try {
        await fecharFlutuantes(p);
        await p.getByRole("button", { name: F.adicionarElementos }).first().click({ timeout: 8000 });
        const ov = p.locator(F.overlay);
        const faltam: string[] = [];
        // O painel abre com animação: espera a primeira aba antes de conferir as outras.
        await ov.getByRole("tab", { name: F.abaPersonagens, exact: true }).waitFor({ timeout: 6000 }).catch(() => {});
        for (const aba of [F.abaPersonagens, F.abaVozes, F.abaImagens]) if (!(await ov.getByRole("tab", { name: aba, exact: true }).isVisible().catch(() => false))) faltam.push(aba);
        ok(!faltam.length, `painel de elementos (+)${faltam.length ? `: faltam as abas ${faltam.join(", ")} → FLOW.abaPersonagens/abaVozes/abaImagens` : ""}`);
        await fecharFlutuantes(p);
      } catch (erro) {
        ok(false, `painel de elementos (+) → FLOW.adicionarElementos: ${mensagemDeErro(erro).split("\n")[0]}`);
      }
      ok(await p.getByText(F.filtroPersonagens, { exact: true }).first().isVisible().catch(() => false), "filtro Personagens do projeto");
      ok(await p.locator(F.caixaPrompt).first().isVisible().catch(() => false), "caixa de comando (prompt)");
    }
    const saldo = await lerCreditos(p);
    ok(saldo !== null, `saldo de créditos${saldo !== null ? `: ${saldo}` : ""}`);
    if (completo) await diagnosticarPersonagens(p, projeto, ok);
    return itens;
  });
}

/**
 * Diagnóstico das telas de personagem, só lendo: a página de edição do primeiro personagem do
 * projeto (nome, voz, personalidade, abas, criar/refazer corpo) e a tela de novo personagem.
 */
export async function diagnosticarPersonagens(p: Page, projeto: string, ok: (cond: boolean, texto: string) => void): Promise<void> {
  const visivel = (l: Locator) => l.first().waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
  const botao = (nome: string) => visivel(p.getByRole("button", { name: nome, exact: true }));
  try {
    const nomes = await nomesDosPersonagens(p);
    if (!nomes.length) ok(true, "tela de edição de personagem: o projeto não tem personagem para conferir");
    else {
      await abrirPersonagem(p, nomes[0], projeto);
      const faltam: string[] = [];
      const conferir = async (cond: Promise<boolean>, item: string) => {
        if (!(await cond)) faltam.push(item);
      };
      await conferir(visivel(p.getByRole("textbox", { name: F.personagemNome })), "campo Nome do personagem → FLOW.personagemNome");
      await conferir(botao(F.personagemEditarNome), "Editar nome → FLOW.personagemEditarNome");
      await conferir(visivel(p.getByRole("textbox", { name: F.personagemPersonalidade })), "Personalidade → FLOW.personagemPersonalidade");
      await conferir(
        visivel(p.getByRole("button", { name: F.personagemVoz })).then(async (v) => v || botao(F.personagemRemoverVoz)),
        "voz (Selecionar uma voz / Remover) → FLOW.personagemVoz / personagemRemoverVoz",
      );
      await conferir(botao(F.personagemRetrato), "aba Retrato → FLOW.personagemRetrato");
      await conferir(visivel(p.locator(F.historicoImagem)), "versões no histórico (usadas para escolher o corpo refeito) → FLOW.historicoImagem");
      await conferir(visivel(p.getByText(F.personagemMudar)), "caixa 'O que você quer mudar?' → FLOW.personagemMudar");
      await conferir(visivel(p.locator(F.caixaPrompt)), "caixa de comando → FLOW.caixaPrompt");
      await conferir(botao(F.botaoGerar), "Iniciar geração → FLOW.botaoGerar");
      await conferir(botao(F.personagemConcluir), "Concluir → FLOW.personagemConcluir");
      ok(!faltam.length, `tela de edição do personagem "${nomes[0]}"${faltam.length ? `: faltam ${faltam.join("; ")}` : ""}`);
      // Corpo: "Criar corpo" quando não há corpo; com corpo, a aba Corpo (refazer pela caixa de mudança).
      const temCorpo = await botao(F.personagemCorpo);
      const criar = !temCorpo && (await botao(F.personagemCriarCorpo));
      const ativa = temCorpo && (await abaAtiva(p.getByRole("button", { name: F.personagemRetrato, exact: true })));
      ok(
        criar || ativa,
        temCorpo
          ? `corpo: aba Corpo presente (refazer corpo)${ativa ? "" : ", mas a marca da aba aberta mudou → FLOW.personagemAbaAtiva"}`
          : `corpo: botão Criar corpo${criar ? "" : " não apareceu → FLOW.personagemCriarCorpo"}`,
      );
    }
    // Tela de novo personagem: só abre (nada é criado sem clicar em gerar ou escolher imagem).
    await irPara(p, F.urlNovoPersonagem(projeto));
    const novo = await Promise.all([botao(F.personagemDoProjeto), botao(F.personagemEnviar), visivel(p.locator(F.caixaPrompt))]);
    const nomesNovo = ["Adicionar do projeto → FLOW.personagemDoProjeto", "Enviar → FLOW.personagemEnviar", "caixa de descrição → FLOW.caixaPrompt"];
    const faltamNovo = nomesNovo.filter((_, i) => !novo[i]);
    ok(!faltamNovo.length, `tela de novo personagem${faltamNovo.length ? `: faltam ${faltamNovo.join("; ")}` : ""}`);
  } catch (erro) {
    ok(false, `telas de personagem: ${mensagemDeErro(erro).split("\n")[0]}`);
  }
}
