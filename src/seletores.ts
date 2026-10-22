// Todos os textos e seletores das telas do Google num lugar só.
// Quando o Google mudar a interface, normalmente só este arquivo precisa mudar.
// Mapeado em 2026-10-05/06 (interface em pt-BR, produto "Gemini Notebook").

export const NOTEBOOK = {
  // notebooklm.google.com redireciona para cá.
  url: "https://notebook.google.com/",
  urlNotebook: (id: string) => `https://notebook.google.com/notebook/${id}`,

  // Página inicial. A grade só mostra os 7 mais recentes; a lista mostra todos.
  carregado: "project-button, tr.mat-mdc-row",
  botaoModoLista: "Visualização em lista",
  botaoVerMais: /Ver mais/,
  linha: "tr.mat-mdc-row",
  linhaLink: "a.project-table-title",
  linhaFontes: ".mat-column-numSources",
  linhaData: ".mat-column-createTime",
  linhaPapel: ".mat-column-userRole",
  linhaPublico: ".mat-column-sharedIcon", // contém "public" nos notebooks em destaque
  botaoNovo: "Novo notebook",

  // Avisos de novidades que aparecem por cima da tela
  fecharAviso: "Fechar caixa de diálogo",

  // Dentro do notebook
  titulo: "input.title-input",
  dialogo: "mat-dialog-container",
  botaoTextoCopiado: /Texto copiado/,
  botaoSites: /Sites/,
  campoTexto: "Texto colado",
  campoUrls: "Insira os URLs",
  botaoInserir: "Inserir",
  fonte: ".single-source-container",
  fonteTitulo: ".source-title",
  // Grupos recolhidos (ex.: "Conversas do Gemini (3)"): as fontes só aparecem depois de abrir.
  grupoFontesFechado: '.single-source-container[aria-expanded="false"]:has([class*="group-title"])',

  // Chat
  caixaPergunta: "Caixa de consulta",
  resposta: "chat-message .to-user-message-inner-content",
  pensamento: "thinking-chain-view",
  citacao: ".citation-marker",
  // Só aparece quando a resposta termina de ser gerada.
  respostaPronta: '[aria-label="Salvar mensagem em uma nota"]',
  salvarRespostaNota: "Salvar mensagem em uma nota",
  mensagemChat: "chat-message",
  mensagemUsuario: ".from-user-message-inner-content",
  marcarFonte: "Selecionar ", // + título: caixinha da fonte no painel (vale para o chat)
  marcarTodasFontes: "Selecionar todas as fontes",

  // Avisos que tapam botões (notificações do navegador, banner de novidades)
  avisoAgoraNao: "Agora não",

  // Página inicial: menu de cada notebook (mapeado em 06/10/2026)
  menuAcoesNotebook: "Menu de ações do projeto",
  menuEditarTitulo: "Editar título",
  menuExcluir: /^Excluir/,
  botaoExcluir: "Excluir",
  botaoCancelar: /^Cancelar/,
  botaoSalvar: "Salvar",

  // Configuração do notebook (menu "⋮" no topo)
  configNotebook: "Configuração do notebook",
  menuConfigurarConversas: "Configurar as conversas",
  grupoObjetivo: "Defina sua meta, estilo ou papel na conversa",
  grupoTamanho: "Escolha o tamanho da resposta",
  campoComandoPersonalizado: "Comando personalizado para controlar a resposta à conversa",
  fecharConfigConversa: "Fechar as configurações de conversa",
  salvarConfigConversa: /Salvar configurações/,

  // Fontes
  botaoAdicionarFonte: "Adicionar fonte",
  botaoEnviarArquivos: "Enviar arquivos",
  botaoDrive: "Drive",
  fonteMais: "Mais",
  fonteClicavel: ".source-title",
  menuRemoverFonte: "Remover fonte",
  menuRenomearFonte: "Renomear fonte",
  campoNomeFonte: "Nome da fonte",
  guiaFontes: "Guia de fontes",
  guiaResumo: ".source-guide-container .summary",
  guiaTopicos: ".source-guide-container .key-topics-text",
  fecharGuia: "Fechar guia de fontes",
  // Seletor de arquivos do Google Drive (vem em inglês mesmo com a tela em português)
  driveBusca: /Search in Drive|Pesquisar no Drive|paste URL|cole o URL/i,
  driveInserir: /^(Insert|Inserir)/,
  driveFechar: /Close picker|Fechar/,

  // Pesquisa de fontes na web ("Descoberta de fontes")
  campoPesquisa: "Pesquise fontes com base na consulta inserida",
  botaoModoPesquisa: /^(Pesquisa rápida|Deep Research)$/,
  opcaoModo: { rapida: /^Pesquisa rápida/, profunda: /^Deep Research/ },
  pesquisaConcluida: /(Pesquisa rápida|Deep Research|Pesquisa) concluíd/,
  botaoVerFontes: "Ver fontes",
  botaoImportar: "Importar",
  selecionarTodasPesquisa: /Selecionar tudo/,

  // Estúdio: um botão para cada tipo; cada um abre um diálogo de personalização
  botaoEstudio: (rotulo: string) => `[role=button].create-artifact-button-container[aria-label="${rotulo}"]`,
  gerarAgora: /^(Gere agora mesmo|Gerar agora)$/,
  fecharDialogo: /^Fechar/,
  medidorUsado: ".meter-used",
  medidorEstimado: ".meter-expected",
  grupoIdioma: "Selecione o idioma",
  botaoFontesDialogo: /^\d+ fontes?$/,
  confirmarFontes: "Confirmar",
  voltar: "Voltar",
  // Item já gerado na lista do Estúdio
  itemEstudio: (id: string) => `.artifact-button-content:has(.artifact-stretched-button[aria-labelledby="artifact-labels-${id}"])`,
  itemEstudioAbrir: (id: string) => `.artifact-stretched-button[aria-labelledby="artifact-labels-${id}"]`,
  tituloEstudioEditavel: "input.artifact-title-input",
  menuRenomear: "Renomear",
  // Exportar do Estúdio para o Drive (mapeado em 07/10/2026): relatório em formato documento tem
  // as duas opções; tabela só Planilhas; slides, relatório interativo e os demais, nenhuma.
  // O link do arquivo novo vem na resposta do RPC Krh3pd (~3 s) e o NotebookLM abre uma aba com ele.
  menuExportar: { docs: "Exportar para o Google Docs", planilhas: "Exportar para o Planilhas" },
  rpcExportar: /rpcids=Krh3pd/,

  // Notas (aparecem na lista do Estúdio, com outro identificador)
  itemNota: (id: string) => `.artifact-button-content:has(.artifact-stretched-button[aria-labelledby="note-labels-${id}"])`,
  botaoAdicionarNota: "Adicionar nota",
  tituloNota: "título da observação editável",
  editorNota: ".ProseMirror[contenteditable=true]",
  fecharNota: "Fechar visualização da nota",
  excluirNota: "Excluir nota",
  converterEmFonte: "Converter em fonte",

  // Leituras feitas direto pela página (as mesmas chamadas que a tela faz).
  // rLM1Ne = notebook e fontes; gArtLc = itens do Estúdio; v9rmvd = conteúdo de um item;
  // cFji9 = notas; EylDcb = uso da IA; e3bVqc = resultados da pesquisa de fontes; R7cb6c = item criado.
  // hPTbtc = conversas do chat; khqZz = mensagens de uma conversa, com o trecho de cada citação (07/10/2026).
  rpc: { notebook: "rLM1Ne", estudio: "gArtLc", item: "v9rmvd", notas: "cFji9", uso: "EylDcb", pesquisa: "e3bVqc", criarItem: "R7cb6c", conversas: "hPTbtc", mensagens: "khqZz" },
  urlRpc: "/_/LabsTailwindUi/data/batchexecute",
};

