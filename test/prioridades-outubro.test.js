const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-30T15:00:00Z') });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-prioridades-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
const NP15 = 'Quinta-feira 15 de outubro em Novo Progresso-PA';
const NP16 = 'Sexta-feira 16 de outubro em Novo Progresso-PA';
const NP17 = 'Sábado 17 de outubro em Novo Progresso-PA';
const U21 = 'Quarta-feira 21 de outubro em Uruará-PA';
const U22 = 'Quinta-feira 22 de outubro em Uruará-PA';
let n = 0;
const novoJid = () => `5593966600${String(n++).padStart(2, '0')}@s.whatsapp.net`;
const aceite = (cidade) => [
  { role: 'atendente', text: `O atendimento será em ${cidade}. Você consegue se deslocar e comparecer nesse local?` },
  { role: 'cliente', text: 'Sim' },
];
const jids = Array.from({ length: 80 }, novoJid);
const historicos = {};
jids.slice(0, 40).forEach((j) => { historicos[j] = aceite('Novo Progresso-PA'); });
jids.slice(40, 70).forEach((j) => { historicos[j] = aceite('Uruará-PA'); });
historicos[jids[12]] = [...aceite('Novo Progresso-PA'), { role: 'cliente', text: 'quero na quinta, dia 15' }];
historicos[jids[20]] = [...aceite('Novo Progresso-PA'), { role: 'cliente', text: 'prefiro na sexta, dia 16' }];
historicos[jids[70]] = [...aceite('Uruará-PA'), { role: 'cliente', text: 'quero dia 21' }];
historicos[jids[71]] = [...aceite('Uruará-PA'), { role: 'cliente', text: 'não consigo dia 22, só posso na quarta' }];
fs.writeFileSync(path.join(process.env.DATA_DIR, 'historicos.json'), JSON.stringify(historicos));
const bot = require('../index');
const arq = path.join(process.env.DATA_DIR, 'agendamentos.json');
const agenda = () => (fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : []);
const marcar = (nome, horario) => '###AGENDAR###' + JSON.stringify({ nome, horario });
const hora = (a) => a.horario.slice(-5);
const periodo = (a) => (Number(hora(a).slice(0, 2)) < 12 ? 'manhã' : 'tarde');

test('Novo Progresso sem dia escolhido vai para o dia 17, só às 08:00 e 14:00, alternando', () => {
  for (let i = 0; i < 6; i++) bot.processarResposta(marcar(`Pessoa Padrao ${i} Lima`, `${NP15} às 09:00`), jids[i]);
  const novos = agenda().filter((a) => a.nome.startsWith('Pessoa Padrao'));
  assert.ok(novos.every((a) => a.horario.startsWith(NP17)), JSON.stringify(novos.map((a) => a.horario)));
  assert.deepEqual(novos.map(hora), ['08:00', '14:00', '08:00', '14:00', '08:00', '14:00']);
});

test('quem pede o dia 15 fica no dia 15, só às 08:00 ou 14:00', () => {
  bot.processarResposta(marcar('Pede Quinze Lima', `${NP15} às 10:00`), jids[12]);
  const a = agenda().find((x) => x.nome === 'Pede Quinze Lima');
  assert.ok(a.horario.startsWith(NP15) && /^(08|14):00$/.test(hora(a)), a.horario);
});

test('sem pedir o dia 16, a IA marcar dia 16 vai para o dia 17; dia 16 não é oferecido', () => {
  bot.processarResposta(marcar('Pessoa Sem Pedido Lima', `${NP16} às 08:00`), jids[10]);
  assert.ok(agenda().find((a) => a.nome === 'Pessoa Sem Pedido Lima').horario.startsWith(NP17));
  const prompt = bot.promptSistema(jids[10]);
  assert.match(prompt, /USAR SOMENTE SE A PESSOA PEDIR ESTE DIA/);
  const texto = bot.processarResposta(marcar('Sem Aceite Np Teste', `${NP15} às 08:00`), novoJid());
  assert.match(texto, /Quinta-feira 15 de outubro e Sábado 17 de outubro/);
  assert.doesNotMatch(texto, /Sexta-feira 16/);
});

test('Novo Progresso dia 17 só às 08:00 e 14:00', () => {
  historicos[jids[11]] = [...aceite('Novo Progresso-PA'), { role: 'cliente', text: 'prefiro sábado dia 17' }];
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'historicos.json'), JSON.stringify(historicos));
  bot.processarResposta(marcar('Pessoa Dezessete Lima', `${NP17} às 10:00`), jids[11]);
  assert.match(hora(agenda().find((a) => a.nome === 'Pessoa Dezessete Lima')), /^(08|14):00$/);
});

test('Novo Progresso dia 16 para quem pede segue a regra normal (manhã primeiro)', () => {
  bot.processarResposta(marcar('Pessoa Dia Dezesseis', `${NP16} às 14:00`), jids[20]);
  assert.equal(agenda().find((a) => a.nome === 'Pessoa Dia Dezesseis').horario, `${NP16} às 08:00`);
});

test('Uruará vai para o dia 22 e alterna manhã e tarde', () => {
  for (let i = 0; i < 8; i++) bot.processarResposta(marcar(`Pessoa Uruara ${i}`, `${U21} às 08:00`), jids[40 + i]);
  const uruara = agenda().filter((a) => a.horario.includes('Uruará'));
  assert.ok(uruara.every((a) => a.horario.startsWith(U22)), JSON.stringify(uruara.map((a) => a.horario)));
  assert.deepEqual(uruara.map(periodo), ['manhã', 'tarde', 'manhã', 'tarde', 'manhã', 'tarde', 'manhã', 'tarde']);
});

test('Uruará dia 21 só para quem pede o dia 21 ou não pode no dia 22', () => {
  bot.processarResposta(marcar('Pediu Vinte Um', `${U21} às 08:00`), jids[70]);
  bot.processarResposta(marcar('Recusou Vinte Dois', `${U21} às 08:00`), jids[71]);
  assert.ok(agenda().find((a) => a.nome === 'Pediu Vinte Um').horario.startsWith(U21));
  assert.ok(agenda().find((a) => a.nome === 'Recusou Vinte Dois').horario.startsWith(U21));
});

test('dia 21 de Uruará não é oferecido nas mensagens enquanto o dia 22 tem vaga', () => {
  const texto = bot.processarResposta(marcar('Sem Aceite Teste', `${U22} às 08:00`), novoJid());
  assert.match(texto, /Quinta-feira 22 de outubro/);
  assert.doesNotMatch(texto, /21 de outubro/);
});

test('"Eu sim" vale como confirmação do local', () => {
  const hist = [
    { role: 'atendente', text: 'Antes de reservar, preciso confirmar o local: o atendimento será em *Novo Progresso-PA*, nos dias *Quinta-feira 15 de outubro e Sexta-feira 16 de outubro*, no endereço *Igreja Assembleia de Deus Pentecostal Missionária — Rua Tapajós, 1031, Bairro Bela Vista, no final do asfalto*. Você consegue se deslocar e comparecer nesse local?' },
    { role: 'cliente', text: 'Eu sim' },
    { role: 'atendente', text: 'O exame é gratuito. Posso confirmar seu agendamento?' },
    { role: 'cliente', text: 'Sim' },
  ];
  assert.equal(bot.historicoConfirmaDeslocamento(hist, 'Novo Progresso-PA'), true);
  assert.equal(bot.historicoConfirmaDeslocamento(hist, 'Bela Vista do Caracol-PA'), false);
});
