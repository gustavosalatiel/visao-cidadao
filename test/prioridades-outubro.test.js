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

test('Novo Progresso dia 15 está fechado para novos: oferece 16 e 17 e não grava no dia 15', () => {
  const texto = bot.processarResposta(marcar('Pessoa Dia Quinze', `${NP15} às 14:00`), jids[0]);
  assert.equal(agenda().some((a) => a.nome === 'Pessoa Dia Quinze'), false);
  assert.match(texto, /Sexta-feira 16 de outubro e Sábado 17 de outubro/);
  assert.doesNotMatch(texto, /Quinta-feira 15/);
  assert.doesNotMatch(bot.promptSistema(jids[0]), new RegExp(`- ${NP15}`));
});

test('familiar de quem já está no dia 15 não reabre o dia 15', () => {
  fs.writeFileSync(arq, JSON.stringify([...agenda(), { nome: 'Titular Dia Quinze', telefone: jids[1].split('@')[0], horario: `${NP15} às 08:00` }]));
  const texto = bot.processarResposta(marcar('Filho Do Titular', `${NP15} às 08:00`), jids[1]);
  assert.equal(agenda().some((a) => a.nome === 'Filho Do Titular'), false);
  assert.match(texto, /Sexta-feira 16 de outubro/);
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
