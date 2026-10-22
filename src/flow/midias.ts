// Listagem e download de mídias e exportação de cenas.
import { comPrevia, registrar, type Arquivo } from "../arquivos.js";
import { lerLotes, type Qualidade } from "../pendentes.js";
import { type Prazo } from "../prazo.js";
import { FLOW as F } from "../seletores.js";
import { UUID } from "./base.js";
import { ehVideo, pronta, descreverStatus } from "./rastreador.js";
import { lerCreditos } from "./creditos.js";
import { comFlow } from "./sessao.js";
import { abrirProjeto } from "./projetos.js";
import { baixarMidia, exportarCena } from "./captura.js";

export interface ItemDoProjeto {
  id: string;
  tipo: "video" | "imagem";
  titulo: string;
  estado: string;
  prompt: string;
}

export interface CenaDoProjeto {
  id: string;
  titulo: string;
  /** Clipes na ordem da linha do tempo (cada um ~8 s nos Veo). */
  clipes: { id: string; titulo: string; estado: string }[];
}

export function listarMidias(prazo: Prazo, projeto?: string): Promise<{ projeto: string; itens: ItemDoProjeto[]; cenas: CenaDoProjeto[]; pendentes: number }> {
  return comFlow(prazo, async (p, r) => {
    const id = await abrirProjeto(p, r, projeto);
    // Clipes de cena (cópias e extensões) aparecem dentro da cena, não na lista solta.
    const itens = r
      .doProjeto(id)
      .filter((m) => !r.ehClipeDeCena(m.id))
      .map((m) => ({
        id: m.id,
        tipo: ehVideo(m) ? ("video" as const) : ("imagem" as const),
        titulo: m.titulo ?? "",
        estado: ehVideo(m) ? descreverStatus(m.status) : "pronta",
        prompt: m.prompt ?? "",
      }));
    const cenas = [...r.cenas.keys()].map((c) => ({
      id: c,
      titulo: r.titulosCenas.get(c) ?? "",
      clipes: r.clipesDaCena(c).map((x) => {
        const m = r.midias.get(x.id);
        return { id: x.id, titulo: m?.titulo ?? "", estado: m ? descreverStatus(m.status) : "?" };
      }),
    }));
    return { projeto: F.urlProjeto(id), itens, cenas, pendentes: lerLotes().length };
  });
}

/** Exporta a cena inteira (o Flow junta os clipes no servidor, sem gastar créditos) e salva o MP4. */
export function exportarCenaFinal(prazo: Prazo, projeto: string, cena: string, titulo: string, sufixo: string): Promise<Arquivo> {
  return comFlow(prazo, async (p) => {
    const arq = await exportarCena(p, projeto, cena, titulo, Math.max(15000, Math.min(150000, prazo.restante() - 8000)), sufixo);
    registrar({ download: cena, tipo: "cena", arquivo: arq.caminho });
    return comPrevia(p, arq, prazo);
  });
}

export function baixar(prazo: Prazo, id: string, qualidade: Qualidade, projeto?: string): Promise<Arquivo & { saldoAntes: number | null; saldoDepois: number | null; projeto: string }> {
  return comFlow(prazo, async (p, r) => {
    const alvo = id.match(UUID)?.[0];
    if (!alvo) throw new Error("Informe o id da mídia (aparece em flow_listar).");
    const proj = await abrirProjeto(p, r, projeto);
    const g = r.doProjeto(proj).find((x) => x.id === alvo);
    if (!g) {
      // Pode ser uma cena (vídeo estendido).
      const lote = lerLotes().find((l) => l.cena === alvo);
      const cena = await exportarCena(p, lote?.projeto ?? proj, alvo, lote?.prompt ?? "", Math.min(120000, prazo.restante() - 3000)).catch(() => null);
      if (cena) {
        registrar({ download: alvo, tipo: "cena", arquivo: cena.caminho });
        return { ...(await comPrevia(p, cena, prazo)), saldoAntes: null, saldoDepois: null, projeto: F.urlProjeto(lote?.projeto ?? proj) };
      }
      throw new Error(`${alvo} não está no projeto ${F.urlProjeto(proj)}. Veja flow_listar.`);
    }
    if (!pronta(g)) throw new Error(`O vídeo ${alvo} está ${descreverStatus(g.status)}. Tente de novo mais tarde (flow_status).`);
    // Só o original é o arquivo guardado; nas outras opções confere o saldo antes e depois.
    const saldoAntes = qualidade === "original" ? null : await lerCreditos(p);
    const arq = await baixarMidia(p, r, g.id, qualidade, "", Math.max(10000, prazo.restante() - 8000));
    const saldoDepois = qualidade === "original" ? null : await lerCreditos(p);
    registrar({ download: alvo, qualidade, arquivo: arq.caminho, saldoAntes, saldoDepois });
    return { ...(await comPrevia(p, arq, prazo)), saldoAntes, saldoDepois, projeto: F.urlProjeto(proj) };
  });
}
