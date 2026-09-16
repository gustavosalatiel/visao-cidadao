const test = require("node:test");
const assert = require("node:assert/strict");

const { historicoConfirmaDeslocamento } = require("../index");

const cliente = (text) => ({ role: "cliente", text });
const atendente = (text) => ({ role: "atendente", text });

test("não aceita a cidade de origem como autorização para outro município", () => {
  const historico = [cliente("Meu nome é Reinaldo e sou de Novo Progresso")];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), false);
});

test("não transforma uma confirmação errada anterior em consentimento", () => {
  const historico = [
    cliente("Sou de Novo Progresso"),
    atendente("Deixei seu exame reservado na cidade mais próxima, em Moraes de Almeida-PA."),
    cliente("Qual é o endereço?"),
  ];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), false);
});

test("aceita sim após pergunta clara sobre um único local", () => {
  const historico = [
    atendente("O atendimento será em Moraes de Almeida. Você consegue ir até esse local?"),
    cliente("Sim, consigo"),
  ];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), true);
});

test("não aceita sim genérico quando foram oferecidas várias cidades", () => {
  const historico = [
    atendente("Temos Moraes de Almeida e Trairão. Você consegue ir a qual dessas cidades?"),
    cliente("Sim"),
  ];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), false);
});

test("aceita a escolha explícita após oferecer várias cidades", () => {
  const historico = [
    atendente("Temos Moraes de Almeida e Trairão. Você consegue ir a qual dessas cidades?"),
    cliente("Consigo ir para Moraes de Almeida"),
  ];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), true);
});

test("recusa uma resposta que declara impossibilidade de deslocamento", () => {
  const historico = [
    atendente("O atendimento será em Moraes de Almeida. Você consegue ir até esse local?"),
    cliente("Sim, mas não consigo ir até Moraes"),
  ];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), false);
});

test("aceita declaração direta e inequívoca sobre o destino", () => {
  const historico = [cliente("Eu consigo ir para Moraes de Almeida")];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), true);
});

test("não confunde Itaituba com consentimento para Moraes de Almeida", () => {
  const historico = [cliente("Sou de Itaituba e quero agendar")];
  assert.equal(historicoConfirmaDeslocamento(historico, "Moraes de Almeida-PA"), false);
});

test("não confunde Pacajá com consentimento para uma cidade atendida", () => {
  const historico = [cliente("Moro em Pacajá")];
  assert.equal(historicoConfirmaDeslocamento(historico, "Divinópolis-PA"), false);
});
