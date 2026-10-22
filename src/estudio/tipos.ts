import { NOTEBOOK as S, type TipoEstudio } from "../seletores.js";
import { CTX_ESTUDIO, chamarRpc, dataCurta, dataDoCarimbo } from "../notebook-base.js";
import type { Page } from "playwright";
import type { Arquivo } from "../arquivos.js";

// Tipos e leitura dos itens do Estúdio (a lista vem das leituras internas do NotebookLM).

export const NOMES_TIPO: Record<TipoEstudio | "desconhecido", string> = {
  audio: "Resumo em Áudio", video: "Resumo em Vídeo", slides: "Apresentação de slides", mapa_mental: "Mapa mental", relatorio: "Relatório",
  cartoes: "Cartões didáticos", teste: "Teste", infografico: "Infográfico", tabela: "Tabela de dados", desconhecido: "item",
};

export interface ItemEstudio {
  id: string;
  titulo: string;
  tipo: TipoEstudio | "desconhecido";
  /** 1-2 = gerando, 3 = pronto; outros = falhou. */
  status: number;
  duracao?: number;
  criadoEm?: Date;
  registro: unknown[];
}

export const pronto = (i: ItemEstudio) => i.status === 3;
export const gerando = (i: ItemEstudio) => i.status === 1 || i.status === 2;

export function tipoDoRegistro(a: unknown[]): TipoEstudio | "desconhecido" {
  switch (a[2]) {
    case 1: return "audio";
    case 2: // relatório documento
    case 11: // relatório interativo
      return "relatorio";
    case 3: return "video";
    case 7: return "infografico";
    case 8: return "slides";
    case 9: return "tabela";
    case 4: {
      // Mini-apps: o subtipo diz qual é (1 cartões, 2 teste, 4 mapa mental).
      const sub = ((a[9] as unknown[])?.[1] as unknown[])?.[0];
      return sub === 1 ? "cartoes" : sub === 2 ? "teste" : sub === 4 ? "mapa_mental" : "desconhecido";
    }
    default: return "desconhecido";
  }
}

export function lerItem(a: unknown[]): ItemEstudio {
  const tipo = tipoDoRegistro(a);
  const segundos = (v: unknown) => (Array.isArray(v) && typeof v[0] === "number" ? v[0] + (Number(v[1]) || 0) / 1e9 : undefined);
  const duracao = tipo === "audio" ? segundos((a[6] as unknown[])?.[6]) : tipo === "video" ? segundos((a[8] as unknown[])?.[5]) : undefined;
  return {
    id: String(a[0]),
    titulo: String(a[1] ?? ""),
    tipo,
    status: Number(a[4] ?? 0),
    duracao: duracao ? Math.round(duracao) : undefined,
    criadoEm: dataDoCarimbo(a[15]) ?? dataDoCarimbo(a[10]),
    registro: a,
  };
}

export async function itensDoEstudio(p: Page, notebook: string): Promise<ItemEstudio[]> {
  const dados = await chamarRpc<unknown[]>(p, S.rpc.estudio, [CTX_ESTUDIO, notebook, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"']);
  return ((dados?.[0] ?? []) as unknown[][]).map(lerItem);
}

export const estadoDoItem = (i: ItemEstudio) => (pronto(i) ? "pronto" : gerando(i) ? "gerando" : `falhou (código ${i.status})`);
export const minutos = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}min${String(s % 60).padStart(2, "0")}s` : `${s}s`);

export function descreverItem(i: ItemEstudio): string {
  const extras = [estadoDoItem(i), i.duracao ? minutos(i.duracao) : "", dataCurta(i.criadoEm), `id ${i.id}`].filter(Boolean);
  return `- [${NOMES_TIPO[i.tipo]}] ${i.titulo} (${extras.join(" · ")})`;
}


export type FormatoBaixar = "pdf" | "pptx" | "pdf_pptx" | "imagens";

export interface LoteEstudio {
  lote: string;
  notebook: string;
  item: string;
  tipo: TipoEstudio;
  baixar?: FormatoBaixar;
  criadoEm: string;
}

export interface RelatorioItem {
  lote: LoteEstudio;
  estado: "pronto" | "aguardando" | "falhou" | "sumiu" | "expirado";
  item?: ItemEstudio;
  arquivos: Arquivo[];
  texto?: string;
  avisos: string[];
}
