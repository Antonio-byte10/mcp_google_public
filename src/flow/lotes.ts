// Lotes (gerações em andamento): acompanhamento, download do que ficou pronto e flow_status.
import { type Page } from "playwright";
import { comPrevia, registrar, type Arquivo } from "../arquivos.js";
import { conferirPagina } from "../navegador.js";
import { mensagemDeErro } from "../seguranca.js";
import { alterarLotes, guardarResultados, lerLotes, VALIDADE_LOTE_MS, type Lote, type ResultadoLote } from "../pendentes.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F } from "../seletores.js";
import { type Progresso, normalizar } from "./base.js";
import { STATUS_PRONTO, type Midia, ehVideo, pronta, Rastreador, descreverStatus } from "./rastreador.js";
import { comFlow } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { baixarMidia, exportarCena } from "./captura.js";

// Status de vídeo vistos: 6 logo após o envio (fila), 2 gerando, 3 pronto. Os códigos de falha
// ainda não foram vistos com certeza: um status fora desses que dure mais de STATUS_ESTRANHO_MS é
// tratado como falha (o histórico vai para o log para identificá-los).

const STATUS_ANDAMENTO = [2, 6];
const STATUS_ESTRANHO_MS = 90000;
// Mídia que não aparece na lista depois disso (desde o envio) é dada como perdida.
const SUMIU_MS = { imagem: 5 * 60 * 1000, video: 20 * 60 * 1000 };

// ---------- Acompanhamento dos lotes (gerações em andamento) ----------

export interface RelatorioLote {
  lote: string;
  tipo: Lote["tipo"];
  custo: number;
  prompt: string;
  estado: "concluido" | "aguardando" | "expirado" | "falhou";
  arquivos: Arquivo[];
  andamento: string[];
  avisos: string[];
}

/** Mídias deste lote: novas desde o envio, do tipo certo e com o mesmo prompt. */
export function midiasDoLote(r: Rastreador, l: Lote): Midia[] {
  const existentes = new Set(l.existentes);
  // Mídias que outro lote pendente já reconheceu nunca são deste (dois pedidos com o mesmo prompt).
  const deOutros = new Set(lerLotes().filter((o) => o.lote !== l.lote).flatMap((o) => o.ids));
  const prompt = normalizar(l.prompt);
  const querVideo = l.tipo !== "imagem";
  const desde = Date.parse(l.criadoEm) / 1000 - 30;
  // Modelo interno antigo das extensões ("veo_3_1_extension_lite"). Desde 07/10/2026 a extensão vem
  // como "models/veo-3.1-lite-generate-002;…", igual a um vídeo comum: o que separa é a cena.
  const extensao = (m: Midia) => /extension/i.test(m.modelo ?? "");
  const limite = l.tipo === "extensao" ? 1 : l.quantidade;
  // Extensão: o clipe novo é o que entrou na cena depois do envio (o de maior posição).
  if (l.tipo === "extensao" && l.cena && l.ids.length < limite) {
    const novo = r
      .clipesDaCena(l.cena)
      // A posição 0 é a cópia do vídeo original, criada junto com a cena.
      .filter((c) => c.posicao > 0 && !existentes.has(c.id) && !deOutros.has(c.id))
      .pop();
    if (novo && r.midias.has(novo.id)) l.ids.push(novo.id);
  }
  const combina = (m: Midia) => {
    // Criada antes do envio: é de outro pedido.
    if (m.criadoEm && m.criadoEm < desde) return false;
    // Vídeo comum × clipe de extensão ou cópia dentro de uma cena.
    if (l.tipo === "video" && ((m.modelo && extensao(m)) || r.ehClipeDeCena(m.id))) return false;
    // Sem prompt: só se a data confirmar que é nova ou se veio na resposta da própria geração.
    if (!m.prompt) return !!m.criadoEm || r.geradas.has(m.id);
    const outro = normalizar(m.prompt);
    if (outro === prompt || outro.includes(prompt) || prompt.includes(outro)) return true;
    // Com elementos (personagens, referências, voz) o Flow pode guardar o prompt com marcações:
    // aí vale ser uma mídia nova, criada depois do envio.
    return (!!l.personagens?.length || !!l.elementos) && (m.criadoEm ?? 0) >= desde;
  };
  const achadas = r
    .doProjeto(l.projeto)
    .filter((m) => !existentes.has(m.id) && !deOutros.has(m.id) && !l.ids.includes(m.id) && ehVideo(m) === querVideo && combina(m))
    .sort((a, b) => (a.criadoEm ?? 0) - (b.criadoEm ?? 0));
  for (const m of achadas) if (l.ids.length < limite) l.ids.push(m.id);
  return l.ids.map((id) => r.midias.get(id)).filter((m): m is Midia => !!m);
}

