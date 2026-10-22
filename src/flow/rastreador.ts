// Leitura dos dados que a própria página do Flow recebe (lista de mídias, status, cenas, saldo).
import { type Page, type Request, type Response } from "playwright";
import { FLOW as F } from "../seletores.js";
import { ehUuid } from "./base.js";

export const STATUS_PRONTO = 3;

// ---------- Leitura dos dados que a página recebe ----------

export interface Midia {
  id: string; // id da página da mídia (/edit/<id>); é o id usado nas ferramentas
  mediaId: string;
  projeto: string;
  prompt?: string;
  status?: number; // só vídeos: 3 = pronto; 6/2 = em andamento
  historico: number[];
  titulo?: string;
  linkVideo?: string;
  linkImagem?: string; // num vídeo, é a miniatura; numa imagem, é o arquivo original
  miniatura?: string; // trecho do endereço da miniatura (identifica a imagem no seletor de quadros)
  modelo?: string;
  /** Quando o Flow criou a mídia (segundos desde 1970). */
  criadoEm?: number;
}

export const ehVideo = (m: Midia) => m.status !== undefined || !!m.linkVideo || !!m.modelo;
export const pronta = (m: Midia) => (ehVideo(m) ? m.status === STATUS_PRONTO : true);

/** Prompt original (em português) dentro do registro da mídia. */
function promptOriginal(info: unknown[]): string | undefined {
  if (typeof info[1] === "string") return info[1];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (info[6] as any)?.[2]?.[0]?.[2]?.[0]?.[0]?.[0];
  return typeof p === "string" ? p : undefined;
}

/** Escuta as respostas que a própria página do Flow recebe e monta a lista de mídias e status. */
export class Rastreador {
  midias = new Map<string, Midia>();
  saldo: number | null = null;
  listasRecebidas = 0;
  imagensRecebidas = 0;
  /** Mídias que chegaram na resposta da geração de imagem (vêm sem prompt nem data). */
  geradas = new Set<string>();
  errosImagem: string[] = [];
  cena: string | null = null;
  /** Pedidos de geração de extensão que saíram da página (fZytfe) e os clipes confirmados na resposta. */
  extensoesPedidas = 0;
  extensoesConfirmadas: string[] = [];
  /** Cenas do projeto (lista Zzl0ze): id da cena → (id do clipe → posição na linha do tempo). */
  cenas = new Map<string, Map<string, number>>();
  titulosCenas = new Map<string, string>();
  projetoAtual = "";
  ultimaMudanca = Date.now();
  private titulos = new Map<string, string>();
  private links = new Map<string, { video?: string; imagem?: string }>(); // mediaId → links diretos
  private ouvinte = (r: Response) => void this.ler(r);
  private ouvintePedido = (q: Request) => {
    if (F.rpcGerarExtensao.test(q.url())) this.extensoesPedidas++;
  };

  constructor(private p: Page) {
    p.on("response", this.ouvinte);
    p.on("request", this.ouvintePedido);
  }

  parar() {
    this.p.off("response", this.ouvinte);
    this.p.off("request", this.ouvintePedido);
  }

  doProjeto(projeto: string): Midia[] {
    return [...this.midias.values()].filter((g) => g.projeto === projeto);
  }

  /** Clipes da cena na ordem da linha do tempo. */
  clipesDaCena(cena: string): { id: string; posicao: number }[] {
    return [...(this.cenas.get(cena) ?? [])].map(([id, posicao]) => ({ id, posicao })).sort((a, b) => a.posicao - b.posicao);
  }

  /** O id é de um clipe que está dentro de alguma cena (cópia ou clipe de extensão). */
  ehClipeDeCena(id: string): boolean {
    for (const clipes of this.cenas.values()) if (clipes.has(id)) return true;
    return false;
  }

  /** Espera a lista do projeto chegar depois de abrir ou recarregar a página. */
  async esperarLista(desde: number, timeout = 15000): Promise<boolean> {
    const fim = Date.now() + timeout;
    while (Date.now() < fim) {
      if (this.listasRecebidas > desde) return true;
      await this.p.waitForTimeout(300);
    }
    return false;
  }

