const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-reserva-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
const bot = require('../index');
const jid = '559399991234@s.whatsapp.net';
const marcar = (nome, cidade) => '###LISTA_RESERVA###' + JSON.stringify({ nome, cidade });

async function conversar(mensagensIA, falas) {
  const enviadas = [];
  const sock = { sendPresenceUpdate: async () => {}, sendMessage: async (_j, msg) => { enviadas.push(msg.text); return { key: { id: 'teste' } }; } };
  const originalFetch = global.fetch;
  let i = 0;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: mensagensIA[i++] }] } }] }) });
  try {
    for (const fala of falas) await bot.responder(sock, jid, fala);
  } finally { global.fetch = originalFetch; }
  return enviadas;
}

test('lista reserva grava quem não consegue ir e só confirma depois de salvar', async () => {
  const enviadas = await conversar(
    ['Entendo! Vou te deixar na lista reserva.\n' + marcar('Joana Pereira da Silva', 'Altamira-PA')],
    ['Sou Joana Pereira da Silva de Altamira, não consigo ir em nenhuma dessas']
  );
  const lista = bot.carregarListaReserva();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'Joana Pereira da Silva');
  assert.equal(lista[0].cidade, 'Altamira');
  assert.equal(lista[0].telefone, '559399991234');
  assert.match(enviadas.at(-1), /lista reserva de Altamira./);
  assert.doesNotMatch(enviadas.at(-1), /###/);
});

test('lista reserva recusa nome que o cliente não escreveu', async () => {
  const enviadas = await conversar([marcar('Carlos Inventado Souza', 'Altamira-PA')], ['meu marido também quer']);
  assert.equal(bot.carregarListaReserva().some((a) => a.nome === 'Carlos Inventado Souza'), false);
  assert.match(enviadas.at(-1), /nome completo/);
});

test('promessa de anotar sem marcação não é enviada ao cliente', async () => {
  const enviadas = await conversar(
    ['Vou deixar seu contato anotado e avisamos assim que a carreta passar mais perto 😊'],
    ['é muito longe pra mim']
  );
  assert.doesNotMatch(enviadas.at(-1), /deixar seu contato anotado/);
  assert.match(enviadas.at(-1), /nome completo e a cidade/);
});

test('mesma cidade escrita de jeitos diferentes fica num só município', async () => {
  await conversar([marcar('Maria Souza Lima', 'altamira - pa')], ['Maria Souza Lima, também de Altamira, é longe']);
  await conversar([marcar('José Ribeiro Neto', 'MEDICILANDIA/PA')], ['José Ribeiro Neto, Medicilândia']);
  await conversar([marcar('Ana Paula Ribeiro', 'Medicilândia')], ['Ana Paula Ribeiro']);
  const porCidade = {};
  for (const a of bot.carregarListaReserva()) (porCidade[a.cidade] ||= []).push(a.nome);
  assert.deepEqual(Object.keys(porCidade).sort(), ['Altamira', 'Medicilândia']);
  assert.equal(porCidade.Altamira.length, 2);
  assert.equal(porCidade['Medicilândia'].length, 2);
});

test('Placas (atendimento em negociação): prompt manda direto para a lista reserva e o nome mantém os acentos do cliente', async () => {
  assert.match(bot.promptSistema(jid), /ATENDIMENTO EM NEGOCIAÇÃO — Placas/);
  const enviadas = await conversar([marcar('Joao Batista Conceicao', 'Placas-PA')], ['sou de placas, meu nome é joão Batista Conceição']);
  const salvo = bot.carregarListaReserva().find((a) => a.cidade === 'Placas');
  assert.equal(salvo.nome, 'João Batista Conceição');
  assert.match(enviadas.at(-1), /Estamos organizando o atendimento em Placas, ainda sem data confirmada/);
});