/** Mídia de vídeo com status fora dos conhecidos por tempo demais: tratada como falha. */
function falhou(l: Lote, m: Midia): boolean {
  if (!ehVideo(m) || m.status === undefined || m.status === STATUS_PRONTO || STATUS_ANDAMENTO.includes(m.status)) return false;
  l.estranhos ??= {};
  l.estranhos[m.id] ??= Date.now();
  return Date.now() - l.estranhos[m.id] > STATUS_ESTRANHO_MS;
}

function loteConcluido(l: Lote): boolean {
  const resolvidos = Object.keys(l.baixados).length + Object.keys(l.falhas ?? {}).length + (l.perdidas ?? 0);
  if (l.tipo === "extensao") return !!l.cenaBaixada || !!l.clipePronto || resolvidos > 0;
  return resolvidos >= l.quantidade;
}

/** O lote terminou sem nenhum arquivo: tudo falhou ou sumiu. */
const loteFalhou = (l: Lote) => loteConcluido(l) && !Object.keys(l.baixados).length && !l.cenaBaixada && !l.clipePronto;

/**
 * Espera as mídias dos lotes ficarem prontas (dentro do prazo) e baixa o que estiver pronto.
 * A página já está no projeto dos lotes.
 */
export async function acompanhar(p: Page, r: Rastreador, lotes: Lote[], prazo: Prazo, progresso: Progresso): Promise<RelatorioLote[]> {
  const relatorios = new Map<string, RelatorioLote>(
    lotes.map((l) => [l.lote, { lote: l.lote, tipo: l.tipo, custo: l.custo, prompt: l.prompt, estado: "aguardando", arquivos: [], andamento: [], avisos: [] }]),
  );
  let ultimoAviso = 0;
  let ultimaRecarga = Date.now();

  for (;;) {
    let faltaGerar = false;
    for (const l of lotes) {
      if (loteConcluido(l)) continue;
      const rel = relatorios.get(l.lote)!;
      const midias = midiasDoLote(r, l);
      l.historico = Object.fromEntries(midias.map((m) => [m.id, m.historico]));
      // Falhas: status desconhecido que persiste (ex.: bloqueado pela política) não fica esperando.
      for (const m of midias) {
        if (!l.falhas?.[m.id] && falhou(l, m)) {
          (l.falhas ??= {})[m.id] = m.status!;
          rel.avisos.push(`A geração ${m.id} falhou no Flow (código ${m.status}; pode ser bloqueio de política). Confira o saldo com flow_creditos: o Flow costuma devolver os créditos.`);
        }
      }
      // Pedidas que nunca apareceram na lista depois de bastante tempo: perdidas.
      const esperadas = l.tipo === "extensao" ? 1 : l.quantidade;
      const sumiu = SUMIU_MS[l.tipo === "imagem" ? "imagem" : "video"];
      if (midias.length < esperadas && Date.now() - Date.parse(l.criadoEm) > sumiu && (l.perdidas ?? 0) < esperadas - midias.length) {
        l.perdidas = esperadas - midias.length;
        rel.avisos.push(`${l.perdidas} mídia(s) deste pedido nunca apareceram no projeto (o Flow pode ter recusado). Confira com flow_listar e flow_creditos.`);
      }
      const prontas = midias.filter((m) => pronta(m) && !l.falhas?.[m.id]);
      if (!loteConcluido(l) && prontas.length + Object.keys(l.falhas ?? {}).length + (l.perdidas ?? 0) < esperadas) faltaGerar = true;

      if (l.tipo === "extensao") {
        if (prontas.length && l.apenasClipe) {
          // Passo do vídeo longo: o clipe pronto basta; a cena inteira é exportada só no fim.
          l.clipePronto = prontas[0].id;
          continue;
        }
        if (prontas.length && l.cena && !l.cenaBaixada && prazo.sobra(30000)) {
          progresso("Clipe novo pronto. Exportando a cena completa...");
          const titulo = r.midias.get(l.existentes[0])?.titulo ?? l.prompt;
          try {
            const arq = await exportarCena(p, l.projeto, l.cena, titulo, Math.min(120000, prazo.restante() - 5000));
            l.cenaBaixada = arq.caminho;
            rel.arquivos.push(await comPrevia(p, arq, prazo));
          } catch (erro) {
            rel.avisos.push(`Exportação da cena: ${mensagemDeErro(erro)}`);
          }
          await abrirProjeto(p, r, l.projeto); // volta ao projeto para continuar acompanhando
        } else if (prontas.length && !l.cena && !l.cenaBaixada && prazo.sobra(20000)) {
          // A cena não foi identificada no envio: entrega pelo menos o clipe novo e conclui o lote.
          try {
            const arq = await baixarMidia(p, r, prontas[0].id, "original", "_clipe", Math.max(10000, prazo.restante() - 5000));
            l.cenaBaixada = arq.caminho;
            rel.arquivos.push(await comPrevia(p, arq, prazo));
            rel.avisos.push("Não achei a cena (original + continuação); salvei só o clipe novo de 8 s. A cena completa está no Flow, em Cenas.");
          } catch (erro) {
            rel.avisos.push(`Download do clipe: ${mensagemDeErro(erro)}`);
          }
          if (!p.url().endsWith(l.projeto)) await abrirProjeto(p, r, l.projeto);
        }
        continue;
      }

      for (const m of prontas) {
        // Com o link direto já em mãos (imagens), baixar leva 1-2 s; sem ele, é preciso abrir a página.
        const temLink = ehVideo(m) ? !!m.linkVideo : !!m.linkImagem;
        if (l.baixados[m.id] || !prazo.sobra(temLink && l.qualidade === "original" ? 5000 : 15000)) continue;
        progresso(`Baixando ${Object.keys(l.baixados).length + 1}/${l.quantidade}...`);
        const sufixo = l.quantidade > 1 ? `_${l.ids.indexOf(m.id) + 1}` : "";
        try {
          const arq = await baixarMidia(p, r, m.id, l.qualidade, sufixo, Math.max(10000, prazo.restante() - 5000));
          l.baixados[m.id] = arq.caminho;
          rel.arquivos.push(await comPrevia(p, arq, prazo));
        } catch (erro) {
          rel.avisos.push(`Download de ${m.id}: ${mensagemDeErro(erro)}`);
        }
      }
      if (!p.url().endsWith(l.projeto) && !loteConcluido(l)) await abrirProjeto(p, r, l.projeto);
    }

    const pendentes = lotes.filter((l) => !loteConcluido(l));
    // Lote vencido não espera mais nada (uma passada só para baixar o que estiver pronto).
    const todosVencidos = pendentes.every((l) => Date.now() - Date.parse(l.criadoEm) > VALIDADE_LOTE_MS);
    if (!pendentes.length || !faltaGerar || todosVencidos || !prazo.sobra(20000)) break;

    // A página só consulta o status sozinha de tempos em tempos; sem novidade, recarrega.
    if (Date.now() - r.ultimaMudanca > 45000 && Date.now() - ultimaRecarga > 45000) {
      const listas = r.listasRecebidas;
      await p.reload({ waitUntil: "domcontentloaded" });
      conferirPagina(p);
      await r.esperarLista(listas);
      ultimaRecarga = Date.now();
    }
    if (Date.now() - ultimoAviso > 15000) {
      ultimoAviso = Date.now();
      progresso(`Gerando... ${prazo.decorrido()}s`);
    }
    await p.waitForTimeout(3000);
  }

  for (const l of lotes) {
    const rel = relatorios.get(l.lote)!;
    const midias = midiasDoLote(r, l);
    if (loteConcluido(l)) {
      rel.estado = loteFalhou(l) ? "falhou" : "concluido";
      continue;
    }
    rel.estado = Date.now() - Date.parse(l.criadoEm) > VALIDADE_LOTE_MS ? "expirado" : "aguardando";
    rel.andamento = midias.map((m) => `${m.id}: ${pronta(m) ? (l.tipo === "extensao" ? (l.apenasClipe ? "clipe pronto" : "clipe pronto, falta exportar a cena") : "pronto, falta baixar") : descreverStatus(m.status)}`);
    if (midias.length < l.quantidade && l.tipo !== "extensao") rel.andamento.push(`${l.quantidade - midias.length} ainda não apareceram no projeto`);
  }
  return [...relatorios.values()];
}

