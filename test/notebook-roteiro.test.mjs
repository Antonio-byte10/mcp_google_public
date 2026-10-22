// Testes do roteiro do NotebookLM sem navegador: leitura da resposta no formato pedido.
// Rodar: npm test   (depois de npm run build)
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerRoteiro } from "../dist/notebook-roteiro.js";

// Resposta real do NotebookLM em 07/10/2026 (jabuti), com negrito e citações como ele costuma mandar.
const RESPOSTA = `**FATO:** Os jabutis ajudam a plantar novas árvores espalhando sementes de frutas pelas fezes durante suas longas caminhadas [1].
**TRECHO:** "Essa dispersão com o jabuti é muito rápida: em ambientes controlados, como cativeiros, é possível reparar que vão brotando pés de limão, mamão e até tomates." [1]
**CENARIO:** Seu Jabuti, um sábio e simpático jabuti em animação 3D usando óculos redondos, está parado em um jardim tropical ensolarado ao lado de um pezinho de mamão recém-brotado.
**FALA 1:** Você sabia que os jabutis são verdadeiros jardineiros da natureza, espalhando plantas por onde passam?
**FALA 2:** Enquanto andam devagar, eles comem muitas frutas e espalham as sementes pelo chão através das fezes [1].
**FALA 3:** Em cativeiro, já brotaram pés de limão, mamão e até tomate onde o jabuti passou!
**FALA 4:** Cada passeio ajuda a renovar o solo e as plantas. Curtiu? Segue pra mais curiosidades!
**LEGENDA:** Você sabia que os jabutis ajudam a plantar árvores enquanto caminham? #jabuti #curiosidades #animais #natureza`;

test("roteiro: lê os campos, tira negrito e citações [n]", () => {
  const r = lerRoteiro(RESPOSTA, 4);
  assert.equal(r.falas.length, 4);
  assert.equal(r.falas[1], "Enquanto andam devagar, eles comem muitas frutas e espalham as sementes pelo chão através das fezes.");
  assert.match(r.fato, /durante suas longas caminhadas\.$/);
  assert.match(r.trecho, /em ambientes controlados, como cativeiros/);
  assert.ok(!r.cenario.endsWith("."), "cenário sem ponto final (o prompt acrescenta)");
  assert.match(r.legenda, /#jabuti/);
});

test("roteiro: aceita campo com acento e texto quebrado em duas linhas", () => {
  const t = "CENÁRIO: Tatuzinho numa biblioteca\ncom luz quente\nFATO: x\nFALA 1: um dois três\nFALA 2: quatro cinco\nLEGENDA: #a";
  const r = lerRoteiro(t, 2);
  assert.equal(r.cenario, "Tatuzinho numa biblioteca com luz quente");
});

test("roteiro: aceita todos os campos numa linha só (como o chat devolveu em 07/10)", () => {
  const r = lerRoteiro(RESPOSTA.replace(/\n/g, " "), 4);
  assert.equal(r.falas[2], "Em cativeiro, já brotaram pés de limão, mamão e até tomate onde o jabuti passou!");
  assert.match(r.legenda, /^Você sabia/);
});

test("roteiro: recusa resposta fora do formato ou com número errado de falas", () => {
  assert.throws(() => lerRoteiro("Claro! Aqui vai uma ideia de vídeo sobre jabutis…", 4), /não veio no formato/);
  assert.throws(() => lerRoteiro(RESPOSTA, 5), /Pedi 5 falas e vieram 4/);
});
