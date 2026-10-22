// Visualizador que aparece dentro do chat do Claude Desktop (extensão MCP Apps, ui://).
// Mostra a prévia de cada arquivo salvo (imagem, vídeo, áudio, documento) e tem os botões Baixar,
// Assistir/Ouvir e Abrir no Flow/NotebookLM.
//
// É uma página única, sem bibliotecas externas (o app bloqueia scripts de fora). Fala com o
// Claude Desktop por postMessage (JSON-RPC), seguindo a especificação MCP Apps 2026-01-26:
//   ui/initialize → ui/notifications/initialized → recebe ui/notifications/tool-result
//   tools/call flow_arquivo (busca o arquivo inteiro) → ui/download-file (o app salva)
// No Claude Code, que não desenha esta página, a resposta continua tendo texto + miniaturas.

export const URI_VISUALIZADOR = "ui://mcp-google/visualizador";
export const MIME_APP = "text/html;profile=mcp-app";

export const HTML_VISUALIZADOR = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mcp-google</title>
<style>
  :root {
    --fundo: #ffffff; --cartao: #f6f6f4; --borda: #e2e1dc; --texto: #1f1e1b; --suave: #6b6a65;
    --botao: #1f1e1b; --botao-texto: #ffffff; --botao2: #ebeae6; --erro: #b42318; --ok: #2f7d32;
    color-scheme: light;
  }
  :root[data-tema="dark"] {
    --fundo: #1f1e1d; --cartao: #2a2927; --borda: #3a3936; --texto: #f2f1ed; --suave: #a8a69f;
    --botao: #f2f1ed; --botao-texto: #1f1e1d; --botao2: #3a3936; --erro: #ff8a80; --ok: #81c784;
    color-scheme: dark;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="light"]) {
      --fundo: #1f1e1d; --cartao: #2a2927; --borda: #3a3936; --texto: #f2f1ed; --suave: #a8a69f;
      --botao: #f2f1ed; --botao-texto: #1f1e1d; --botao2: #3a3936; --erro: #ff8a80; --ok: #81c784;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--fundo); color: var(--texto);
    font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { padding: 12px; }
  .topo { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 2px 10px; }
  .topo h1 { font-size: 14px; font-weight: 600; margin: 0; }
  .topo .info { color: var(--suave); font-size: 12px; }
  .grade { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .grade.um { grid-template-columns: minmax(0, 460px); }
  .cartao { background: var(--cartao); border: 1px solid var(--borda); border-radius: 12px; overflow: hidden;
    display: flex; flex-direction: column; }
  .midia { background: #00000010; display: flex; align-items: center; justify-content: center; position: relative; }
  .midia img, .midia video { display: block; width: 100%; max-height: 420px; object-fit: contain; }
  .midia audio { display: block; width: 100%; margin: 40px 0; }
  .selo { position: absolute; left: 8px; top: 8px; background: #000000b3; color: #fff; font-size: 11px;
    padding: 2px 7px; border-radius: 999px; }
  .corpo { padding: 9px 10px 10px; display: flex; flex-direction: column; gap: 8px; }
  .nome { font-size: 12px; color: var(--suave); word-break: break-all; }
  .botoes { display: flex; flex-wrap: wrap; gap: 6px; }
  button { font: inherit; font-size: 13px; border: 0; border-radius: 8px; padding: 6px 11px; cursor: pointer;
    background: var(--botao2); color: var(--texto); }
  button.principal { background: var(--botao); color: var(--botao-texto); font-weight: 600; }
  button:disabled { opacity: .55; cursor: default; }
  .estado { font-size: 12px; min-height: 1em; }
  .estado.erro { color: var(--erro); }
  .estado.ok { color: var(--ok); }
  .caminho { font: 11px/1.4 ui-monospace, Consolas, monospace; color: var(--suave); user-select: all; word-break: break-all; }
  .vazio { color: var(--suave); white-space: pre-wrap; font-size: 13px; padding: 4px 2px; }
  .midia.doc { display: block; background: var(--fundo); }
  .midia.doc .selo { left: auto; right: 14px; }
  .texto { max-height: 340px; overflow: auto; padding: 10px 12px 26px; font-size: 12.5px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word; }
  .texto.tabela { font: 11.5px/1.45 ui-monospace, Consolas, monospace; white-space: pre; }
  .texto .t-h { font-weight: 650; font-size: 13.5px; margin: 8px 0 2px; }
  .texto .t-h:first-child { margin-top: 0; }
  .texto .t-l { min-height: 1em; }
</style>
</head>
<body>
<main>
  <div class="topo"><h1 id="titulo">mcp-google</h1><span class="info" id="info">carregando…</span></div>
  <div class="grade" id="grade"></div>
  <div class="vazio" id="vazio" hidden></div>
  <div class="vazio" id="andamento" hidden></div>
</main>
<script>
(() => {
  "use strict";
  const VERSAO_PROTOCOLO = "2026-01-26";
  let proximoId = 1;
  const esperando = new Map();
  let capacidades = {};
  let ultimoResultado = null;
  const cache = new Map(); // nome do arquivo → { mime, blob }

  const $ = (id) => document.getElementById(id);

  function enviar(method, params) {
    const id = proximoId++;
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    return new Promise((ok, falha) => {
      esperando.set(id, { ok, falha });
      setTimeout(() => {
        if (esperando.has(id)) { esperando.delete(id); falha(new Error("O app não respondeu a tempo.")); }
      }, 180000);
    });
  }
  function notificar(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method, params: params || {} }, "*");
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window.parent) return;
    const m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && !m.method) {
      const p = esperando.get(m.id);
      if (!p) return;
      esperando.delete(m.id);
      if (m.error) p.falha(new Error(m.error.message || "erro")); else p.ok(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") mostrar(m.params);
    else if (m.method === "ui/notifications/host-context-changed") aplicarContexto(m.params);
    if (m.id !== undefined && m.method) {
      // Pedidos do app para a página (ex.: ui/resource-teardown): só confirma.
      window.parent.postMessage({ jsonrpc: "2.0", id: m.id, result: {} }, "*");
    }
  });

  function aplicarContexto(ctx) {
    if (!ctx) return;
    if (ctx.theme === "dark" || ctx.theme === "light") document.documentElement.dataset.tema = ctx.theme;
  }

  function avisarTamanho() {
    notificar("ui/notifications/size-changed", { height: Math.ceil(document.documentElement.scrollHeight) });
  }
  new ResizeObserver(avisarTamanho).observe(document.body);

  function detalhes(a) {
    const partes = [];
    if (a.tipo !== "imagem" && a.duracao) partes.push(Math.round(a.duracao) + "s");
    if (a.largura) partes.push(a.largura + "×" + a.altura);
    if (a.tamanhoMB) partes.push(a.tamanhoMB >= 1 ? a.tamanhoMB.toFixed(2) + " MB" : Math.max(1, Math.round(a.tamanhoMB * 1024)) + " KB");
    return partes.join(" · ");
  }

  function rotuloTipo(a) {
    if (a.tipo === "imagem") return "imagem";
    if (a.tipo === "cena") return "cena";
    if (a.tipo === "audio") return "áudio";
    if (a.tipo === "documento") return (a.nome.split(".").pop() || "arquivo").toUpperCase();
    return "vídeo";
  }

  function texto(resultado) {
    return (resultado.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\\n");
  }

  function mostrar(resultado) {
    ultimoResultado = resultado;
    const dados = resultado.structuredContent || {};
    const arquivos = Array.isArray(dados.arquivos) ? dados.arquivos : [];
    const grade = $("grade");
    grade.textContent = "";
    grade.classList.toggle("um", arquivos.length === 1);
    $("titulo").textContent = arquivos.length
      ? (arquivos.length === 1 ? "1 arquivo salvo" : arquivos.length + " arquivos salvos")
      : (resultado.isError ? "Erro" : "Em andamento");
    $("info").textContent = dados.pasta ? "pasta: " + dados.pasta : "";
    const vazio = $("vazio");
    vazio.hidden = arquivos.length > 0;
    if (!arquivos.length) vazio.textContent = texto(resultado) || "Nada para mostrar.";

    for (const a of arquivos) {
      const cartao = document.createElement("div");
      cartao.className = "cartao";
      const midia = document.createElement("div");
      midia.className = "midia";
      const bloco = typeof a.previa === "number" ? (resultado.content || [])[a.previa] : null;
      if (typeof a.texto === "string" && a.texto) {
        // Prévia de documento (.md/.csv): só texto (textContent), nada vira HTML.
        midia.classList.add("doc");
        const caixa = document.createElement("div");
        caixa.className = "texto" + (/\\.csv$/i.test(a.nome) ? " tabela" : "");
        if (caixa.classList.contains("tabela")) caixa.textContent = a.texto;
        else {
          let codigo = false;
          for (const linha of a.texto.split("\\n")) {
            if (/^\`\`\`/.test(linha)) { codigo = !codigo; continue; }
            const el = document.createElement("div");
            const titulo = !codigo && /^#{1,6}\\s/.test(linha);
            el.className = titulo ? "t-h" : "t-l";
            el.textContent = codigo ? linha : linha.replace(/^#{1,6}\\s+/, "").replace(/\\*\\*/g, "");
            caixa.appendChild(el);
          }
        }
        midia.appendChild(caixa);
      } else if (bloco && bloco.type === "image") {
        const img = document.createElement("img");
        img.alt = a.nome;
        img.src = "data:" + (bloco.mimeType || "image/jpeg") + ";base64," + bloco.data;
        img.addEventListener("load", avisarTamanho);
        midia.appendChild(img);
      } else {
        midia.style.minHeight = "120px";
        midia.textContent = a.tipo === "audio" ? "🎧 áudio" : a.tipo === "documento" ? "📄 " + rotuloTipo(a) : "sem prévia";
      }
      const selo = document.createElement("span");
      selo.className = "selo";
      selo.textContent = rotuloTipo(a);
      midia.appendChild(selo);

      const corpo = document.createElement("div");
      corpo.className = "corpo";
      const nome = document.createElement("div");
      nome.className = "nome";
      nome.textContent = a.nome + (detalhes(a) ? "  ·  " + detalhes(a) : "");
      const botoes = document.createElement("div");
      botoes.className = "botoes";
      const estado = document.createElement("div");
      estado.className = "estado";

      const baixar = document.createElement("button");
      baixar.className = "principal";
      baixar.textContent = "Baixar";
      baixar.onclick = () => acaoBaixar(a, baixar, estado, cartao);
      botoes.appendChild(baixar);

      if (a.mime === "video/mp4" || a.mime === "audio/mp4") {
        const assistir = document.createElement("button");
        assistir.textContent = a.mime === "audio/mp4" ? "Ouvir" : "Assistir";
        assistir.onclick = () => acaoAssistir(a, assistir, estado, midia);
        botoes.appendChild(assistir);
      }
      const link = dados.link || (dados.projeto ? { url: dados.projeto, rotulo: "Abrir no Flow" } : null);
      // Só abre páginas do próprio Google (defesa extra: o endereço vem dos dados da ferramenta).
      // Dentro deste template do TypeScript, "\\/" vira "\/" na página (com uma barra só, a regex
      // virava comentário e a página quebrava em toda resposta com link: bug da 0.7.0 à 0.9.0).
      const linkSeguro = link && /^https:\\/\\/(notebook|flow)\\.google\\.com\\//.test(link.url);
      if (linkSeguro && capacidades.openLinks) {
        const abrir = document.createElement("button");
        abrir.textContent = link.rotulo;
        abrir.onclick = () => enviar("ui/open-link", { url: link.url }).catch(() => {});
        botoes.appendChild(abrir);
      }
      // Caminho no PC sempre à vista (dá para selecionar e copiar), mesmo sem usar os botões.
      const caminho = document.createElement("div");
      caminho.className = "caminho";
      caminho.title = "Onde o arquivo está salvo neste PC";
      caminho.textContent = a.caminho;
      corpo.append(nome, caminho, botoes, estado);
      cartao.append(midia, corpo);
      grade.appendChild(cartao);
    }
    const andamento = $("andamento");
    andamento.hidden = !(arquivos.length && dados.andamento);
    andamento.textContent = dados.andamento || "";
    avisarTamanho();
  }

  // O arquivo vem em partes (o MCP não aceita mensagens acima de 10 MB); cada parte tem um
  // número de bytes múltiplo de 3, então os pedaços em base64 podem ser emendados direto.
  async function buscarArquivo(a, estado) {
    if (cache.has(a.nome)) return cache.get(a.nome);
    const pedacos = [];
    let mime = a.mime;
    let versao;
    for (let parte = 0, partes = 1; parte < partes && parte < 10; parte++) {
      if (estado && partes > 1) estado.textContent = "Preparando o arquivo… (" + (parte + 1) + " de " + partes + ")";
      const r = await enviar("tools/call", { name: "flow_arquivo", arguments: { nome: a.nome, parte } });
      if (!r || r.isError) throw new Error(texto(r || {}) || "Não consegui ler o arquivo.");
      const recurso = (r.content || []).find((c) => c.type === "resource" && c.resource && c.resource.blob);
      if (!recurso) throw new Error("O arquivo não veio na resposta.");
      mime = recurso.resource.mimeType || mime;
      pedacos.push(recurso.resource.blob);
      const info = r.structuredContent || {};
      if (versao !== undefined && info.versao !== versao) throw new Error("O arquivo mudou enquanto era lido; tente de novo.");
      versao = info.versao;
      partes = Math.min(10, info.partes || 1);
    }
    const arq = { mime, blob: pedacos.join("") };
    cache.set(a.nome, arq);
    return arq;
  }

  function mostrarCaminho(a, estado, cartao) {
    if (cartao.querySelector(".caminho")) return;
    const c = document.createElement("div");
    c.className = "caminho";
    c.textContent = a.caminho;
    estado.after(c);
  }

  async function acaoBaixar(a, botao, estado, cartao) {
    botao.disabled = true;
    estado.className = "estado";
    estado.textContent = "Preparando o arquivo…";
    try {
      const arq = await buscarArquivo(a, estado);
      if (capacidades.downloadFile) {
        const r = await enviar("ui/download-file", {
          contents: [{ type: "resource", resource: { uri: "file:///" + a.nome, mimeType: arq.mime, blob: arq.blob } }],
        });
        if (r && r.isError) throw new Error("O download foi cancelado ou o app não permitiu.");
      } else {
        // App sem download: tenta pelo navegador da própria página.
        const link = document.createElement("a");
        link.href = "data:" + arq.mime + ";base64," + arq.blob;
        link.download = a.nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      estado.className = "estado ok";
      estado.textContent = "Pronto. (O original também está salvo na pasta do mcp-google.)";
    } catch (e) {
      estado.className = "estado erro";
      estado.textContent = (e && e.message ? e.message : String(e)) + " O arquivo está salvo no PC, no caminho acima.";
      mostrarCaminho(a, estado, cartao);
    } finally {
      botao.disabled = false;
      avisarTamanho();
    }
  }

  async function acaoAssistir(a, botao, estado, midia) {
    botao.disabled = true;
    estado.className = "estado";
    estado.textContent = a.mime === "audio/mp4" ? "Carregando o áudio…" : "Carregando o vídeo…";
    try {
      const arq = await buscarArquivo(a, estado);
      const v = document.createElement(a.mime === "audio/mp4" ? "audio" : "video");
      v.controls = true;
      v.autoplay = true;
      if (v.tagName === "VIDEO") v.playsInline = true;
      v.src = "data:" + arq.mime + ";base64," + arq.blob;
      v.addEventListener("loadedmetadata", avisarTamanho);
      midia.textContent = "";
      midia.appendChild(v);
      estado.textContent = "";
      botao.remove();
    } catch (e) {
      estado.className = "estado erro";
      estado.textContent = e && e.message ? e.message : String(e);
      botao.disabled = false;
    }
    avisarTamanho();
  }

  enviar("ui/initialize", {
    appInfo: { name: "mcp-google-visualizador", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: VERSAO_PROTOCOLO,
  })
    .then((r) => {
      capacidades = (r && r.hostCapabilities) || {};
      aplicarContexto(r && r.hostContext);
      notificar("ui/notifications/initialized", {});
      $("info").textContent = "";
    })
    .catch(() => {
      $("info").textContent = "";
    });
})();
</script>
</body>
</html>`;
