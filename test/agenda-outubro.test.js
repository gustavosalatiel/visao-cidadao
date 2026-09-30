const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'bot-outubro-'));
process.env.AUTH_DIR=path.join(process.env.DATA_DIR,'auth');delete process.env.LIMPAR_AUTH;
mock.timers.enable({apis:['Date'],now:new Date('2026-09-28T15:00:00Z')});
const casos=[
 ['Cachoeira da Serra-PA',[12],'Avenida 3 de Maio'],
 ['Castelo dos Sonhos-PA',[13,14],'Rua Ouro Verde'],
 ['Novo Progresso-PA',[15,16,17],'Rua Tapajós, 1031'],
];
const jids=casos.map((_,i)=>'559399990200'+i+'@s.whatsapp.net');
fs.writeFileSync(path.join(process.env.DATA_DIR,'historicos.json'),JSON.stringify(Object.fromEntries(casos.map(([cidade,dias],i)=>[jids[i],[{role:'cliente',text:'Meu nome é Pessoa Teste. Consigo ir para '+cidade+' no dia '+dias[0]+' de outubro.'}]]))));
const espera=[{nome:'Maria Espera',telefone:'5593999988888',cidade:'Novo Progresso-PA',status:'aguardando_data',criadoEm:'2026-09-22T10:00:00Z'}];
fs.writeFileSync(path.join(process.env.DATA_DIR,'lista-espera-novo-progresso.json'),JSON.stringify(espera));
const cfg=require('../config'),bot=require('../index');
for(const [i,[cidade,dias,rua]] of casos.entries()){
 test(cidade+' tem dias, horários e confirmação corretos',()=>{
   const horarios=cfg.HORARIOS.filter(h=>h.includes('em '+cidade+' às'));
   assert.equal(horarios.length,dias.length*6);
   assert.deepEqual([...new Set(horarios.map(h=>Number(h.match(/(\d+) de outubro/)[1])))],dias);
   for(const dia of dias) assert.deepEqual(horarios.filter(h=>h.includes(dia+' de outubro')).map(h=>h.split('às ')[1]),['08:00','09:00','10:00','14:00','15:00','16:00']);
   for(const h of horarios){
     const dia=Number(h.match(/(\d+) de outubro/)[1]);
     const semana=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(Date.UTC(2026,9,dia)).getUTCDay()];
     assert.ok(h.startsWith(semana));
   }
   const resposta=bot.processarResposta('###AGENDAR###'+JSON.stringify({nome:'Pessoa Teste',horario:horarios[0]}),jids[i]);
   assert.ok(resposta.includes(rua),resposta);
   assert.ok(bot.carregarAgendamentos().some(a=>a.telefone===jids[i].split('@')[0] && a.horario===horarios[cidade==='Novo Progresso-PA'?3:0]));
 });
}
test('Novo Progresso usa agenda definida e preserva espera sem converter em agendamento',()=>{
 const prompt=bot.promptSistema(jids[2]);
 assert.ok(prompt.includes('a agenda já está definida'));
 assert.ok(!prompt.includes('Use esta abertura, mantendo os parágrafos'));
 const resposta=bot.processarResposta('###LISTA_ESPERA_NOVO_PROGRESSO###{"nome":"Outra Pessoa"}',jids[2]);
 assert.ok(resposta.includes('agenda de Novo Progresso já foi definida'));
 assert.deepEqual(bot.carregarListaEsperaNovoProgresso(),espera);
 assert.equal(bot.carregarAgendamentos().length,3);
});
