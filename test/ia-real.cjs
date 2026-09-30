const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Execução manual: node --env-file-if-exists=.env test/ia-real.cjs
// Usa a API Gemini, mas grava só dados fictícios em uma pasta temporária.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-ia-real-'));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, 'auth');
delete process.env.LIMPAR_AUTH;
const { responder, carregarListaEsperaNovoProgresso } = require('../index');
const mensagens = [];
const sock = {
  sendPresenceUpdate: async () => {},
  sendMessage: async (_jid, msg) => {
    mensagens.push(msg.text);
    console.log('RESPOSTA FICTÍCIA:', msg.text);
    return { key: { id: 'teste-sem-whatsapp' } };
  },
};
(async () => {
  const jid = '559399990001@s.whatsapp.net';
  await responder(sock, jid, 'Olá, sou de Novo Progresso');
  assert.match(mensagens.at(-1), /Me envie, por favor, seu nome completo/);
  await responder(sock, jid, 'Meu nome completo é Maria de Souza Teste');
  assert.ok(carregarListaEsperaNovoProgresso().some(x => x.nome === 'Maria de Souza Teste'));
  await responder(sock, jid, 'Quero reservar também para meu marido João de Souza Teste');
  const lista = carregarListaEsperaNovoProgresso();
  assert.ok(lista.some(x => x.nome === 'João de Souza Teste'));
  assert.equal(lista.length, 2);
  assert.ok(lista.every(x => x.status === 'aguardando_data' && !x.horario));
  assert.ok(mensagens.every(x => !x.includes('###')));
  assert.equal(fs.existsSync(path.join(process.env.DATA_DIR, 'agendamentos.json')), false);
  console.log('PASSOU: IA real, duas reservas, sem horário inventado, sem envio ao WhatsApp.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