/** Guarda os lotes não concluídos e registra os concluídos no log. */
export function atualizarPendentes(processados: Lote[], relatorios: RelatorioLote[]): void {
  const ids = new Set(processados.map((l) => l.lote));
  const concluidos: ResultadoLote[] = [];
  const restantes = processados.filter((l) => {
    const rel = relatorios.find((x) => x.lote === l.lote);
    if (rel?.estado === "aguardando") return true;
    concluidos.push({ lote: l.lote, estado: rel?.estado ?? "?", ids: l.ids, cena: l.cena, clipe: l.clipePronto, quando: new Date().toISOString() });
    registrar({
      lote: l.lote, tipo: l.tipo, estado: rel?.estado, prompt: l.prompt, modelo: l.modelo, custo: l.custo,
      projeto: F.urlProjeto(l.projeto), arquivos: Object.values(l.baixados).concat(l.cenaBaixada ?? []),
      status: l.historico, falhas: l.falhas, perdidas: l.perdidas,
    });
    return false;
  });
  alterarLotes((atuais) => [...atuais.filter((l) => !ids.has(l.lote)), ...restantes]);
  guardarResultados(concluidos);
}

export interface ResultadoGeracao {
  lote: string;
  projeto: string;
  configuracao: string;
  custoEstimado: number;
  saldoAntes: number | null;
  saldoDepois: number | null;
  quadros: string[];
  relatorio: RelatorioLote;
  avisos: string[];
}