/**
 * Estúdio do NotebookLM (mapeado em 06/10/2026). Para cada tipo: rótulo do botão, código interno
 * do item (`tipo` no registro; os mini-apps 4 se distinguem pelo subtipo) e o campo de texto livre.
 */
export const ESTUDIO = {
  audio: { rotulo: "Resumo em Áudio", tipo: 1, campo: "Em quais aspectos os apresentadores de IA devem se concentrar nesse episódio?" },
  video: { rotulo: "Resumo em Vídeo", tipo: 3, campo: "Qual deve ser o foco do vídeo?" },
  slides: { rotulo: "Apresentação de slides", tipo: 8, campo: "Descreva a apresentação de slides que você quer criar" },
  mapa_mental: { rotulo: "Mapa mental", tipo: 4, subtipo: 4, campo: "Qual deve ser o tema?" },
  relatorio: { rotulo: "Relatórios", tipo: 2, campo: "Descrição do tipo de relatório que você quer criar" },
  cartoes: { rotulo: "Cartões didáticos", tipo: 4, subtipo: 1, campo: "Qual deve ser o tema?" },
  teste: { rotulo: "Teste", tipo: 4, subtipo: 2, campo: "Qual deve ser o tema?" },
  infografico: { rotulo: "Infográfico", tipo: 7, campo: "Descreva o infográfico que você quer criar" },
  tabela: { rotulo: "Tabela de dados", tipo: 9, campo: "Descreva a tabela de dados que você quer criar" },
} as const;

