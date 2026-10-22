import type { Page } from "playwright";
import { NOMES_TIPO, type FormatoBaixar, type ItemEstudio } from "./tipos.js";
import type { Prazo } from "../prazo.js";
import { comPrevia, dimensoesImagem, inspecionarMp4, nomeArquivo, salvarNotebook, tamanhoMB, type Arquivo } from "../arquivos.js";
import { acharTabela, baixarDoGoogle, celulaMd, csv, dadosDoApp, decodificarHtml, documentoParaMd, linkDaLista, mapaParaMd, testeParaMd, type Cartao, type NoMapa, type Questao } from "./conversores.js";
import { extensaoDaImagem } from "../seguranca.js";
import { textoDosSegmentos } from "../notebook-base.js";

// Salvar o resultado de cada tipo de item do Estúdio na pasta de saídas.

export async function salvarItem(p: Page, item: ItemEstudio, baixar: FormatoBaixar | undefined, prazo: Prazo): Promise<{ arquivos: Arquivo[]; texto?: string; avisos: string[] }> {
  const a = item.registro;
  const arquivos: Arquivo[] = [];
  const avisos: string[] = [];
  const via = "NotebookLM";
  const doc = (caminho: string, tipo: Arquivo["tipo"] = "documento"): Arquivo => ({ caminho, id: item.id, tipo, via, tamanhoMB: tamanhoMB(caminho) });
  const titulo = item.titulo || NOMES_TIPO[item.tipo];

  switch (item.tipo) {
    case "audio":
    case "video": {
      const lista = item.tipo === "audio" ? (a[6] as unknown[])?.[5] : (a[8] as unknown[])?.[4];
      const b = await baixarDoGoogle(p, linkDaLista(lista, 4, 1), prazo);
      if (b.subarray(4, 8).toString() !== "ftyp") throw new Error("O arquivo baixado não é um MP4/M4A válido.");
      const caminho = salvarNotebook(nomeArquivo(titulo, item.tipo === "audio" ? "m4a" : "mp4"), b);
      const m = inspecionarMp4(caminho);
      const arq: Arquivo = { caminho, id: item.id, tipo: item.tipo, via, tamanhoMB: m.tamanhoMB, duracao: m.duracao || item.duracao, largura: m.largura || undefined, altura: m.altura || undefined, audio: item.tipo === "video" ? m.audio : undefined };
      arquivos.push(item.tipo === "video" ? await comPrevia(p, arq, prazo) : arq);
      return { arquivos, avisos };
    }
    case "slides": {
      const s = (a[16] ?? []) as unknown[];
      const slides = (s[2] ?? []) as unknown[][];
      const md = [`# ${titulo}`, "", ...slides.flatMap((sl, i) => [`## Slide ${i + 1}`, "", String(sl[2] ?? "").trim(), ""])].join("\n");
      const quer = baixar ?? "pdf";
      if (quer === "pdf" || quer === "pdf_pptx") {
        const b = await baixarDoGoogle(p, s[3], prazo);
        if (b.subarray(0, 5).toString() !== "%PDF-") throw new Error("O PDF baixado não é válido.");
        arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "pdf"), b)));
      }
      if (quer === "pptx" || quer === "pdf_pptx") {
        const b = await baixarDoGoogle(p, s[4], prazo);
        if (b[0] !== 0x50 || b[1] !== 0x4b) throw new Error("O PPTX baixado não é válido.");
        arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "pptx"), b)));
      }
      if (quer === "imagens") {
        for (const [i, sl] of slides.entries()) {
          if (!prazo.sobra(8000)) {
            avisos.push(`O tempo acabou depois de ${i} de ${slides.length} slides; baixe o resto com notebook_estudio_baixar.`);
            break;
          }
          const b = await baixarDoGoogle(p, (sl[0] as unknown[])?.[0], prazo);
          const ext = extensaoDaImagem(b);
          if (!ext) throw new Error("A imagem do slide não é PNG/JPEG/WebP.");
          const caminho = salvarNotebook(nomeArquivo(titulo, ext, `_slide${String(i + 1).padStart(2, "0")}`), b);
          const arq: Arquivo = { ...doc(caminho, "imagem"), ...dimensoesImagem(b) };
          arquivos.push(i === 0 ? await comPrevia(p, arq, prazo) : arq);
        }
      }
      arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "md", "_texto"), md)));
      return { arquivos, texto: md, avisos };
    }
    case "relatorio": {
      const md = (a[7] as unknown[])?.[0];
      if (typeof md === "string" && md.trim()) {
        arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "md"), md)));
        return { arquivos, texto: md, avisos };
      }
      const documento = documentoParaMd(a);
      if (documento) {
        const texto = `# ${titulo}\n\n${documento}`;
        arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "md"), texto)));
        avisos.push("Relatório interativo: o texto foi salvo em .md; as partes interativas (testes, cartões…) só funcionam no NotebookLM.");
        return { arquivos, texto, avisos };
      }
      // Outro formato de mini-app: guarda a página e o texto que dá para tirar dela.
      const { html } = await dadosDoApp(p, item.id);
      const caminho = salvarNotebook(nomeArquivo(titulo, "html"), html);
      arquivos.push(doc(caminho));
      const texto = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      avisos.push("Relatório interativo: salvei a página .html (abra no navegador); o texto abaixo é só o conteúdo extraído.");
      return { arquivos, texto: decodificarHtml(texto), avisos };
    }
    case "mapa_mental": {
      const { dados } = await dadosDoApp(p, item.id);
      const md = `# ${titulo}\n\n${mapaParaMd(dados as NoMapa)}`;
      arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "md"), md)), doc(salvarNotebook(nomeArquivo(titulo, "json"), JSON.stringify(dados, null, 2))));
      return { arquivos, texto: md, avisos };
    }
    case "cartoes": {
      const { dados } = await dadosDoApp(p, item.id);
      const cartoes = ((dados as { flashcards?: Cartao[] })?.flashcards ?? []).map((c) => ({ frente: String(c.f ?? ""), verso: String(c.b ?? "") }));
      const md = [`# ${titulo}`, "", ...cartoes.flatMap((c, i) => [`## ${i + 1}. ${c.frente}`, "", c.verso, ""])].join("\n");
      arquivos.push(
        doc(salvarNotebook(nomeArquivo(titulo, "md"), md)),
        doc(salvarNotebook(nomeArquivo(titulo, "csv"), csv([["frente", "verso"], ...cartoes.map((c) => [c.frente, c.verso])]))),
      );
      return { arquivos, texto: md, avisos };
    }
    case "teste": {
      const { dados } = await dadosDoApp(p, item.id);
      const questoes = (dados as { quiz?: Questao[] })?.quiz ?? [];
      const md = testeParaMd(titulo, questoes);
      arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "md"), md)), doc(salvarNotebook(nomeArquivo(titulo, "json"), JSON.stringify(dados, null, 2))));
      return { arquivos, texto: md, avisos };
    }
    case "infografico": {
      const entrada = (((a[14] as unknown[])?.[2] as unknown[])?.[0] ?? []) as unknown[];
      const b = await baixarDoGoogle(p, (entrada[1] as unknown[])?.[0], prazo);
      const ext = extensaoDaImagem(b);
      if (!ext) throw new Error("O infográfico baixado não é PNG/JPEG/WebP.");
      const arq: Arquivo = { ...doc(salvarNotebook(nomeArquivo(titulo, ext), b), "imagem"), ...dimensoesImagem(b) };
      arquivos.push(await comPrevia(p, arq, prazo));
      const texto = typeof entrada[3] === "string" ? entrada[3] : undefined;
      return { arquivos, texto, avisos };
    }
    case "tabela": {
      const linhas = acharTabela(a[18]);
      if (!linhas) throw new Error("A tabela não veio no formato esperado.");
      const celulas = linhas.map((l) => l.map((c) => textoDosSegmentos(c).join("").trim()));
      const [cab, ...corpo] = celulas;
      const md = [`# ${titulo}`, "", `| ${cab.map(celulaMd).join(" | ")} |`, `| ${cab.map(() => "---").join(" | ")} |`, ...corpo.map((l) => `| ${l.map(celulaMd).join(" | ")} |`)].join("\n");
      arquivos.push(doc(salvarNotebook(nomeArquivo(titulo, "csv"), csv(celulas))), doc(salvarNotebook(nomeArquivo(titulo, "md"), md)));
      return { arquivos, texto: md, avisos };
    }
    default:
      throw new Error("Tipo de item que o MCP ainda não sabe baixar.");
  }
}
