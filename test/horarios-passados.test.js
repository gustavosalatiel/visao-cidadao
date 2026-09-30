const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'bot-hora-local-'));
process.env.AUTH_DIR=path.join(process.env.DATA_DIR,'auth');delete process.env.LIMPAR_AUTH;
const jid='559399991111@s.whatsapp.net';
fs.writeFileSync(path.join(process.env.DATA_DIR,'historicos.json'),JSON.stringify({[jid]:[{role:'cliente',text:'Consigo ir para Bela Vista do Caracol no dia 19'}]}));
mock.timers.enable({apis:['Date'],now:new Date('2026-09-19T13:00:00Z')});
const bot=require('../index');
const dia='Sábado 19 de setembro em Bela Vista do Caracol-PA';
const h=hora=>`${dia} às ${hora}`;
const arq=path.join(process.env.DATA_DIR,'agendamentos.json');
const marcar=(nome,horario)=>'###AGENDAR###'+JSON.stringify({nome,horario});
function horaLocal(hora){mock.timers.setTime(Date.parse(`2026-09-19T${hora}:00-03:00`));fs.writeFileSync(arq,'[]');}

test('às 09h não oferece 08h nem o instante atual, mantendo a próxima cota futura',()=>{
 horaLocal('09:00');assert.equal(bot.horarioJaPassou(h('08:00')),true);assert.equal(bot.horarioJaPassou(h('09:00')),true);assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),h('14:00'));
});
test('às 10h ignora as cotas da manhã e escolhe 14h',()=>{
 horaLocal('10:00');assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),h('14:00'));
});
test('às 14h30 escolhe 15h e às 15h escolhe 16h',()=>{
 horaLocal('14:30');assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),h('15:00'));
 horaLocal('15:00');assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),h('16:00'));
});
test('às 16h e depois não retorna horário passado como alternativa',()=>{
 for(const hora of ['16:00','18:00']){horaLocal(hora);assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),null);}
});
test('fusos do Pará, Rondônia, Amazonas e Acre independem do servidor',()=>{
 mock.timers.setTime(Date.parse('2026-09-19T12:00:00Z'));
 assert.equal(bot.horarioJaPassou(h('08:00')),true);
 assert.equal(bot.horarioJaPassou('Sábado 19 de setembro em Guajará-Mirim-RO às 08:00'),true);
 assert.equal(bot.horarioJaPassou('Sábado 19 de setembro em Boca do Acre-AM às 08:00'),true);
 assert.equal(bot.horarioJaPassou('Sábado 19 de setembro em Sena Madureira-AC às 08:00'),false);
});
test('virada do dia usa a data da cidade, não UTC nem Acre',()=>{
 mock.timers.setTime(Date.parse('2026-09-19T03:30:00Z'));assert.equal(bot.horarioEhHoje(h('08:00')),true);
 assert.equal(bot.horarioEhHoje('Sábado 19 de setembro em Sena Madureira-AC às 08:00'),false);
});
test('primeiras 10 vagas continuam às 08h antes do início do dia e para dias futuros',()=>{
 horaLocal('07:59');assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),h('08:00'));
 mock.timers.setTime(Date.parse('2026-09-18T22:00:00-03:00'));assert.equal(bot.escolherHorarioEquilibrado(h('08:00'),[]),h('08:00'));
});
test('IA pede 08h às 10h: salva 14h, diz hoje e remove confirmação errada',()=>{
 horaLocal('10:00');const texto=bot.processarResposta('Marcado às 08:00! '+marcar('Maria Teste',h('08:00')),jid);
 assert.equal(JSON.parse(fs.readFileSync(arq))[0].horario,h('14:00'));assert.match(texto,/Estamos atendendo hoje/);assert.match(texto,/14:00/);assert.doesNotMatch(texto,/08:00/);
});
test('família nova continua junta no próximo horário futuro',()=>{
 horaLocal('10:00');bot.processarResposta(marcar('Maria Teste',h('08:00'))+marcar('João Teste',h('09:00')),jid);
 const lista=JSON.parse(fs.readFileSync(arq));assert.equal(lista.length,2);assert.ok(lista.every(a=>a.horario===h('14:00')));
});
test('familiar não é incluído no horário passado nem separado automaticamente',()=>{
 horaLocal('10:00');const original=[{nome:'Maria Teste',telefone:jid.split('@')[0],horario:h('08:00')}];fs.writeFileSync(arq,JSON.stringify(original));
 const texto=bot.processarResposta(marcar('João Teste',h('08:00')),jid);assert.match(texto,/horário.*já passou/);assert.deepEqual(JSON.parse(fs.readFileSync(arq)),original);
});
test('fim do dia bloqueia gravação e não confirma o texto inventado pela IA',()=>{
 horaLocal('16:00');const texto=bot.processarResposta('Agendado às 08:00! '+marcar('Maria Teste',h('08:00')),jid);assert.match(texto,/Não há mais horários disponíveis para hoje/);assert.deepEqual(JSON.parse(fs.readFileSync(arq)),[]);assert.doesNotMatch(texto,/Agendado às/);
});
test('reagendamento sem horário futuro preserva o registro anterior',()=>{
 horaLocal('16:00');const original=[{nome:'Maria Teste',telefone:jid.split('@')[0],horario:h('08:00')}];fs.writeFileSync(arq,JSON.stringify(original));
 const texto=bot.processarResposta('Confirmado! ###REAGENDAR###'+JSON.stringify({nome:'Maria Teste',horarioAntigo:h('08:00'),horarioNovo:h('14:00')}),jid);
 assert.match(texto,/Não há mais horários/);assert.deepEqual(JSON.parse(fs.readFileSync(arq)),original);
});
test('instruções da IA incluem o relógio local e removem horários expirados da lista',()=>{
 horaLocal('10:00');const texto=bot.promptSistema(jid);assert.match(texto,/Bela Vista do Caracol-PA: 2026-09-19 10:00:00/);assert.match(texto,/estamos atendendo hoje/);
});

test('pedido para hoje após o último horário recebe aviso sem depender da IA',()=>{
 horaLocal('16:00');const texto=bot.respostaSemHorarioHoje([{role:'cliente',text:'Quero agendar em Bela Vista do Caracol hoje'}]);assert.match(texto,/Não há mais horários disponíveis para hoje/);
 horaLocal('10:00');assert.equal(bot.respostaSemHorarioHoje([{role:'cliente',text:'Quero agendar em Bela Vista do Caracol hoje'}]),null);
});
