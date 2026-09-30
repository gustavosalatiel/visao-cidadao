const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'bot-uruara-'));
process.env.AUTH_DIR=path.join(process.env.DATA_DIR,'auth');delete process.env.LIMPAR_AUTH;
mock.timers.enable({apis:['Date'],now:new Date('2026-09-28T15:00:00Z')});
const jid='5593999901234@s.whatsapp.net';
fs.writeFileSync(path.join(process.env.DATA_DIR,'historicos.json'),JSON.stringify({[jid]:[{role:'cliente',text:'Meu nome é Maria Teste. Consigo ir para Uruara no dia 22 de outubro.'}]}));
const cfg=require('../config'),bot=require('../index');
test('Uruará tem os dois dias do cartaz e os seis horários padrão',()=>{
  const horarios=cfg.HORARIOS.filter(h=>h.includes('em Uruará-PA'));
  assert.equal(horarios.length,12);
  for(const dia of ['Quarta-feira 21','Quinta-feira 22']){
    assert.deepEqual(horarios.filter(h=>h.startsWith(dia)).map(h=>h.split('às ')[1]),['08:00','09:00','10:00','14:00','15:00','16:00']);
  }
  assert.equal(cfg.ENDERECOS_POR_CIDADE['Uruará-PA'],'Igreja Pentecostal Deus é Amor — Rua Benjamim Constant, 506, Uruará-PA');
});
test('bot reconhece Uruara sem acento, salva e confirma o endereço correto',()=>{
  const horario='Quinta-feira 22 de outubro em Uruará-PA às 08:00';
  const prompt=bot.promptSistema(jid);
  assert.ok(prompt.includes(horario));
  const resposta=bot.processarResposta('###AGENDAR###'+JSON.stringify({nome:'Maria Teste',horario}),jid);
  const agenda=bot.carregarAgendamentos();
  assert.equal(agenda.length,1);assert.equal(agenda[0].horario,horario);
  assert.match(resposta,/22 de outubro/);assert.match(resposta,/Rua Benjamim Constant, 506/);
  assert.doesNotMatch(resposta,/Sena Madureira|###/);
});
