const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-auditoria-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-17T20:00:00Z') });
const jid = '5593999001234@s.whatsapp.net';
fs.writeFileSync(path.join(process.env.DATA_DIR, 'historicos.json'), JSON.stringify({[jid]: [{role:'cliente', text:'Consigo ir para Bela Vista do Caracol. Maria da Silva'}]}));
const bot = require('../index');
const arquivo = path.join(process.env.DATA_DIR, 'agendamentos.json');
const dia = 'Sábado 19 de setembro em Bela Vista do Caracol-PA';
const seed = a => fs.writeFileSync(arquivo, JSON.stringify(a));
const ler = () => JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const marcar = (nome, horario) => '###AGENDAR###' + JSON.stringify({nome, horario});

test('vídeo: sim na escola é aceite mesmo com Trairão no endereço', () => {
  const hist = [{role:'atendente',text:'Antes de reservar, preciso confirmar o local: atendimento em Bela Vista do Caracol-PA, no endereço EMEIF Bela Vista de Caracol — TV Principal, s/n, Distrito de Caracol, Zona Rural, Trairão-PA. Você consegue se deslocar e comparecer nesse local?'}, {role:'cliente',text:'Sim sera na escola bela Vista do Caracol'}];
  assert.equal(bot.historicoConfirmaDeslocamento(hist, 'Bela Vista do Caracol-PA'), true);
});
test('normalização não transforma dia inexistente em outro dia da cidade', () => {
  const texto = 'Domingo 25 de setembro em Bela Vista do Caracol-PA às 08:00';
  assert.equal(bot.normalizarHorario(texto), texto);
  assert.equal(bot.normalizarHorario('sábado 19 de setembro em Bela Vista do Caracol-PA às 8:00'), `${dia} às 08:00`);
});
test('retorno após 24h e variação no nome não duplica reserva manual', () => {
  seed([{nome:'MARIA DA SILVA',telefone:'55 93 99900-1234',horario:`${dia} às 08:00`,criadoEm:'2026-09-01T10:00:00Z',origem:'manual'}]);
  const resposta = bot.processarResposta(marcar('Maria da Silva',`${dia} às 08:00`),jid);
  assert.equal(ler().length,1);
  assert.match(resposta,/08:00/);
});
test('reagendar pessoa inexistente não cria reserva nem exclui a família', () => {
  seed([{nome:'João da Silva',telefone:jid.split('@')[0],horario:`${dia} às 08:00`}]);
  const resposta = bot.processarResposta('###REAGENDAR###'+JSON.stringify({nome:'Maria da Silva',horarioAntigo:`${dia} às 08:00`,horarioNovo:`${dia} às 14:00`}),jid);
  assert.equal(ler().length,1);
  assert.doesNotMatch(resposta,/Agendamento confirmado/);
});
test('JSON de agenda corrompido nunca é substituído por uma lista vazia', () => {
  fs.writeFileSync(arquivo,'[{corrompido');
  assert.throws(()=>bot.carregarAgendamentos());
  bot.processarResposta(marcar('Maria da Silva',`${dia} às 08:00`),jid);
  assert.equal(fs.readFileSync(arquivo,'utf8'),'[{corrompido');
  seed([]);
});
test('número curto e LID não são identificados como outro telefone por sufixo', () => {
  assert.equal(bot.telefonesEquivalentes('1234',jid),false);
  assert.equal(bot.telefonesEquivalentes('5593999001234@lid',jid),false);
  assert.equal(bot.telefonesEquivalentes('(93) 99900-1234','5593999001234'),true);
});
test('pausa durante chamada da IA impede gravação e envio atrasados', async () => {
  seed([]);
  const original = global.fetch;
  let liberar;
  const pronta = new Promise(resolve => {liberar=resolve});
  const enviadas=[];
  global.fetch=async()=>{await pronta;return{ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({acao:'propor',nomes:['Maria da Silva'],horario:`${dia} às 08:00`,horarioAntigo:'',resposta:''})}]}}]})}};
  try {
    const trabalho=bot.responder({sendPresenceUpdate:async()=>{},sendMessage:async(_j,m)=>{enviadas.push(m);return{key:{id:'teste'}}}},jid,'Quero agendar em Caracol');
    bot.definirPausa(jid,true);
    liberar();
    await trabalho;
    assert.equal(enviadas.length,0);
    assert.equal(ler().length,0);
    assert.equal(bot.carregarPropostas()[jid],undefined);
  } finally {global.fetch=original;bot.definirPausa(jid,false)}
});
test('erro permanente da API não é tentado cinco vezes e texto truncado é rejeitado', async () => {
  const original=global.fetch;let chamadas=0;
  try {
    global.fetch=async()=>{chamadas++;return{ok:false,status:403,text:async()=> 'permissão negada'}};
    await assert.rejects(bot.chamarGemini({}),/403/);
    assert.equal(chamadas,1);
    global.fetch=async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Agendamento confir'}]}}]})});
    await assert.rejects(bot.chamarGemini({}),/incompleta/);
  } finally {global.fetch=original}
});
