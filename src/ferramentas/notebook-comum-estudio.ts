import { descreverRelatorio, NOMES_TIPO, type ResultadoEstudio } from "../notebook-estudio.js";
import { descreverUso } from "../notebook-base.js";
import { AVISO_CONTEUDO, MAX_TEXTO } from "./notebook-comum.js";

export function descreverGeracaoEstudio(r: ResultadoEstudio): string {
  const linhas = [`${NOMES_TIPO[r.tipo]} no notebook ${r.notebook}`];
  if (r.opcoes.length) linhas.push(`Opções: ${r.opcoes.join(" · ")}`);
  if (r.medidor) linhas.push(`Uso da IA: ${r.medidor.usado}% antes; este item usa ~${r.medidor.estimado}% do limite atual.`);
  if (r.avisos.length) linhas.push(`Avisos: ${r.avisos.join(" ")}`);
  linhas.push("", descreverRelatorio(r.relatorio, MAX_TEXTO));
  if (r.usoDepois) linhas.push("", `Uso agora: ${descreverUso(r.usoDepois)}`);
  if (r.relatorio.texto) linhas.push("", AVISO_CONTEUDO);
  return linhas.join("\n");
}
