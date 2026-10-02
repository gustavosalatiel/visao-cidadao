const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-02T15:00:00Z') });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-placas-moraes-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
const jidPlacas = '559395550001@s.whatsapp.net';
const jidMoraes = '559395550002@s.whatsapp.net';
const aceite = (cidade) => [
  { role: 'atendente', text: `O atendimento será em ${cidade}. Você consegue se deslocar e comparecer nesse local?` },
  { role: 'cliente', text: 'Sim' },
];
fs.writeFileSync(path.join(process.env.DATA_DIR, 'historicos.json'), JSON.stringify({ [jidPlacas]: aceite('Placas-PA'), [jidMoraes]: aceite('Moraes de Almeida-PA') }));
fs.writeFileSync(path.join(process.env.DATA_DIR, 'lista-reserva.json'), JSON.stringify([{ nome: 'Francisca Oliveira Santos', telefone: '5593999990009', cidade: 'Placas' }]));
const bot = require('../index');
const marcar = (nome, horario) => '###AGENDAR###' + JSON.stringify({ nome, horario });

test('Placas: agenda no dia 20 com o endereço do Centro Médico Alcântara', () => {
  const texto = bot.processarResposta(marcar('Raimundo Nonato Silva', 'Terça-feira 20 de outubro em Placas-PA às 08:00'), jidPlacas);
  assert.match(texto, /Agendamento confirmado/);
  assert.match(texto, /Terça-feira 20 de outubro/);
  assert.match(texto, /Centro Médico Alcântara — Avenida Perimetral Sul, Centro \(próximo à Padaria Galvão\)/);
});

test('Moraes de Almeida: agenda no domingo 18 com o endereço novo', () => {
  const texto = bot.processarResposta(marcar('Antônia Ferreira Lima', 'Domingo 18 de outubro em Moraes de Almeida-PA às 08:00'), jidMoraes);
  assert.match(texto, /Agendamento confirmado/);
  assert.match(texto, /Domingo 18 de outubro/);
  assert.match(texto, /Escola César Almeida — Rodovia BR-163, km 01, Distrito de Moraes de Almeida/);
});

test('prompt tem Placas e Moraes de outubro, sem as regras antigas de setembro nem Placas "em negociação"', () => {
  const prompt = bot.promptSistema(jidMoraes);
  assert.match(prompt, /- Terça-feira 20 de outubro em Placas-PA às/);
  assert.match(prompt, /- Domingo 18 de outubro em Moraes de Almeida-PA às/);
  assert.doesNotMatch(prompt, /de setembro em Moraes de Almeida-PA às/);
  assert.doesNotMatch(prompt, /priorize o dia 16 de setembro|ATENDIMENTO EM NEGOCIAÇÃO|sábado 19 e o primeiro horário/);
  assert.match(prompt, /CASO ESPECIAL — ITAITUBA\/MORAES DE ALMEIDA/);
});

test('quem é de Placas agora agenda, não vai mais para a lista reserva', () => {
  const texto = bot.processarResposta('###LISTA_RESERVA###' + JSON.stringify({ nome: 'Pedro Lima Souza', cidade: 'Placas' }), jidPlacas);
  assert.equal(bot.carregarListaReserva().some((a) => a.nome === 'Pedro Lima Souza'), false);
  assert.match(texto, /Placas-PA/);
});

test('IA que diz "reservado" sem marcação é chamada de novo e o agendamento sai na mesma resposta', async () => {
  const jid = '559395550003@s.whatsapp.net';
  const enviadas = [];
  const sock = { sendPresenceUpdate: async () => {}, sendMessage: async (_j, msg) => { enviadas.push(msg.text); return { key: { id: 'x' + Math.random() } }; } };
  const respostas = [
    'O atendimento será em Placas-PA, no Centro Médico Alcântara. Você consegue se deslocar e comparecer nesse local?',
    'Seu exame gratuito está reservado. Veja os detalhes abaixo:',
    'Seu exame gratuito está reservado.\n###AGENDAR###{"nome":"Francisca Oliveira Santos","horario":"Terça-feira 20 de outubro em Placas-PA às 08:00"}',
  ];
  let chamadas = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: respostas[chamadas++] }] } }] }) });
  try {
    await bot.responder(sock, jid, 'Francisca Oliveira Santos, moro em Placas');
    await bot.responder(sock, jid, 'sim');
  } finally { global.fetch = originalFetch; }
  assert.equal(chamadas, 3);
  assert.match(enviadas.at(-1), /Agendamento confirmado/);
  assert.match(enviadas.at(-1), /Terça-feira 20 de outubro/);
});