/** Envia o pedido e espera o Flow reconhecer a geração (ids na lista). */
export async function esperarIds(p: Page, r: Rastreador, l: Lote, prazo: Prazo): Promise<void> {
  const limite = Date.now() + Math.min(45000, Math.max(5000, prazo.restante() - 5000));
  while (Date.now() < limite && midiasDoLote(r, l).length < (l.tipo === "extensao" ? 1 : l.quantidade)) {
    await p.waitForTimeout(1500);
  }
}

/** Confere as gerações pendentes, espera o que der dentro do prazo e baixa o que ficou pronto. */
export function statusFlow(prazo: Prazo, filtro?: string, progresso: Progresso = () => {}): Promise<RelatorioLote[]> {
  return comFlow(prazo, async (p, r) => {
    const lotes = lerLotes().filter((l) => !filtro || l.lote === filtro || l.ids.includes(filtro));
    if (!lotes.length) return [];
    const relatorios: RelatorioLote[] = [];
    const projetos = [...new Set(lotes.map((l) => l.projeto))];
    for (const projeto of projetos) {
      const doProjeto = lotes.filter((l) => l.projeto === projeto);
      if (!prazo.sobra(15000)) {
        // Sem tempo para este projeto: os lotes continuam pendentes (não é "tudo baixado").
        relatorios.push(...doProjeto.map((l) => ({
          lote: l.lote, tipo: l.tipo, custo: l.custo, prompt: l.prompt, estado: "aguardando" as const, arquivos: [],
          andamento: ["não verificado nesta chamada (faltou tempo)"], avisos: [],
        })));
        continue;
      }
      try {
        await abrirProjeto(p, r, projeto);
        const rels = await acompanhar(p, r, doProjeto, prazo, progresso);
        atualizarPendentes(doProjeto, rels);
        relatorios.push(...rels);
      } catch (erro) {
        // Um projeto com problema não pode travar o acompanhamento dos outros.
        relatorios.push(...doProjeto.map((l) => ({
          lote: l.lote, tipo: l.tipo, custo: l.custo, prompt: l.prompt, estado: "aguardando" as const, arquivos: [],
          andamento: [], avisos: [`Não consegui abrir o projeto agora: ${mensagemDeErro(erro)}`],
        })));
      }
    }
    return relatorios;
  });
}
