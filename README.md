# mcp_google_public

Servidor MCP local que deixa o Claude (**Claude Code** e **Claude Desktop**) usar a sua assinatura **Google AI Pro** pelo seu próprio navegador, sem API paga:

- **NotebookLM:** notebooks, fontes (links, YouTube, arquivos do PC, Google Drive, pesquisa na web e Deep Research), perguntas respondidas com **citações completas** (o trecho exato da fonte por trás de cada `[n]`), a conversa inteira salva em arquivo, notas, **roteiros de vídeo curto escritos a partir das fontes** e o **Estúdio** inteiro: Visão geral em áudio, Visão geral em vídeo, slides (PDF/PPTX), mapa mental, relatórios, cartões, teste, infográfico e tabela, com exportação para **Google Docs, Planilhas e Apresentações**.
- **Google Flow:** imagens (Nano Banana) e edição de imagem, vídeos curtos (Veo 3.1) com **vozes** e **imagens de referência**, imagem → vídeo, extensão de cena, **vídeos longos e contínuos** (ex.: ~30 s na vertical, "modo apresentador"), projetos, roteiros em lote, **personagens** que mantêm a mesma aparência entre vídeos e relatório de gastos.
- **Autoverificação das telas:** confere cada botão, menu e chamada interna de que o servidor depende no NotebookLM, no Flow e no Drive, e diz exatamente o que o Google mudou.

Versão **0.16.1** · Windows + Microsoft Edge (Google Chrome opcional) · [licença MIT](LICENSE) · [histórico](docs/CHANGELOG.md).
Você faz login à mão, numa janela normal do navegador; o servidor nunca vê a sua senha.

> **Aviso:** automatizar as páginas do Google viola os Termos de Serviço do Google, e a sua conta pode ser restringida. Este projeto não tem vínculo com o Google. Use por sua conta e risco.

> **Idioma:** descrições das ferramentas, mensagens e nomes dos arquivos gerados estão em **português do Brasil**. Você pode falar com o Claude em qualquer idioma.

---

## Sumário