export type TipoEstudio = keyof typeof ESTUDIO;

/** Opções dos diálogos do Estúdio: valor aceito pela ferramenta → texto do botão na tela. */
export const OPCOES_ESTUDIO = {
  formatoAudio: { analise: "Análise detalhada", resumo: "Resumo", critica: "Crítica", debate: "Debate" },
  formatoVideo: { curto: "Curta", explicativo: "Vídeo explicativo" },
  formatoSlides: { detalhada: "Apresentação detalhada", apresentador: "Slides do apresentador" },
  formatoRelatorio: { documento: "Documento", interativo: "Interativo" },
  duracao: { curto: "Curto", padrao: "Padrão" },
  quantidade: { menos: "Menos", padrao: "Padrão", mais: "Mais" },
  dificuldade: { facil: "Fácil", medio: "Médio (padrão)", dificil: "Difícil" },
  orientacao: { paisagem: "Paisagem", retrato: "Retrato", quadrado: "Quadrado" },
  detalhe: { conciso: "Conciso", padrao: "Padrão", detalhado: "Detalhado" },
  tiposPergunta: { multipla_escolha: "Múltipla escolha", varias_corretas: "Mais de uma resposta correta", lacuna: "Preencher a lacuna", resposta_curta: "Resposta curta" },
  estiloVideo: {
    automatico: "Seleção automática", personalizado: "Personalizado", classico: "Clássico", quadro_branco: "Quadro branco", kawaii: "Kawaii",
    anime: "Anime", aquarela: "Aquarela", impressao_retro: "Impressão retrô", retro: "Retrô", dobradura: "Dobradura",
  },
  estiloInfografico: {
    automatico: "Seleção automática", kawaii: "Kawaii", argila: "Argila", esboco: "Esboço de anotação", anime: "Anime", editorial: "Editorial",
    instrutivo: "Instrutivo", bento: "Grade Bento", tijolos: "Tijolos", cientifico: "Científico", profissional: "Profissional",
  },
  objetivoChat: { padrao: "Padrão", guia_aprendizado: "Guia de aprendizado", personalizado: "Personalizado" },
  tamanhoChat: { padrao: "Padrão", longa: "Mais longa", curta: "Mais curta" },
} as const;

/** Grupos de opções nos diálogos (nome acessível do radiogroup). */
export const GRUPOS_ESTUDIO = {
  formato: /^Formato/,
  duracao: "Duração",
  quantidadeCartoes: "Número de cards",
  quantidadeQuestoes: "Número de questões",
  dificuldade: "Nível de dificuldade",
  tiposPergunta: /^Tipos de perguntas/,
  estilo: "Escolher estilo visual",
  estiloPersonalizado: "Descreva um estilo visual personalizado",
  orientacao: "Escolher orientação",
  detalhe: "Nível de detalhamento",
};

