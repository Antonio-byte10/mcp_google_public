# Política de segurança

## Reportar uma vulnerabilidade

Não abra uma issue pública para falhas de segurança. Use o **relato privado do GitHub**: aba *Security* → *Report a vulnerability* deste repositório. Descreva o que acontece, como reproduzir e a versão (o `diagnostico` mostra). Não inclua dados reais de ninguém (cookies, perfil do navegador, arquivos gerados, conteúdo de notebooks).

## O que está em jogo

| Ativo | Onde fica | Risco principal |
|---|---|---|
| A sua sessão Google (cookies) | `%LOCALAPPDATA%\mcp-google\perfil-edge\` (ou `perfil-chrome\`) | Vazar por logs, respostas das ferramentas, Git ou pasta compartilhada → alguém usa a sua conta |
| Créditos do Flow | a sua conta Google | Gasto por engano (pedido repetido, prompt malicioso) |
| Arquivos do seu PC | disco | Um pedido malicioso fazer o servidor enviar arquivos pessoais ao Google |
| A própria conta | Google | Restrição por automação (risco aceito, veja abaixo) |

**Quem pode atacar:** conteúdo de terceiros que chega ao Claude (páginas web, PDFs, fontes de notebooks, respostas do NotebookLM) tentando fazer o Claude usar mal as ferramentas (*prompt injection*). O servidor não abre porta de rede; só o app do Claude no mesmo PC fala com ele, por stdio.

## O que é considerado vulnerabilidade

- Uma ferramenta gastar créditos do Flow acima de `max_creditos`, do teto diário ou sem o custo conferido antes.
- Texto vindo do NotebookLM, do Flow ou de uma fonte conseguir fazer o servidor executar uma ação, ler ou gravar fora das pastas de dados, ou enviar um arquivo fora da lista permitida.
- Vazamento de cookies, tokens ou links assinados em logs, respostas das ferramentas ou arquivos de estado.
- Navegação ou download fora dos sites permitidos (lista abaixo).
- Exclusão de notebooks, fontes, notas, itens do Estúdio ou personagens sem `confirmar: true`.

## O que fica fora

- Restrição da conta pelo Google: automatizar as páginas do Google viola os Termos de Serviço (veja o aviso no [README](README.md)). Esse risco é de quem usa.
- Problemas que dependem de acesso prévio à sua máquina ou à sua pasta de dados.

## Controles

**Sessão e senha**
- O login é manual, numa janela normal (sem automação) do Edge ou do Chrome aberta pelo `login_iniciar`; o servidor nunca vê a senha.
- O `login_status` só confere se os cookies de sessão existem; nunca lê nem devolve os valores.
- Perfil, saídas e preferências ficam fora da pasta do código (`%LOCALAPPDATA%\mcp-google` por padrão, que herda as permissões por usuário do Windows). O `.gitignore` ainda exclui `perfil*`, `saidas` e `config.json` como rede de segurança.
- Toda mensagem de erro passa por `mensagemDeErro()` (`src/seguranca.ts`), que tira o call log do Playwright, cabeçalhos `cookie`/`authorization`, valores de cookies de sessão do Google (`SID`, `__Secure-*`, `__Host-*`, `NID`, `SAPISIDHASH`…), linhas de comando do navegador e parâmetros de URLs assinadas, e limita o tamanho. Erros não tratados do processo passam pelo mesmo filtro antes de chegar ao log.

**Navegação e rede**
- A automação só age em `notebook.google.com` e `flow.google.com`, além de `drive.google.com` / `docs.google.com` apenas para transformar os slides do Estúdio em Google Apresentações (envia o `.pptx` para o Meu Drive, converte e manda o arquivo enviado para a lixeira; nada é compartilhado).
- Cair em `accounts.google.com` é tratado como sessão expirada; o servidor nunca digita nada lá.
- Downloads só são permitidos do servidor de mídia do Flow (`flow-content.google`, `flow.google.com/asb/`) e dos servidores de arquivos do NotebookLM (`lh3`–`lh6.googleusercontent.com`, o redirecionador `rd-notebooklm`, `drum`/`contribution` `*.usercontent.google.com`), não de qualquer `*.googleusercontent.com`. Cada redirecionamento é conferido com a lista **antes** de ser seguido (no máximo 5 saltos, com prazo total; `src/download-seguro.ts`).
- O conteúdo baixado é conferido pelos bytes (MP4/M4A, PDF, PPTX, PNG/JPEG/WebP/GIF) antes de ser salvo. Links assinados nunca vão para logs nem respostas.
- Ids de projeto, notebook e mídia são extraídos com padrões de UUID; nada de um pedido vira parte de uma URL sem essa validação.
- Sem modo HTTP, sem telemetria.

**Arquivos do seu PC**
- Imagens enviadas ao Flow: caminho absoluto, arquivo comum (sem atalhos nem links simbólicos), até 20 MB, `.png/.jpg/.jpeg/.webp` **e** bytes iniciais correspondentes.
- Arquivos enviados ao NotebookLM: caminho absoluto, arquivo comum e não vazio, até 200 MB, extensão de uma lista fechada de documentos, imagens e áudio **e** conteúdo correspondente (um `.pdf` falso ou um executável renomeado é recusado). Segredos (`.env`, `.pem`, `.key`, `id_rsa`, `.json` de credenciais…) nunca são aceitos.
- Caminhos de rede (`\\servidor\…`, `//servidor`, `\\?\`) são recusados antes de o Windows tocar neles (evita vazar o hash NTLM por SMB).
- Limite conhecido: uma imagem ou um documento pessoal *permitido* ainda pode ser enviado se o Claude for enganado. Ele vai para a sua própria conta, privada, e o app do Claude pede permissão para ferramentas de escrita.

