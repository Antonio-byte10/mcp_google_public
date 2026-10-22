import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PASTA_SAIDAS } from "./config.js";
import { comTravaDeArquivo, gravarJsonAtomico } from "./trava-arquivo.js";
import type { VideoLongo } from "./video-longo.js";

// Estado em disco dos vídeos longos (saidas/videos-longos.json). Todo ciclo ler → alterar → gravar passa
// pela trava do arquivo, porque outra janela do Claude pode estar acompanhando o mesmo vídeo.

export const ARQUIVO = () => path.join(PASTA_SAIDAS, "videos-longos.json");

export function lerVideos(): VideoLongo[] {
  if (!existsSync(ARQUIVO())) return [];
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO(), "utf8"));
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

export function salvarVideos(lista: VideoLongo[]): void {
  // Guarda os 30 mais recentes (os concluídos ficam como histórico).
  gravarJsonAtomico(ARQUIVO(), lista.slice(-30));
}

/** Acrescenta um vídeo sem perder o que outra janela gravou no meio. */
export function acrescentarVideo(v: VideoLongo): void {
  comTravaDeArquivo(ARQUIVO(), () => salvarVideos([...lerVideos(), v]));
}

/** Lê, altera e grava um vídeo (sempre a versão do disco: outra janela pode ter mexido). */
export function alterar(id: string, mudar: (v: VideoLongo) => void): VideoLongo {
  return comTravaDeArquivo(ARQUIVO(), () => {
    const lista = lerVideos();
    const v = lista.find((x) => x.id === id);
    if (!v) throw new Error(`Vídeo longo ${id} não encontrado em ${ARQUIVO()}.`);
    mudar(v);
    salvarVideos(lista);
    return v;
  });
}