// Google Flow (vídeo e imagem). Mapeado em 2026-10-05/06 e conferido em 07/10; labs.google/fx/tools/flow redireciona para cá.
export const FLOW = {
  url: "https://flow.google.com/",
  urlProjeto: (id: string) => `https://flow.google.com/project/${id}`,
  // Página de uma mídia (vídeo ou imagem): /project/<projeto>/edit/<id>
  urlMidia: (projeto: string, id: string) => `https://flow.google.com/project/${projeto}/edit/${id}`,
  // Cena (vídeo estendido = clipes juntos): /project/<projeto>/scene/<id>
  urlCena: (projeto: string, id: string) => `https://flow.google.com/project/${projeto}/scene/${id}`,

  // Página inicial: a lista de projetos vem na resposta UpteDb ([id, [título, null, [criado], miniatura]]).
  botaoNovoProjeto: /Novo projeto/,
  linkProjeto: 'a[href*="/project/"]',
  rpcProjetos: /rpcids=UpteDb/,
  contaDetalhes: "Detalhes da conta",
  fecharPainelConta: "Fechar painel da conta",
  textoCreditos: /([\d.]+)\s*créditos do Google Flow/,

  // Projeto
  tituloProjeto: "Texto editável",
  caixaPrompt: ".ProseMirror",
  chipAgente: ".agent-mode-chip",
  chipAgenteLigado: "agent-mode-chip-checked",
  gatilhoConfig: "button.settings-trigger-button",
  overlay: ".cdk-overlay-container",
  fundoFlutuante: ".cdk-overlay-backdrop-showing",
  painelFlutuante: ".cdk-overlay-container .cdk-overlay-pane",
  abaVideo: /Vídeo/,
  abaImagem: /Imagem/,
  modoFrames: /Frames/,
  modoElementos: /Elementos/,
  menuModelo: "Selecionar família de modelos",
  textoCusto: /vai usar/,
  botaoGerar: "Iniciar geração",

  // Quadros (imagem → vídeo): botões na caixa de comando, no modo Frames
  quadroInicio: "Início",
  quadroFim: "Fim",
  quadroPreenchido: "Elemento de imagem", // o botão vira isto depois de escolher a imagem
  seletorQuadro: "Selecione uma imagem de frame",
  listaRecursos: "Lista de recursos",
  abaEnvios: "Envios",
  botaoEnviarMidia: "Enviar mídia",
  botaoIncluir: "Incluir no comando", // na prévia da imagem escolhida

  // Rascunho da caixa de comando: o Flow guarda texto e elementos entre sessões.
  apagarComando: "Apagar comando",

  // Elementos no comando (personagens): botão "+" da caixa → seletor com abas
  adicionarElementos: "Adicionar elementos à caixa de comando",
  abaPersonagens: "Personagens",
  abaImagens: "Imagens",
  abaVozes: "Vozes",
  abaAvatares: "Avatares",
  vozPerformance: "Personalizar performance", // estilo da voz, no painel da voz escolhida
  pesquisarRecursos: "Pesquisar recursos",
  tituloRecurso: ".asset-title",
  elementoPersonagem: /^Elemento$/, // chip do personagem dentro da caixa de comando

  // Personagens (mapeado em 06/10/2026)
  urlNovoPersonagem: (projeto: string) => `https://flow.google.com/project/${projeto}/character`,
  urlPersonagem: /\/character\/([0-9a-f-]{36})/,
  personagemDescricao: "Descreva seu personagem…",
  personagemEnviar: "Enviar",
  personagemDoProjeto: "Adicionar do projeto",
  // Em 08/10/2026 clicar na imagem da lista já cria o personagem e fecha o diálogo; o botão
  // "Adicionar mídia" só é usado se o diálogo continuar aberto (como era antes).
  personagemAdicionarMidia: "Adicionar mídia",
  personagemSelecionarMidia: "Selecionar mídia", // título do diálogo de Adicionar do projeto
  personagemSemNome: "Personagem sem nome", // nome que o Flow dá até alguém mudar
  personagemExcluir: "Excluir",
  personagemExcluirAviso: /excluído permanentemente/,
  personagemImagem: "Imagem do personagem gerada",
  personagemNome: "Nome do personagem",
  personagemEditarNome: "Editar nome",
  personagemPersonalidade: "Personalidade do personagem",
  personagemVoz: "Selecionar uma voz", // vira o nome da voz (ex.: "fenrir") depois de escolhida
  personagemVozDialogo: "Selecionar uma voz",
  personagemRemoverVoz: "Remover",
  personagemAdicionarVoz: "Adicionar ao personagem", // no diálogo de voz (08/10/2026)
  personagemCriarCorpo: "Criar corpo", // só existe enquanto o personagem não tem corpo
  personagemCorpo: "Corpo", // aba que aparece depois de gerar o corpo
  personagemRetrato: "Retrato",
  personagemAbaAtiva: "chip-button-active", // classe da aba (Retrato/Corpo) aberta
  // Caixa "O que você quer mudar?": edita a imagem da aba aberta (Retrato ou Corpo); é a mesma
  // caixa de comando (caixaPrompt) e as versões antigas ficam no histórico da página.
  personagemMudar: "O que você quer mudar?",
  // Histórico da aba aberta (coluna da direita): cada versão é uma imagem clicável, a mais nova por
  // último. A imagem gerada pela caixa de mudança NÃO vira a atual sozinha: é preciso clicar nela.
  historicoImagem: ".history-step img.clickable",
  historicoMostrar: "Mostrar histórico", // par de "Ocultar histórico"; só aparece se alguém escondeu
  personagemConcluir: "Concluir",
  filtroPersonagens: "Personagens", // item do menu lateral do projeto
  miniaturaPersonagem: "Miniatura do personagem",

  // Grade de mídias
  tile: "flow-grid-tile-container",

  // Página de uma mídia
  botaoBaixar: "Baixar mídia",
  opcaoDownload: { "1080p": /1080p/, gif: /270p/, "2k": /^2K/ },

  // Estender (na página do vídeo ou da cena): "+" da linha do tempo → "Estender (<modelo>)".
  // Na cena, o "+" fica no clipe selecionado; clicar no último clipe estende a partir do fim.
  botaoAdicionarClipe: "Adicionar clipe",
  ultimoClipe: ".timeline-contents .clip.is-last",
  corpoDoClipe: ".clip-body",
  opcaoEstender: /^Estender/, // "Estender (Veo 3.1 - Lite)": o modelo da extensão vem fixo do Flow
  modoExtensao: "Sair do modo de extensão", // texto do botão: "Estender (Veo 3.1 - Lite)"
  botaoBaixarCena: "Baixar cena",

  // Rede. Zzl0ze = lista do projeto ao carregar; jwpduf = status e saldo durante a geração;
  // as29s/YhhmEf = detalhes (com o link direto); ogiZ0b = resultado da geração de imagem;
  // rqZuUc = cena criada ao estender; IxdSwd = exportação da cena (traz o MP4 em base64).
  // A miniatura na tela não traz o id depois de recarregar, então ids, status e links
  // vêm destas respostas que a própria página recebe.
  // Extensão (07/10/2026): o clique cria a cena (rqZuUc, ~9 s), o Flow lê os clipes (uwAyfb) e SÓ
  // DEPOIS pede a geração (fZytfe, ~10 s após o clique; a resposta traz [null, saldo, [[clipe…]]]).
  // Fechar a página antes do fZytfe sair cancela a extensão sem gastar.
  rpcDados: /batchexecute\?rpcids=(Zzl0ze|jwpduf|as29s|YhhmEf|ogiZ0b|rqZuUc|uwAyfb|fZytfe)/,
  rpcGerarExtensao: /rpcids=fZytfe/,
  rpcLista: /rpcids=Zzl0ze/,
  rpcImagem: /rpcids=ogiZ0b/,
  rpcExportarCena: /rpcids=IxdSwd/,
  rpcAprimorado: /rpcids=(SPrCad|QZasKb)/, // imagem 2K (SPrCad) e GIF (QZasKb): vêm em base64 na resposta
  linkAprimorado: /^https:\/\/flow-content\.google\/video\/[0-9a-f-]{36}_\w+\?/, // vídeo 1080p/GIF: "<id>_upsampled"
  linkDireto: /^https:\/\/flow-content\.google\/(video|image)\/([0-9a-f-]{36})\?/,
};

