const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-reservas-'));
// Exercita o modo legado de espera, antes da publicação das datas.
const cfg = require('../config');
cfg.HORARIOS = cfg.HORARIOS.filter(h => !h.includes('em Novo Progresso-PA às'));
const { textoMencionaNovoProgresso, processarResposta, carregarListaEsperaNovoProgresso } = require('../index');

test('reconhece Novo Progresso com variações de escrita', () => {
  for (const texto of ['Sou de Novo Progresso', 'NOVO PROGRESSSO', 'novo  progresso']) {
    assert.equal(textoMencionaNovoProgresso(texto), true);
  }
  assert.equal(textoMencionaNovoProgresso('Sou de Trairão'), false);
});

test('salva nomes da família como reservas sem data e evita duplicação', () => {
  const jid = '5593999990000@s.whatsapp.net';
  const resposta = 'Vagas reservadas para início de outubro. ' +
    '###LISTA_ESPERA_NOVO_PROGRESSO###{"nome":"Maria Silva"} ' +
    '###LISTA_ESPERA_NOVO_PROGRESSO###{"nome":"João Silva"}';
  assert.doesNotMatch(processarResposta(resposta, jid), /###/);
  processarResposta(resposta, jid);
  const lista = carregarListaEsperaNovoProgresso();
  assert.equal(lista.length, 2);
  assert.deepEqual(lista.map(x => x.nome), ['Maria Silva', 'João Silva']);
  assert.ok(lista.every(x => x.status === 'aguardando_data' && !x.horario));
});

test('não confirma reserva sem nome válido', () => {
  const resposta = processarResposta('Vaga reservada! ###LISTA_ESPERA_NOVO_PROGRESSO###{"nome":""}', '5593999990001@s.whatsapp.net');
  assert.match(resposta, /nome completo/);
  assert.equal(carregarListaEsperaNovoProgresso().length, 2);
});

test('falha na persistência não confirma a reserva', () => {
  const original = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('Falha simulada'); };
  try {
    assert.match(processarResposta('Vaga reservada! ###LISTA_ESPERA_NOVO_PROGRESSO###{"nome":"Ana Souza"}', '5593999990002@s.whatsapp.net'), /Não consegui salvar/);
  } finally {
    fs.writeFileSync = original;
  }
});
