const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-17T15:00:00Z') });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-fluxo-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
const dia = 'Sábado 19 de setembro em Bela Vista do Caracol-PA';
const sexta = 'Sexta-feira 18 de setembro em Bela Vista do Caracol-PA';
const jid = n => `55939000${String(n).padStart(4, '0')}@s.whatsapp.net`;
const historicos = Object.fromEntries(Array.from({length: 60}, (_, n) => [jid(n), [{ role: 'cliente', text: 'Consigo ir para Bela Vista do Caracol' }]]));
fs.writeFileSync(path.join(process.env.DATA_DIR, 'historicos.json'), JSON.stringify(historicos));
const bot = require('../index');
const arq = path.join(process.env.DATA_DIR, 'agendamentos.json');
const ler = () => JSON.parse(fs.readFileSync(arq, 'utf8'));
const salvar = lista => fs.writeFileSync(arq, JSON.stringify(lista));
const marcar = (nome, horario) => '###AGENDAR###' + JSON.stringify({ nome, horario });
const seed = (hora, n) => Array.from({length:n}, (_, i) => ({nome:`Pessoa Teste ${i}`, telefone:`55938000${i}`, horario:`${dia} às ${hora}`}));

test('fluxo salva 50 pessoas e confirma a sequência real de horários', () => {
  salvar([]);
  for (let n=0;n<50;n++) {
    const resposta = bot.processarResposta('Agendado. '+marcar(`Pessoa Teste ${n}`, `${dia} às 16:00`), jid(n));
    assert.equal(ler().length, n+1);
    assert.ok(resposta.includes(ler()[n].horario.match(/às (.*)/)[1]));
  }
  const horas = ler().map(a=>a.horario.match(/às (.*)/)[1]);
  assert.deepEqual(horas.slice(0,40), ['08:00','09:00','14:00','15:00'].flatMap(h=>Array(10).fill(h)));
  assert.equal(horas.filter(h=>Number(h.slice(0,2))<12).length,25);
});

test('família de 5 com somente 2 vagas na cota fica inteira às 09:00', () => {
  salvar(seed('08:00',8));
  bot.processarResposta(Array.from({length:5}, (_,n)=>marcar(`Familiar Teste ${n}`,`${dia} às ${n%2 ? '15:00':'08:00'}`)).join(' '),jid(51));
  assert.equal(ler().length,13);
  assert.deepEqual([...new Set(ler().slice(8).map(a=>a.horario))],[`${dia} às 09:00`]);
});

test('família redirecionada de sexta para sábado continua inteira na cota seguinte', () => {
  salvar(seed('08:00',8));
  bot.processarResposta(Array.from({length:5}, (_,n)=>marcar(`Familiar Teste ${n}`,`${sexta} às 08:00`)).join(' '),jid(52));
  assert.equal(ler().length,13);
  assert.deepEqual([...new Set(ler().slice(8).map(a=>a.horario))],[`${dia} às 09:00`]);
});

test('familiar adicionado em outra mensagem mantém o horário do primeiro', () => {
  salvar([]);
  bot.processarResposta(marcar('Maria Teste',`${dia} às 08:00`),jid(53));
  salvar([...ler(), ...seed('08:00',9)]);
  bot.processarResposta(marcar('João Teste',`${dia} às 15:00`),jid(53));
  assert.equal(ler().at(-1).horario,`${dia} às 08:00`);
});

test('conversa de Novo Progresso pede nome, salva reserva e confirma sem data inventada', { skip: !bot.NOVO_PROGRESSO_EM_ESPERA && 'agenda de Novo Progresso já definida' }, async () => {
  const enviadas=[];
  const sock={sendPresenceUpdate:async()=>{},sendMessage:async(destino,msg)=>{enviadas.push(msg.text);return {key:{id:'teste-local'}};}};
  const originalFetch=global.fetch;
  let chamadas=0;
  global.fetch=async(url, options)=>{
    chamadas++;
    const body=JSON.parse(options.body);
    assert.match(body.contents.at(-1).parts[0].text,/Maria da Silva Teste/);
    assert.match(body.system_instruction.parts[0].text,/MÊS DE OUTUBRO/);
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({nomes:['Maria da Silva Teste'],resposta:'Vou registrar seu nome.'})}]}}]})};
  };
  try {
    await bot.responder(sock,jid(59),'Sou de Novo Progressso');
    assert.equal(chamadas,0);
    assert.equal(enviadas.at(-1), 'Olá! Tudo bem? 😊\n\nEm Novo Progresso, estamos realizando os agendamentos para o mês de outubro.\n\nMe envie, por favor, seu nome completo para que eu possa providenciar sua vaga. Em breve, avisaremos aqui pelo WhatsApp o dia, local do atendimento e o seu horário.\n\nSe quiser agendar também para outras pessoas da família, já pode me enviar os nomes. Vou tentar organizar todos no mesmo horário, para facilitar para vocês. ✍🏻');
    await bot.responder(sock,jid(59),'Maria da Silva Teste');
    const reserva=bot.carregarListaEsperaNovoProgresso().find(a=>a.nome==='Maria da Silva Teste');
    assert.ok(reserva);
    assert.equal(reserva.status,'aguardando_data');
    assert.equal(reserva.horario,undefined);
    assert.doesNotMatch(enviadas.at(-1),/###/);
    assert.equal(ler().filter(a=>a.telefone===jid(59).split('@')[0]).length,0);
  } finally {global.fetch=originalFetch;}
});

test('Novo Progresso bloqueia confirmação sem nomes e sobrenomes inventados', { skip: !bot.NOVO_PROGRESSO_EM_ESPERA && 'agenda de Novo Progresso já definida' }, async () => {
  const enviadas=[];
  const sock={sendPresenceUpdate:async()=>{},sendMessage:async(_jid,msg)=>{enviadas.push(msg.text);return {key:{id:'teste-local'}};}};
  const originalFetch=global.fetch;
  let dados={nomes:[],resposta:'Sua vaga está reservada!'};
  global.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(dados)}]}}]})});
  try {
    await bot.responder(sock,jid(59),'Quero reservar também para meu filho');
    assert.doesNotMatch(enviadas.at(-1),/vaga está reservada/);
    assert.match(enviadas.at(-1),/nome completo/);
    dados={nomes:['Pedro da Silva'],resposta:'Pronto'};
    await bot.responder(sock,jid(59),'Pedro');
    assert.match(enviadas.at(-1),/nome completo/);
    assert.equal(bot.carregarListaEsperaNovoProgresso().some(a=>a.nome==='Pedro da Silva'),false);
  } finally {global.fetch=originalFetch;}
});