// Nome no menu do Flow para cada modelo de vídeo aceito pela ferramenta.
export const MODELOS_FLOW = {
  "veo-3.1-lite": "Veo 3.1 - Lite",
  "veo-3.1-fast": "Veo 3.1 - Fast",
  "veo-3.1-quality": "Veo 3.1 - Quality",
  "omni-1.1-flash": "Omni 1.1 Flash",
} as const;

// Custos x1 vistos em 06/10/2026 (o Flow mostra o valor real antes de gerar; este é só o padrão).
export const CUSTO_VIDEO: Record<keyof typeof MODELOS_FLOW, number> = {
  "veo-3.1-lite": 10,
  "veo-3.1-fast": 20,
  "veo-3.1-quality": 100,
  "omni-1.1-flash": 15,
};

// Em 07/10/2026 o Flow estende SEMPRE com o modelo que ele mesmo escolhe e mostra no menu
// ("Estender (Veo 3.1 - Lite)"): não segue o menu do projeto nem o modelo do clipe (testado com
// configuração e vídeo base em Fast) e o modo de extensão não tem seletor de modelo. Este é só o
// padrão para estimar custo; o modelo real é lido do menu antes de cada extensão.
export const MODELO_EXTENSAO_PADRAO: keyof typeof MODELOS_FLOW = "veo-3.1-lite";

