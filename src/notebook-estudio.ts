// Estúdio do NotebookLM: Resumo em Áudio, Resumo em Vídeo, slides, mapa mental, relatórios,
// cartões, teste, infográfico e tabela de dados. Gera pela tela (com as opções de cada diálogo),
// acompanha pelas leituras internas e salva o resultado na pasta de saídas.
// O código mora em src/estudio/; este arquivo só reexporta a API que o resto do MCP usa.
export { descreverUso } from "./notebook-base.js";
export { NOMES_TIPO, itensDoEstudio, descreverItem, type ItemEstudio, type FormatoBaixar, type RelatorioItem, type LoteEstudio } from "./estudio/tipos.js";
export type { PedidoEstudio } from "./estudio/opcoes.js";
export { pendentesEstudio } from "./estudio/lotes.js";
export { gerarItemEstudio, type ResultadoEstudio } from "./estudio/gerar.js";
export { statusEstudio } from "./estudio/acompanhar.js";
export { baixarItemEstudio, descreverRelatorio, excluirItemEstudio, listarEstudio, renomearItemEstudio } from "./estudio/itens.js";
export { exportarItemEstudio, type DestinoExportar, type Exportacao } from "./estudio/exportar.js";
