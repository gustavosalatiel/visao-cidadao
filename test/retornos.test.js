const {test,mock}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'bot-retornos-'));process.env.AUTH_DIR=path.join(process.env.DATA_DIR,'auth');delete process.env.LIMPAR_AUTH;
mock.timers.enable({apis:['Date'],now:new Date('2026-09-19T19:01:00Z')});
const bot=require('../index');const CFG=require('../config');const cidade='Bela Vista do Caracol-PA';const jid='559399993331@s.whatsapp.net';const hist=text=>[{role:'cliente',text}];
test('após o último horário identifica a cidade para lista de retorno',()=>{assert.equal(bot.cidadeParaRetorno(hist('Sou de Bela Vista do Caracol e quero agendar'),jid),cidade)});
test('se ainda houver outra data futura, mantém agendamento normal',()=>{assert.equal(bot.cidadeParaRetorno(hist('Sou de Trairão'),jid),null)});
test('horário esgotado mas ainda futuro não é confundido com etapa encerrada',()=>{mock.timers.setTime(Date.parse('2026-09-19T12:00:00Z'));assert.equal(bot.cidadeSemProximaData(cidade),false);mock.timers.setTime(Date.parse('2026-09-19T19:01:00Z'))});
test('Novo Progresso não entra na lista genérica',()=>{assert.equal(bot.cidadeParaRetorno(hist('Novo Progresso'),jid),null)});
test('cidade ambígua ou desconhecida exige esclarecimento',()=>{assert.equal(bot.cidadeParaRetorno(hist('Bela Vista ou Trairão'),jid),null);assert.equal(bot.cidadeParaRetorno(hist('Sou de uma cidade desconhecida'),jid),null)});
test('guarda família, separa cidades e evita duplicação',()=>{
 bot.salvarInteressesRetorno(cidade,['Maria da Silva','João da Silva'],'559399993331');bot.salvarInteressesRetorno(cidade,['Maria da Silva'],'559399993331');bot.salvarInteressesRetorno('Xapuri-AC',['Maria da Silva'],'559399993331');
 const lista=bot.carregarListaRetornos();assert.equal(lista.length,3);assert.equal(lista.filter(a=>a.cidade===cidade).length,2);assert.ok(lista.every(a=>a.status==='aguardando_retorno'&&!a.horario));
});
test('nome enviado na mensagem seguinte conserva a cidade e troca explícita escolhe a nova',()=>{
 assert.equal(bot.cidadeParaRetorno([...hist('Sou de Bela Vista do Caracol'),...hist('Maria da Silva')],jid),cidade);
 assert.equal(bot.cidadeParaRetorno([...hist('Sou de Bela Vista do Caracol'),...hist('Prefiro ir para Trairão')],jid),null);
});
test('não cadastra em lista cidade com data futura nem nome incompleto',()=>{
 assert.throws(()=>bot.salvarInteressesRetorno('Trairão-PA',['Maria da Silva'],'559399993331'));
 assert.throws(()=>bot.salvarInteressesRetorno(cidade,['Maria'],'559399993331'));
});
test('quando a agenda recebe nova data, deixa de oferecer lista de retorno',()=>{
 const novo='Domingo 20 de setembro em Bela Vista do Caracol-PA às 08:00';CFG.HORARIOS.push(novo);
 try{assert.equal(bot.cidadeParaRetorno(hist('Sou de Bela Vista do Caracol'),jid),null)}finally{CFG.HORARIOS.pop()}
});
test('extrai nomes, grava e confirma sem prometer data ou consulta',async()=>{
 const fetchOriginal=global.fetch;global.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({nomes:['Ana de Souza'],resposta:'Agendado para outubro!'})}]}}]})});
 try{const resposta=await bot.responderInteresseRetorno(hist('Quero entrar na lista: Ana de Souza'),jid,cidade);assert.match(resposta,/lista de interesse/);assert.match(resposta,/não há nova data confirmada/);assert.doesNotMatch(resposta,/outubro/);assert.ok(bot.carregarListaRetornos().some(a=>a.nome==='Ana de Souza'))}finally{global.fetch=fetchOriginal}
});
test('bloqueia nome inventado e confirmação sem gravação',async()=>{
 const fetchOriginal=global.fetch;let dados={nomes:['Nome Inventado'],resposta:'Confirmado'};global.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(dados)}]}}]})});
 try{assert.match(await bot.responderInteresseRetorno(hist('Ana'),jid,cidade),/nome completo/);dados={nomes:[],resposta:'Consulta marcada amanhã'};assert.doesNotMatch(await bot.responderInteresseRetorno(hist('Quero exame'),jid,cidade),/marcada amanhã/);assert.equal(bot.carregarListaRetornos().some(a=>a.nome==='Nome Inventado'),false)}finally{global.fetch=fetchOriginal}
});
test('erro ao salvar não confirma inscrição',async()=>{
 const fetchOriginal=global.fetch,writeOriginal=fs.writeFileSync;global.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({nomes:['Carlos de Souza'],resposta:'Ok'})}]}}]})});fs.writeFileSync=()=>{throw new Error('Falha simulada')};
 try{await assert.rejects(bot.responderInteresseRetorno(hist('Carlos de Souza'),jid,cidade),/Falha simulada/)}finally{global.fetch=fetchOriginal;fs.writeFileSync=writeOriginal}
});