1. [Requisitos](#1-requisitos)
2. [Instalação](#2-instalação)
3. [Configuração](#3-configuração)
4. [Onde ficam os seus dados](#4-onde-ficam-os-seus-dados)
5. [Créditos e teto diário](#5-créditos-e-teto-diário)
6. [Claude Code × Claude Desktop](#6-claude-code--claude-desktop)
7. [As 57 ferramentas](#7-as-57-ferramentas)
8. [Dicas](#8-dicas)
9. [Limitações conhecidas](#9-limitações-conhecidas)
10. [Solução de problemas](#10-solução-de-problemas)
11. [Segurança](#11-segurança)
12. [Desenvolvimento](#12-desenvolvimento)

---

## 1. Requisitos

- **Windows** (o tratamento do navegador e dos processos é específico do Windows).
- **Microsoft Edge** (já vem no Windows). O Google Chrome também funciona, como opção.
- **Node.js 22** ou mais novo.
- Uma conta Google com **Google AI Pro** (créditos do Flow e os limites maiores do NotebookLM).
- **Claude Code** e/ou **Claude Desktop**.

## 2. Instalação

```powershell
git clone https://github.com/Antonio-byte10/mcp_google_public.git
cd mcp_google_public
npm install
npm run build
npm test
```

O `npm test` compila e roda os testes de unidade; não precisa de rede, login nem navegador.

**Registrar o servidor**

- **Claude Code:**
  ```powershell
  claude mcp add mcp-google --scope user -- node "C:\caminho\para\mcp_google_public\dist\index.js"
  ```
  Depois de qualquer mudança no código: `npm run build` e `/mcp` → **Reconnect**.
- **Claude Desktop:** *Settings → Developer → Edit config* e acrescente em `mcpServers`:
  ```json
  "mcp-google": {
    "command": "C:\\Program Files\\nodejs\\node.exe",
    "args": ["C:\\caminho\\para\\mcp_google_public\\dist\\index.js"]
  }
  ```
  O Claude Desktop só recarrega o servidor quando o app reinicia de verdade: clique com o botão direito no ícone da bandeja → **Quit** e abra de novo (fechar a janela não basta).

**Primeiro login**

1. Peça ao Claude: *"rode o login_iniciar"*. Abre uma janela normal (sem automação) do Edge.
2. Entre na sua conta Google nessa janela.
3. **Feche a janela**: a sessão é salva quando ela fecha.
4. Peça *"rode o diagnostico do mcp-google"* para conferir se o NotebookLM e o Flow respondem.

A automação em si roda em segundo plano (sem janela). Cada chamada abre o navegador, faz o trabalho e fecha.

## 3. Configuração

Todas as opções são variáveis de ambiente opcionais no registro do MCP (bloco `env` no Claude Desktop; `-e NOME=valor` no `claude mcp add`).

| Variável | O que faz | Padrão |
|---|---|---|
| `MCP_GOOGLE_NAVEGADOR` | Navegador: `edge` ou `chrome`. Qualquer outro valor impede o servidor de iniciar, com uma mensagem clara | `edge` (cai para o Chrome, com aviso, se o Edge não existir) |
| `MCP_GOOGLE_TETO_DIARIO` | Teto diário de créditos do Flow que este servidor pode gastar; `sem` = sem teto. Valores inválidos impedem o servidor de iniciar | `200` |
| `MCP_GOOGLE_DADOS` | Pasta de dados (perfil do navegador, arquivos gerados, preferências) | `%LOCALAPPDATA%\mcp-google` |
| `MCP_GOOGLE_PERFIL` | Só a pasta do perfil do navegador (a sessão logada) | `perfil-edge\` ou `perfil-chrome\` dentro da pasta de dados |
| `MCP_GOOGLE_SAIDAS` | Só a pasta de saídas (imagens, vídeos, documentos, arquivos de estado) | `saidas\` dentro da pasta de dados |
| `MCP_GOOGLE_LIMITE_SEGUNDOS` | Máximo de segundos por chamada (mínimo 15) | 50 s fora do Claude Code, 600 s no Claude Code |

Exemplo (Claude Desktop, com Chrome e teto de 500 créditos por dia):

```json
"mcp-google": {
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["C:\\caminho\\para\\mcp_google_public\\dist\\index.js"],
  "env": { "MCP_GOOGLE_NAVEGADOR": "chrome", "MCP_GOOGLE_TETO_DIARIO": "500" }
}
```

**Trocar para o Chrome:** cada navegador tem o seu perfil, e os cookies do Google são cifrados por navegador, então a sessão do Edge não passa para o Chrome. Defina `MCP_GOOGLE_NAVEGADOR=chrome`, reinicie o Claude, rode `login_iniciar` uma vez e entre na janela do Chrome. O `diagnostico` deve mostrar `Navegador: Google Chrome`.

## 4. Onde ficam os seus dados

Tudo que é pessoal fica **fora da pasta do código**, em `%LOCALAPPDATA%\mcp-google\`:

| Caminho | Conteúdo |
|---|---|
| `perfil-edge\` / `perfil-chrome\` | Perfil do navegador com a sua sessão Google logada. **Nunca compartilhe.** |
| `saidas\flow\` | Imagens, vídeos, cenas e vídeos longos do Flow |
| `saidas\notebooklm\` | Saídas do Estúdio (áudio, vídeo, slides, relatórios, tabelas, mapas mentais, cartões, testes, Deep Research) |
| `saidas\notebooklm\roteiros\` | Roteiros de vídeo (`01-…md`, `02-…md`) |
| `saidas\notebooklm\conversas\` | Conversas do NotebookLM salvas |
| `saidas\*.json`, `saidas\geracoes.jsonl` | Arquivos de estado: gerações pendentes, progresso de vídeos longos, registro de gerações (usado no relatório de gastos e no teto diário) |
| `saidas\_erros\` | Capturas de tela tiradas quando algo falha |
| `config.json` | Preferências (projeto padrão do Flow) |

- As chamadas do Claude Code e do Claude Desktop gravam no mesmo lugar. O caminho completo de cada arquivo aparece na resposta da ferramenta.
- Os arquivos levam data e título no nome, ex.: `2026-10-06_09-05-16_tatu-tomando-cafe.mp4`. Sufixos: `_1`, `_2` (vários de uma vez), `_1080p`, `_2k`, `_cena` (cena estendida), `_video-longo` (vídeo longo).
- As mídias geradas também ficam no seu projeto do Flow (por padrão um chamado **"Claude MCP"**, criado no primeiro uso).
- `login_status` e `diagnostico` mostram a pasta de dados em uso.

## 5. Créditos e teto diário

| O quê | Créditos do Flow |
|---|---|
| Imagem (Nano Banana 2.1 / Pro / 2 Lite), x1–x4 | **0** |
| Personagem (retrato e corpo inteiro) | **0** |
| Vídeo Veo 3.1 **Lite / Fast / Quality** (8 s, 720p, com áudio) | **10 / 20 / 100** |
| Omni 1.1 Flash (4–10 s) | 4–15 |
| Estender (+~7 s) | escolhido pelo Flow (hoje Veo 3.1 Lite, 10) |
| Downloads em 1080p, 2K e GIF | **0** |

- x2–x4 multiplica o custo do vídeo. Modelo de vídeo padrão: **Veo 3.1 Fast**.
- Um vídeo longo de ~30 s (1 trecho Fast + 3 extensões Lite) custa **50 créditos**.
- **Teto diário:** por padrão o servidor gasta no máximo **200 créditos do Flow por dia** (contados pelo próprio registro). O que passaria do teto é recusado **antes** de enviar, então nada é gasto. Vídeos longos e roteiros em lote são conferidos por inteiro antes de começar, então nunca param no meio por causa do teto. Mude com `MCP_GOOGLE_TETO_DIARIO` (um número, ou `sem` para tirar o teto). Confira a cota de créditos do seu plano antes de tirar o teto.
- Dentro do teto, o Claude gera sem pedir aprovação de custo. Você ainda pode pedir um limite por pedido ("no máximo 30 créditos"), que vira `max_creditos`.
- A geração também é recusada quando o saldo do Flow não basta. `flow_custo` mostra o custo exato sem gerar; `flow_creditos` mostra o saldo; `flow_gastos` mostra os gastos por dia e por modelo, e o teto.

**NotebookLM** não usa créditos do Flow. O Google AI Pro tem um limite de uso da IA com uma parte de curto prazo (renova a cada poucas horas) e uma semanal; veja com `notebook_uso`. Estimativas aproximadas do Estúdio (parcela do limite de curto prazo): mapa mental / cartões / teste ~1%, relatório / tabela ~2%, infográfico ~3%, Visão geral em vídeo ~9–11%, Visão geral em áudio ~12%, slides ~14%. Toda ferramenta do Estúdio aceita `uso_maximo` (um teto em %) e mostra o uso antes e depois.

## 6. Claude Code × Claude Desktop

| | Claude Code | Claude Desktop |
|---|---|---|
| Tempo máximo por chamada | 10 min | ~50 s (o app corta chamadas em ~60 s) |
| Vídeo (1–3 min) | Espera e baixa na mesma chamada | Volta "em andamento"; o Claude chama `flow_status` até salvar |
| Resposta longa do NotebookLM | Mesma chamada | Se passar do tempo, `notebook_resposta` |
| Itens longos do Estúdio (áudio, vídeo, slides) | Espera e baixa (até 10 min) | Volta "ainda gerando"; o Claude chama `notebook_estudio_status` |
| Deep Research | Espera (até 10 min) | Chame `notebook_pesquisar_fontes` de novo sem `consulta` |
| Resultados | Caminho do arquivo + miniatura que o Claude vê | Visualizador embutido: prévia, Baixar, Assistir, Ouvir, Abrir no Flow / NotebookLM |

- Dá para usar os dois apps ao mesmo tempo. Só uma tarefa usa o perfil do navegador por vez; a outra espera ou responde "em uso, tente de novo".
- **O claude.ai no navegador ou no celular não funciona**: o servidor é local de propósito.
- Se uma chamada de geração estourar o tempo, **não gere de novo**: confira `flow_status` / `notebook_estudio_status` primeiro (os créditos podem já ter sido gastos). O servidor também avisa o Claude disso.

## 7. As 57 ferramentas

**Gerais (3)**

| Ferramenta | Faz |
|---|---|
| `diagnostico` | Confere login, NotebookLM, Flow e saldo; `completo=true` roda a autoverificação das telas do NotebookLM, do Flow e do Drive |
| `login_iniciar` | Abre o Edge (ou o Chrome) para login manual |
| `login_status` | Confere se a sessão está ativa |

**NotebookLM (34)**

| Ferramenta | Faz |
|---|---|
| `notebook_listar` / `notebook_criar` / `notebook_renomear` / `notebook_excluir` | Lista, cria, renomeia e exclui notebooks (excluir pede confirmação) |
| `notebook_configurar_chat` | Objetivo do chat, instruções personalizadas e tamanho das respostas |
| `notebook_uso` | Uso da IA: limites de curto prazo e semanal |
| `notebook_fontes` | Lista as fontes com tipo, palavras, estado e link |
| `notebook_adicionar_fonte` | Links, texto colado, arquivos do PC (PDF, DOCX, PPTX, XLSX, TXT, MD, CSV, EPUB, imagens, áudio; até 200 MB) ou arquivos do Google Drive |
| `notebook_pesquisar_fontes` | Pesquisa rápida na web ou Deep Research, importando todos, nenhum ou os resultados escolhidos |
| `notebook_fonte_ler` / `notebook_fonte_renomear` / `notebook_fonte_remover` | Lê uma fonte (texto completo + guia), renomeia, remove (com confirmação) |
| `notebook_perguntar` | Pergunta (todas ou algumas fontes) com o trecho exato de cada citação; opcionalmente salva como nota |
| `notebook_resposta` | Lê a última resposta quando ela demorou demais |
| `notebook_conversa` | Salva a conversa inteira, com os trechos citados, num `.md` |
| `notebook_exportar` | Exporta para Google Docs / Planilhas / Apresentações e devolve o link |
| `notebook_roteiro` | Roteiro de vídeo curto a partir das fontes: fato, trecho da fonte, cenário, falas no tamanho do `flow_video_longo`, legenda |
| `notebook_notas` / `notebook_nota_criar` / `notebook_nota_excluir` | Notas: lista, cria (opcionalmente como fonte), exclui |
| `notebook_gerar_audio` / `_video` / `_slides` / `_mapa_mental` / `_relatorio` / `_cartoes` / `_teste` / `_infografico` / `_tabela` | Itens do Estúdio: `.m4a`, `.mp4`, PDF/PPTX/PNG + texto, mapa mental `.md`/`.json`, relatório `.md`, cartões `.md` + `.csv` do Anki, teste com gabarito, infográfico `.png`, tabela `.csv` |
| `notebook_estudio` / `notebook_estudio_status` / `notebook_estudio_baixar` / `notebook_estudio_renomear` / `notebook_estudio_excluir` | Itens do Estúdio: lista, acompanha e baixa, baixa de novo, renomeia, exclui |

**Flow (20)**

| Ferramenta | Faz | Gasta créditos? |
|---|---|---|
| `flow_creditos` | Saldo do Flow | Não |
| `flow_custo` | Custo exato de uma geração, sem gerar | Não |
| `flow_gerar_imagem` | Imagens (com personagens e até 3 imagens de referência) | 0 |
| `flow_editar_imagem` | Edita uma imagem por instrução | 0 |
| `flow_gerar_video` | Vídeo (texto, imagem → vídeo, personagens, referências, voz) | Sim |
| `flow_roteiro` | Várias cenas de vídeo de uma vez (até 10) | Sim |
| `flow_estender_video` | +~7 s num vídeo ou cena; salva a cena inteira | Sim |
| `flow_video_longo` | Vídeo contínuo de 2 a 8 trechos num só `.mp4` | Sim |
| `flow_vozes` | As 30 vozes do Flow | Não |
| `flow_gastos` | Gastos por dia, tipo e modelo, e o teto diário | Não |
| `flow_projetos` / `flow_projeto_criar` / `flow_projeto_padrao` | Projetos: lista, cria, escolhe o padrão | Não |
| `flow_status` | Acompanha e baixa o que está em andamento | Não |
| `flow_listar` / `flow_baixar` | Lista as mídias de um projeto; baixa por id (original, 1080p, 2K, GIF, cena) | Não |
| `flow_personagem_criar` / `flow_personagens` / `flow_personagem_editar` / `flow_personagem_excluir` | Personagens: cria (por descrição ou imagem), lista, edita (nome, personalidade, voz, corpo inteiro), exclui (com confirmação) | 0 |

O servidor registra **58** ferramentas: as 57 acima mais `flow_arquivo`, usada internamente pelo visualizador do Claude Desktop (escondida no Claude Code).

## 8. Dicas

- **Personagens consistentes:** descreva com detalhes, gere o **corpo inteiro** (`flow_personagem_editar`), use **Veo Fast ou Quality** e cite o nome do personagem no prompt. Personagens não combinam com `imagem_inicio` / `imagem_fim` (são modos diferentes do Flow).
- **Vídeos longos (`flow_video_longo`):** use o modo apresentador: um `cenario` fixo (personagem + lugar + estilo) e uma fala por trecho em `falas` (~15–19 palavras na primeira, ~13–17 nas extensões). As extensões são sempre Veo 3.1 Lite e mantêm o mesmo plano, então evite ações grandes ou troca de lugar. O servidor tira o ~1 s congelado que o Flow deixa em cada emenda (sem recodificar) e guarda o original do Flow ao lado (`_original-flow.mp4`).
- **Pesquisa → roteiro → vídeo:** `notebook_criar` → `notebook_pesquisar_fontes` → `notebook_roteiro` → confira cada fala com o trecho da fonte citado → `flow_video_longo` com o `cenario` e as `falas` devolvidos.
- **Estudar um assunto:** notebook → Deep Research → mapa mental + cartões (Anki) + teste.
- Imagens com imagem de referência passam pela tradução para o inglês do Flow: peça "texto exatamente em português" se a imagem tiver texto.
- Sinalize como gerado por IA o conteúdo que você publicar.

## 9. Limitações conhecidas

- **NotebookLM:** não compartilha notebooks (de propósito), não tem a Visão geral em áudio interativa, os widgets interativos dos relatórios só funcionam dentro do NotebookLM, e o histórico do chat pode ser lido e salvo, mas não apagado.
- **Flow:** não junta clipes independentes com cortes ou transições (os vídeos longos são emendados pelo próprio Flow); avatares precisam ser criados no Flow (webcam); o estilo da voz vai no prompt (sem vozes personalizadas); retratos de personagens não servem como imagem de referência (use `personagens`).
- O Google muda as páginas sem aviso. Quando algo quebrar, rode `diagnostico` com `completo=true`: ele diz qual item mudou em `src/seletores.ts`.

## 10. Solução de problemas

| Sintoma | O que fazer |
|---|---|
| Qualquer coisa estranha | Peça ao Claude para rodar o `diagnostico` |
| "A sessão do Google expirou" | Rode `login_iniciar`, entre e **feche a janela**. Esperado logo depois de trocar de navegador |
| "MCP_GOOGLE_NAVEGADOR inválido" / "MCP_GOOGLE_TETO_DIARIO inválido" | Corrija a variável no registro do MCP |
| "Microsoft Edge não foi encontrado; usando Google Chrome" | O Edge não está nos locais padrão; instale-o ou defina `MCP_GOOGLE_NAVEGADOR=chrome` |
| O navegador "não abre" / perfil ocupado | Feche a janela de login se ela ainda estiver aberta. Se o navegador anterior ainda estiver fechando, espere alguns segundos e tente de novo |
| "Teto diário do mcp-google" | O teto diário foi atingido; aumente `MCP_GOOGLE_TETO_DIARIO` ou espere até amanhã |
| Vídeo "em andamento" | Normal no Claude Desktop: peça ao Claude para acompanhar com `flow_status` até salvar |
| "Em uso por outra janela do Claude" | Claude Code e Desktop ao mesmo tempo: espere e tente de novo |
| "A interface pode ter mudado" | O Google mudou a página: rode `diagnostico` com `completo=true` e ajuste `src/seletores.ts` |
| Comportamento antigo depois de atualizar | `/mcp` → Reconnect (Claude Code) ou Quit e abrir de novo (Claude Desktop) |
| "O NotebookLM não deixou gerar agora" | Provavelmente o limite de uso: confira `notebook_uso` e espere renovar |
| Aviso sobre dados na pasta do código | Você atualizou de uma versão ≤ 0.15.0: com o Claude fechado, mova `perfil*\`, `saidas\` e `config.json` da pasta do código para `%LOCALAPPDATA%\mcp-google\` |

Logs: o Claude Desktop grava em `%LOCALAPPDATA%\Claude\logs\mcp-server-mcp-google.log`; o Claude Code guarda em `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<pasta>\mcp-logs-mcp-google\`.

## 11. Segurança

Veja o [SECURITY.md](SECURITY.md) para o modelo de ameaça e como reportar um problema. Em resumo:

- Login manual; o servidor nunca vê a sua senha e nunca devolve valores de cookies.
- A sua sessão, as saídas e as preferências ficam fora da pasta do código; o padrão `%LOCALAPPDATA%\mcp-google` só pode ser lido pelo seu usuário do Windows, pelo SYSTEM e por administradores.
- As mensagens de erro são limpas de cookies, tokens e links assinados.
- A automação só age em `notebook.google.com` (NotebookLM, agora "Gemini Notebook"), `flow.google.com` e, para exportar slides, `drive.google.com` / `docs.google.com`. Downloads só vêm dos servidores de conteúdo do Google, cada redirecionamento é conferido antes de ser seguido (no máximo 5 saltos) e o conteúdo baixado é verificado (MP4, PDF, PPTX, PNG/JPEG).
- Arquivos do PC enviados ao Google precisam ser documentos, imagens ou áudios de verdade, de uma lista fechada (o conteúdo é conferido; sem atalhos; chaves como `.env`, `.pem`, `id_rsa` nunca passam).
- Excluir notebooks, fontes, notas, itens do Estúdio ou personagens exige confirmação explícita.
- Texto vindo do NotebookLM e das fontes da web é marcado como dado, nunca como instrução.
- Um teto diário de créditos (200 por padrão) limita o estrago de um pedido repetido ou de um prompt malicioso.

## 12. Desenvolvimento

```powershell
npm run build   # TypeScript → dist/
npm test        # build + testes de unidade (node --test), sem rede nem navegador
```

- `src/index.ts` cria o servidor; as ferramentas são registradas a partir de `src/ferramentas/` (um módulo por grupo).
- `src/flow/`, `src/estudio/`, `src/notebook*.ts`: automação do Flow e do NotebookLM (Playwright).
- `src/seletores.ts`: todos os seletores, rótulos e chamadas internas. Quando o Google muda uma página, normalmente é o único arquivo a mexer.
- `src/navegador-*.ts`: escolha do navegador, fila do perfil e trava entre processos, prazos, tratamento de processos.
- `src/pastas.ts` (pasta de dados), `src/teto.ts` (teto diário), `src/seguranca.ts` / `src/download-seguro.ts` (sites permitidos, conferência de arquivos, downloads seguros).
- `test/ferramentas.test.mjs` compara as 58 ferramentas (nomes, descrições, esquemas) com uma fixture. Para regenerar de propósito: `MCP_GOOGLE_GERAR_FIXTURE=1 node --test test/ferramentas.test.mjs`.
- CI no GitHub Actions (`.github/workflows/ci.yml`): `npm ci`, build, testes e `npm audit` no Windows, com Node 22 e 24, a cada push na `main` e a cada pull request.
- Versões fixas: `@modelcontextprotocol/sdk` 1.32.1, `playwright` 1.63.0, `zod` 4.6.5. Cada arquivo de código fica abaixo de ~450 linhas.

## Licença

[MIT](LICENSE). Sem vínculo com o Google. Automatizar as páginas do Google viola os Termos de Serviço dele (veja o aviso no topo).
