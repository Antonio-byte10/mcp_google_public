# Histórico

## 0.16.1 — cópia pública

Em 22/10/2026, sem mudança de comportamento das ferramentas:
- **Cópia pública** (`mcp_google_public`), com histórico novo. O código já guardava tudo que é pessoal fora da pasta do projeto desde a 0.16.0; a revisão antes de publicar procurou nomes, e-mails, caminhos do autor, chaves e tokens no código, nos testes e na documentação.
- A conversa de exemplo dos testes (`test/dados/chat-khqZz.json`, um notebook de teste sobre tatus) teve os ids reais de conversa, mensagens e fontes trocados por ids fictícios.
- README e SECURITY.md em português do Brasil, com o endereço real do repositório no `git clone`. O SECURITY.md ganhou o que conta como vulnerabilidade e o que fica fora.
- **CI no GitHub Actions** (`.github/workflows/ci.yml`): `npm ci`, build, testes e `npm audit` no Windows, com Node 22 e 24, a cada push na `main` e a cada pull request.
- Node.js 22 ou mais novo (`engines`): o Node 20 saiu de suporte em abril de 2026.
- `package.json` com nome `mcp_google_public`, repositório, página e palavras-chave. O nome do servidor MCP (`mcp-google`) e a pasta de dados (`%LOCALAPPDATA%\mcp-google`) continuam os mesmos.
- 10 arquivos de teste, 94 casos (1 pulado quando o Windows não deixa criar link simbólico).

## 0.16.0

- Os dados (perfil do navegador, saídas, `config.json`) saíram da pasta do código e foram para `%LOCALAPPDATA%\mcp-google` (`MCP_GOOGLE_DADOS`, `MCP_GOOGLE_PERFIL`, `MCP_GOOGLE_SAIDAS`). Quem tem dados antigos na pasta do código recebe um aviso para movê-los.
- Teto diário de créditos do Flow (`MCP_GOOGLE_TETO_DIARIO`, 200 por padrão; `sem` desliga), conferido antes de enviar, com vídeos longos e roteiros em lote conferidos por inteiro.