**Arquivos gravados**
- Os nomes das saídas são gerados pelo servidor (data + título limpo) e sempre caem nas subpastas fixas de `saidas`; a pasta nunca vem do pedido. Os arquivos são criados em modo exclusivo (nunca sobrescrevem).
- Arquivos de estado (`*.json`, `geracoes.jsonl`, `config.json`) são alterados sob uma trava por arquivo e gravados de forma atômica, porque o Claude Code e o Claude Desktop podem rodar o servidor ao mesmo tempo. Eles guardam prompts, ids e caminhos, nunca cookies nem links assinados.
- As capturas de erro (`saidas\_erros\`) podem mostrar o e-mail da conta num canto; elas ficam no seu PC.
- Os leitores de MP4 (`src/emendas.ts`) limitam cada tabela (1 milhão de entradas) e a conferem com o buffer, então um arquivo corrompido ou malicioso falha de forma limpa.

**Créditos e uso**
- O custo é lido da tela do Flow **antes** de gerar e precisa passar por `max_creditos` (se pedido), pelo **teto diário** (`src/teto.ts`: 200 créditos/dia por padrão, contados em `geracoes.jsonl`; `MCP_GOOGLE_TETO_DIARIO` muda ou desliga; valores inválidos impedem o servidor de iniciar) e pelo saldo da conta. Vídeos longos e roteiros em lote são conferidos por inteiro antes do primeiro pedido.
- Gerações em andamento são registradas e só acompanhadas/baixadas, nunca geradas de novo. O `flow_custo` simula sem gerar.
- As ferramentas do Estúdio leem antes a estimativa de uso do NotebookLM; `uso_maximo` recusa gerar acima de um teto.

**Ferramentas e visualizador**
- Todas as entradas são validadas com `zod` (tipos, listas fechadas, tamanhos máximos). Ferramentas só de leitura levam `readOnlyHint`; excluir notebooks, fontes, notas, itens do Estúdio ou personagens exige `confirmar: true` e leva `destructiveHint`. Um nome parcial que bate com mais de um item para e lista os candidatos. Não existe ferramenta para compartilhar notebook.
- As chamadas internas do NotebookLM (`batchexecute`) são feitas de dentro da página aberta, só de leitura, com o token da própria página; toda alteração passa pela interface.
- O texto do NotebookLM e das fontes é marcado como conteúdo das fontes, não como instrução.
- O visualizador do Claude Desktop não carrega nada externo, só aceita mensagens do app hospedeiro, e o `flow_arquivo` só serve nomes simples de mídias/documentos gerados (sem caminhos, sem `..`, sem arquivos de estado, até 60 MB) das pastas de saída. Fica desligado no Claude Code.

**Concorrência**
- Uma tarefa por vez por perfil do navegador: fila no processo e trava entre processos por named pipe do Windows (liberada pelo Windows se o processo morrer). Depois de uma tarefa, a fila espera (até 90 s) o processo do navegador anterior sair antes de o próximo abrir o perfil.
- Toda tarefa tem prazo máximo; um vigia fecha à força só o navegador que este processo abriu (o nosso `--user-data-dir`, filho do nosso processo Node). A janela de login nunca é fechada.
- O servidor encerra quando o app do Claude fecha a conexão; uma cópia que nunca recebe `initialize` encerra depois de 60 s.

**Dependências**
- Versões exatas, `package-lock.json` no repositório. `npm audit`: 0 vulnerabilidades (22/10/2026); o CI roda o `npm audit` a cada push.

## Riscos aceitos

- **Termos de Serviço do Google:** automatizar a interface web não é permitido e a conta pode ser restringida. O servidor usa um Edge/Chrome de verdade, sem técnicas de evasão.
- **Mudanças de interface:** o Google muda as páginas sem aviso. O `diagnostico` com `completo=true` diz qual item de `src/seletores.ts` mudou (ele só abre e fecha menus; nada é gerado).

## Dados pessoais

O repositório nunca deve conter dados reais. A pasta de dados (perfil do navegador, saídas, preferências) fica fora do código e está no `.gitignore`. A conversa de exemplo usada nos testes (`test/dados/chat-khqZz.json`) vem de um notebook de teste sobre tatus, com os ids trocados por ids fictícios. Se você achar algum dado pessoal no repositório, avise pelo mesmo canal.