// Modelos de imagem (no menu aparecem com "🍌 " na frente). Em 07/10/2026 o menu mostra "Nano Banana 2.1",
// "Nano Banana Pro" e "Nano Banana 2 Lite"; o "2" aceita a versão nova (nomeExato). Os três custam 0 créditos.
export const MODELOS_IMAGEM = {
  "nano-banana-2": "Nano Banana 2",
  "nano-banana-pro": "Nano Banana Pro",
  "nano-banana-2-lite": "Nano Banana 2 Lite",
} as const;

/**
 * Google Drive e Google Apresentações, usados para levar os slides do Estúdio (.pptx) para o
 * Apresentações Google, que o NotebookLM não exporta (mapeado em 07/10/2026). O .pptx enviado abre
 * no Apresentações em "edição de arquivos do Office"; "Salvar como apresentação Google" cria a cópia
 * convertida numa aba nova (~4 s) e o .pptx enviado vai para a lixeira do Drive.
 */
export const DRIVE = {
  url: "https://drive.google.com/drive/my-drive",
  botaoNovo: /^Novo/,
  menuUpload: /^Upload de arquivo/,
  // Resposta do envio: [null, ["<id do arquivo>", ["<pasta>"], "<nome>", "<mime>", …]]
  respostaUpload: /drivefrontend-pa\.clients6\.google\.com\/upload\/v1\/items:upload\?upload_id=/,
  idNaResposta: /^\s*\[null,\s*\["([\w-]{20,})"/,
  urlApresentacao: (id: string) => `https://docs.google.com/presentation/d/${id}/edit`,
  idApresentacao: /docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([\w-]{20,})/,
  menuArquivo: "#docs-file-menu",
  itemMenu: ".goog-menu:visible [role=menuitem]",
  // Aviso que aparece na primeira vez que um .pptx abre ("Esta é a edição de arquivos do Office").
  avisoEntendi: "Entendi",
  salvarComoGoogle: /Salvar como apresenta[çc][ãa]o Google/i,
  moverParaLixeira: /^Mover para a lixeira/,
  confirmacaoLixeira: /movido para a lixeira/i,
};
