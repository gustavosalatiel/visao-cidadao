const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T15:00:00Z') });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-np-bugs-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
const bot = require('../index');
const arq = path.join(process.env.DATA_DIR, 'agendamentos.json');
const agenda = () => (fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : []);
const marcar = (nome, horario) => '###AGENDAR###' + JSON.stringify({ nome, horario });
const PERGUNTA_IA = 'Em Novo Progresso-PA nosso atendimento será na Igreja Assembleia de Deus Pentecostal Missionária, na Rua Tapajós, 1031, Bairro Bela Vista, no final do asfalto, nos dias 15, 16 e 17 de outubro. Você consegue se deslocar e comparecer nesse local?';
let n = 0;
const novoJid = () => `5593977700${String(n++).padStart(2, '0')}@s.whatsapp.net`;

async function conversar(jid, passos) {
  const enviadas = [];
  const sock = { sendPresenceUpdate: async () => {}, sendMessage: async (_j, msg) => { enviadas.push(msg.text); return { key: { id: 'teste' + Math.random() } }; } };
  const originalFetch = global.fetch;
  let i = 0;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: passos[i++][1] }] } }] }) });
  try {
    for (const [fala] of passos) await bot.responder(sock, jid, fala);
  } finally { global.fetch = originalFetch; }
  return enviadas;
}

test('"Bairro Bela Vista" no endereço não anula o "Sim" do cliente de Novo Progresso', async () => {
  const jid = novoJid();
  const enviadas = await conversar(jid, [
    ['Andreia Souza Lima, Novo Progresso', PERGUNTA_IA],
    ['Sim', 'Seu exame gratuito está reservado. Veja os detalhes abaixo:\n' + marcar('Andreia Souza Lima', 'Sexta-feira 16 de outubro em Novo Progresso-PA às 08:00')],
  ]);
  assert.match(enviadas.at(-1), /Agendamento confirmado/);
  assert.equal(agenda().filter((a) => a.nome === 'Andreia Souza Lima').length, 1);
});

test('horário escrito pela IA com ano ou sem dia da semana ainda é reconhecido', async () => {
  for (const escrito of [
    'Sexta-feira 16 de outubro de 2026 em Novo Progresso-PA às 08:00',
    '16 de outubro em Novo Progresso-PA às 08:00',
    'Sexta-feira, 16 de outubro em Novo Progresso às 08:00',
  ]) {
    const jid = novoJid();
    const nome = `Pedro Alves ${escrito.length} Teste`;
    const enviadas = await conversar(jid, [
      [`${nome}, Novo Progresso`, PERGUNTA_IA],
      ['sim, dia 16', 'Reservado.\n' + marcar(nome, escrito)],
    ]);
    assert.match(enviadas.at(-1), /Agendamento confirmado/, escrito);
    assert.match(agenda().find((a) => a.nome === nome).horario, /^Sexta-feira 16 de outubro em Novo Progresso-PA às \d{2}:\d{2}$/);
  }
});

test('IA dizer "deixei reservado" sem marcação não vira oferta de lista reserva nem confirmação falsa', async () => {
  const jid = novoJid();
  const enviadas = await conversar(jid, [
    ['Carla Dias Moura, Novo Progresso', PERGUNTA_IA],
    ['Sim', 'Prontinho, Carla! Já deixei seu exame gratuito reservado, avisaremos os detalhes.'],
  ]);
  assert.doesNotMatch(enviadas.at(-1), /lista reserva/);
  assert.doesNotMatch(enviadas.at(-1), /deixei seu exame/);
  assert.match(enviadas.at(-1), /Novo Progresso-PA/);
  assert.equal(agenda().some((a) => a.nome === 'Carla Dias Moura'), false);
});

test('dia que não existe na agenda informa os dias com vaga na mesma cidade', () => {
  const texto = bot.processarResposta(marcar('Fulano de Tal', 'Domingo 18 de outubro em Novo Progresso-PA às 08:00'), novoJid());
  assert.match(texto, /Quinta-feira 15 de outubro e Sábado 17 de outubro/);
  assert.doesNotMatch(texto, /Uruará/);
});

test('emojis escritos pela IA não chegam ao cliente', async () => {
  const enviadas = await conversar(novoJid(), [['Oi', 'Olá! 😊 Aqui é o projeto Visão Cidadão ✨. Informe seu nome completo e sua cidade 👇🏻']]);
  assert.equal(enviadas.at(-1), 'Olá! Aqui é o projeto Visão Cidadão. Informe seu nome completo e sua cidade');
});

test('recusa de agendar familiar recebe sempre o convite fixo com o link, sem chamar a IA', async () => {
  for (const recusa of ['Não', 'só eu mesmo', 'N', 'nao precisa', 'Obrigada', 'não, muito obrigada viu']) {
    const jid = novoJid();
    const nome = `Tereza Melo ${recusa.length}${n} Prado`;
    const enviadas = await conversar(jid, [
      [`${nome}, Novo Progresso`, PERGUNTA_IA],
      ['Sim', 'Reservado.\n' + marcar(nome, 'Sexta-feira 16 de outubro em Novo Progresso-PA às 08:00')],
      [recusa, 'RESPOSTA DA IA QUE NÃO DEVE SER USADA'],
    ]);
    assert.match(enviadas.at(-2), /Quer agendar para mais algum familiar também\?$/);
    assert.match(enviadas.at(-1), /^Pedimos, por gentileza, que compartilhe nosso link .*https:\/\/wa\.me\/message\/ZQKGY2AQYXRKA1$/, recusa);
  }
});

test('quem quer agendar familiar não recebe o convite do link no lugar do agendamento', async () => {
  const jid = novoJid();
  const enviadas = await conversar(jid, [
    ['Beatriz Lopes Farias, Novo Progresso', PERGUNTA_IA],
    ['Sim', 'Reservado.\n' + marcar('Beatriz Lopes Farias', 'Sexta-feira 16 de outubro em Novo Progresso-PA às 08:00')],
    ['sim, meu marido', 'Por favor, informe o nome completo do familiar.'],
  ]);
  assert.equal(enviadas.at(-1), 'Por favor, informe o nome completo do familiar.');
});