  private async ler(r: Response) {
    if (!F.rpcDados.test(r.url())) return;
    let corpo: string;
    try {
      corpo = await r.text();
    } catch {
      return;
    }
    const ehImagem = F.rpcImagem.test(r.url());
    for (const linha of corpo.split("\n")) {
      if (!linha.startsWith("[[")) continue;
      try {
        for (const e of JSON.parse(linha) as unknown[][]) {
          if (e[0] !== "wrb.fr") continue;
          if (typeof e[2] !== "string") {
            // Erro do servidor (ex.: pedido bloqueado pela política de conteúdo).
            if (e[1] === "ogiZ0b") this.errosImagem.push(JSON.stringify(e.slice(3, 6)));
            continue;
          }
          const dados = JSON.parse(e[2]);
          if (e[1] === "jwpduf" && Array.isArray(dados) && typeof dados[1] === "number") this.saldo = dados[1];
          if (e[1] === "rqZuUc" && ehUuid(dados?.[0]?.[0])) this.cena = dados[0][0];
          if (e[1] === "fZytfe") {
            if (typeof dados?.[1] === "number") this.saldo = dados[1];
            const clipe = dados?.[2]?.[0]?.[0];
            if (ehUuid(clipe)) this.extensoesConfirmadas.push(clipe);
          }
          const antes = ehImagem ? new Set(this.midias.keys()) : null;
          this.procurar(dados);
          if (antes) for (const k of this.midias.keys()) if (!antes.has(k)) this.geradas.add(k);
        }
      } catch {
        // Formato inesperado: ignora esta resposta.
      }
    }
    for (const g of this.midias.values()) {
      g.titulo ??= this.titulos.get(g.id);
      const l = this.links.get(g.mediaId);
      if (l?.video) g.linkVideo = l.video;
      if (l?.imagem) g.linkImagem = l.imagem;
    }
    if (F.rpcLista.test(r.url())) this.listasRecebidas++;
    if (ehImagem) this.imagensRecebidas++;
  }

  private procurar(no: unknown) {
    if (!Array.isArray(no)) return;
    // Mídia: [mediaId, projeto, id, null, null, info]. Na resposta da geração de imagem o
    // projeto vem null e não há info: [mediaId, null, id, null, null, null, [...], null, [w, h]].
    const [a, b, c, d, e, info] = no;
    if (ehUuid(a) && (ehUuid(b) || b === null) && ehUuid(c) && d == null && e == null && (Array.isArray(info) || info == null)) {
      const atual = this.midias.get(c);
      const historico = atual?.historico ?? [];
      let status: number | undefined;
      let prompt: string | undefined;
      let miniatura: string | undefined;
      let modelo: string | undefined;
      let criadoEm: number | undefined;
      if (Array.isArray(info)) {
        if (Array.isArray(info[0]) && typeof info[0][0] === "number") criadoEm = info[0][0];
        status = Array.isArray(info[8]) && typeof info[8][0] === "number" ? info[8][0] : undefined;
        prompt = promptOriginal(info);
        if (typeof info[5] === "string" && info[5].includes("/asb/")) miniatura = info[5].split("/asb/")[1].slice(0, 40);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = (info[6] as any)?.[1]?.[0]?.[0];
        if (typeof m === "string") modelo = m;
      }
      if (status !== undefined && historico[historico.length - 1] !== status) {
        historico.push(status);
        this.ultimaMudanca = Date.now();
      }
      this.midias.set(c, {
        ...atual,
        id: c,
        mediaId: a,
        projeto: (b as string | null) ?? atual?.projeto ?? this.projetoAtual,
        prompt: prompt ?? atual?.prompt,
        status: status ?? atual?.status,
        miniatura: miniatura ?? atual?.miniatura,
        modelo: modelo ?? atual?.modelo,
        criadoEm: criadoEm ?? atual?.criadoEm,
        historico,
      });
    }
    // Item do projeto: [id, null, null, [título, [ts], null, null, mediaId, ...], projeto]
    if (ehUuid(no[0]) && Array.isArray(no[3]) && typeof no[3][0] === "string" && ehUuid(no[4])) {
      this.titulos.set(no[0], no[3][0]);
    }
    // Cena: [id, título, null, [criada], [alterada], ...] (lista do projeto, posição 4).
    if (ehUuid(no[0]) && typeof no[1] === "string" && no[2] === null && Array.isArray(no[3]) && typeof no[3][0] === "number" && Array.isArray(no[4])) {
      this.titulosCenas.set(no[0], no[1]);
      if (!this.cenas.has(no[0])) this.cenas.set(no[0], new Map());
    }
    // Clipe de uma cena: [[id, null, null, [título, ...], projeto], cena, [posição (null = 0), ...]].
    // O clipe é uma cópia da mídia, com id próprio; o clipe de uma extensão é a própria mídia nova.
    if (no.length === 3 && Array.isArray(no[0]) && ehUuid(no[0][0]) && ehUuid(no[1]) && Array.isArray(no[2]) && (no[2][0] === null || typeof no[2][0] === "number")) {
      const clipes = this.cenas.get(no[1]) ?? new Map<string, number>();
      clipes.set(no[0][0], (no[2][0] as number | null) ?? 0);
      this.cenas.set(no[1], clipes);
    }
    for (const filho of no) {
      // Link direto (assinado) do arquivo original; só vem limpo depois de decodificar o JSON.
      if (typeof filho === "string") {
        const m = filho.match(F.linkDireto);
        if (m) {
          const l = this.links.get(m[2]) ?? {};
          if (m[1] === "video") l.video = filho;
          else l.imagem = filho;
          this.links.set(m[2], l);
        }
      } else {
        this.procurar(filho);
      }
    }
  }
}

export const descreverStatus = (s?: number) =>
  s === STATUS_PRONTO ? "pronto" : s === 2 ? "gerando" : s === 6 ? "na fila" : `status ${s ?? "?"} (pode ser falha; confira no Flow)`;
