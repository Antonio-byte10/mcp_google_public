// Fachada: os importadores (config, flow, index, notebook-base…) continuam usando "./navegador.js"
// e a implementação vive nos módulos navegador-*.ts (escolha, processos, login, contexto).
export { RAIZ, PASTA_DADOS, AVISO_DADOS, PASTA_PERFIL, NAVEGADOR, AVISO_NAVEGADOR, rotuloNavegador } from "./navegador-ativo.js";
export { iniciarLogin, janelaLoginAberta } from "./navegador-login.js";
export { MENSAGEM_SEM_SESSAO, abrirContexto, comPagina, conferirPagina, encerrarNavegador, irPara, sessaoAtiva } from "./navegador-contexto.js";
