const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const express = require("express");
const fs = require("fs");
const path = require("path");
const CFG = require("./config");

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

if (process.env.LIMPAR_AUTH === "1") {
  fs.rmSync(path.join(DATA_DIR, "auth"), { recursive: true, force: true });
  console.log("🧹 Sessão antiga removida (LIMPAR_AUTH=1)");
}

const ARQ_AGENDAMENTOS = path.join(DATA_DIR, "agendamentos.json");

function carregarAgendamentos() {
  try {
    return JSON.parse(fs.readFileSync(ARQ_AGENDAMENTOS, "utf8"));
  } catch {
    return [];
  }
}

function salvarAgendamento(dados) {
  const lista = carregarAgendamentos();
  lista.push({ ...dados, criadoEm: new Date().toISOString() });
  fs.writeFileSync(ARQ_AGENDAMENTOS, JSON.stringify(lista, null, 2));
  console.log("📅 NOVO AGENDAMENTO:", dados.nome, "-", dados.horario);
}

const ARQ_PAUSADOS = path.join(DATA_DIR, "pausados.json");

function carregarPausados() {
  try {
    return new Set(JSON.parse(fs.readFileSync(ARQ_PAUSADOS, "utf8")));
  } catch {
    return new Set();
  }
}

function salvarPausados(set) {
  fs.writeFileSync(ARQ_PAUSADOS, JSON.stringify([...set], null, 2));
}

const pausados = carregarPausados();

const ARQ_CONTATOS = path.join(DATA_DIR, "contatos.json");

function carregarContatos() {
  try {
    return JSON.parse(fs.readFileSync(ARQ_CONTATOS, "utf8"));
  } catch {
    return {};
  }
}

function salvarContatos(obj) {
  fs.writeFileSync(ARQ_CONTATOS, JSON.stringify(obj, null, 2));
}

const contatos = carregarContatos();

function registrarContato(jid) {
  const telefone = jid.replace("@s.whatsapp.net", "");
  const agora = new Date().toISOString();
  if (!contatos[telefone]) contatos[telefone] = { primeiraMensagem: agora };
  contatos[telefone].ultimaMensagem = agora;
  salvarContatos(contatos);
}

function extrairCidade(horario) {
  const m = horario.match(/\b(?:em|no|na)\s+(.+?)\s+às\s+\d{2}:\d{2}/i);
  return m ? m[1] : "Outros horários";
}

function agruparHorariosPorCidade(horarios) {
  const mapa = new Map();
  for (const h of horarios) {
    const cidade = extrairCidade(h);
    if (!mapa.has(cidade)) mapa.set(cidade, []);
    mapa.get(cidade).push(h);
  }
  return [...mapa.entries()].map(([cidade, lista]) => ({ cidade, horarios: lista }));
}

const idsEnviadosPeloBot = new Set();
const MAX_IDS_RASTREADOS = 500;
const ultimoEnvioAutomatico = new Map();
const JANELA_ECO_MS = 8000;
let conectadoEm = 0;
const JANELA_POS_CONEXAO_MS = 15000;

function registrarIdEnviado(id) {
  if (!id) return;
  idsEnviadosPeloBot.add(id);
  if (idsEnviadosPeloBot.size > MAX_IDS_RASTREADOS) {
    idsEnviadosPeloBot.delete(idsEnviadosPeloBot.values().next().value);
  }
}

const historicos = new Map();
const MAX_HISTORICO = 20;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const buffersPendentes = new Map();
const DEBOUNCE_MS = 2500;

function bufferizarMensagem(sock, jid, texto) {
  let pendente = buffersPendentes.get(jid);
  if (!pendente) {
    pendente = { textos: [], timer: null };
    buffersPendentes.set(jid, pendente);
  }
  pendente.textos.push(texto);
  clearTimeout(pendente.timer);
  pendente.timer = setTimeout(async () => {
    const textos = pendente.textos;
    buffersPendentes.delete(jid);
    try {
      await responder(sock, jid, textos.join("\n"));
    } catch (e) {
      console.error("Erro ao responder:", e.message);
    }
  }, DEBOUNCE_MS);
}

function promptSistema() {
  return `Você é o atendimento oficial do ${CFG.NOME_EMPRESA}, em ${CFG.CIDADE}.
Você atende pelo WhatsApp pessoas que clicaram em um anúncio de EXAME DE VISTA GRATUITO.

SUA PERSONALIDADE:
- Fala em nome do ${CFG.NOME_EMPRESA} (não como uma pessoa com nome próprio) — simpática, acolhedora, natural, como o interior do Brasil.
- Mensagens CURTAS (1 a 3 frases), como se digitasse no celular. Nunca escreva textões.
- Usa emoji com moderação (no máximo 1 por mensagem, às vezes nenhum).
- Nunca diz que é robô, IA ou assistente virtual. Você é o ${CFG.NOME_EMPRESA}.
- Nunca usa listas com asteriscos (tipo bullet point) — só texto corrido de conversa. A ÚNICA exceção é deixar o horário e o local em *negrito* (um asterisco de cada lado, formatação do WhatsApp) na hora de confirmar um agendamento.

SEU OBJETIVO:
1. Seja direta desde a primeira mensagem: dê boas-vindas e já peça o nome completo e a cidade da pessoa para reservar o exame gratuito. Não pergunte como a pessoa está se sentindo nem faça perguntas exploratórias. Exemplo de abertura: "Oi! Aqui é do projeto Visão Cidadão 😊 para realizar seu agendamento para consultas e exames gratuitos me envie seu nome completo e qual sua cidade, que eu já deixo seu exame gratuito reservado!"
2. Assim que souber a cidade da pessoa, LEIA a lista HORÁRIOS DISPONÍVEIS PARA AGENDAR abaixo. Se a cidade dela tiver horários na lista, informe as datas e horários disponíveis pra ela escolher. Se a cidade dela NÃO tiver nenhum horário na lista, responda nesse estilo: "Nessa cidade não temos atendimento no momento, mas nas seguintes cidades sim: [liste as cidades que estão na lista de horários]. Alguma dessas você conseguiria se deslocar pra fazer o seu atendimento, ou alguma fica próxima de você?" Nunca invente data, horário ou cidade que não esteja na lista.
3. Se a pessoa disser que um horário sugerido não dá pra ela, pergunte "certo, qual horário fica melhor pra você?" (mostrando as opções daquele mesmo dia/cidade). Quando ela escolher um horário que está na lista, confirme "certo, iremos marcar esse horário pra você" e prossiga com o agendamento.
4. Tirar qualquer dúvida sobre o atendimento usando SOMENTE as informações abaixo.
5. Conduzir com jeitinho para AGENDAR o exame gratuito.
6. Para agendar você precisa de: NOME completo da pessoa e o HORÁRIO (data/cidade) escolhido da lista abaixo.
7. Este canal é SOMENTE para agendamento e dúvidas sobre o exame. Se a pessoa mandar qualquer assunto fora disso, diga educadamente que por aqui você só consegue ajudar com o agendamento do exame gratuito, e volte a pedir nome e cidade.

INFORMAÇÕES DA EMPRESA (use só isso, não invente):
${CFG.INFORMACOES}

ENDEREÇO: ${CFG.ENDERECO}

HORÁRIOS DISPONÍVEIS PARA AGENDAR:
${CFG.HORARIOS.map((h) => `- ${h}`).join("\n")}

REGRAS DO AGENDAMENTO (MUITO IMPORTANTE):
- Quando a pessoa CONFIRMAR um horário e você já souber o nome dela, finalize sua resposta com esta marcação EXATA em uma linha separada:
###AGENDAR###{"nome":"NOME DA PESSOA","horario":"HORÁRIO ESCOLHIDO"}
- Essa marcação é invisível pra pessoa (o sistema remove). Use apenas UMA vez, na hora que fechar o agendamento.
- Na mesma mensagem, confirme pra pessoa: a *data* (sempre por extenso, tipo "21 de agosto", nunca "21/08"), o *horário* e o *local* em negrito (asterisco de cada lado) + que é gratuito.
- Se a pessoa pedir algo que você não sabe, diga que vai verificar com a equipe e que já retornam.
- Se perguntarem sobre preços de óculos, responda, mas deixe claro que a compra nunca é obrigatória.`;
}

async function perguntarIA(historico) {
  const contents = historico.map((m) => ({
    role: m.role === "cliente" ? "user" : "model",
    parts: [{ text: m.text }],
  }));

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${CFG.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: promptSistema() }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
      }),
    }
  );

  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${erro.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function processarResposta(textoIA, jid) {
  let texto = textoIA;
  const marca = /###AGENDAR###\s*(\{[\s\S]*?\})/;
  const m = texto.match(marca);

  if (m) {
    try {
      const dados = JSON.parse(m[1]);
      salvarAgendamento({
        nome: dados.nome,
        horario: dados.horario,
        telefone: jid.replace("@s.whatsapp.net", ""),
        origem: "whatsapp",
      });
    } catch (e) {
      console.error("Falha ao ler agendamento da IA:", e.message);
    }
    texto = texto.replace(marca, "").trim();
  }

  return texto;
}

async function responder(sock, jid, textoRecebido) {
  const texto = (textoRecebido || "").trim();
  if (!texto) return;

  let hist = historicos.get(jid) || [];
  hist.push({ role: "cliente", text: texto });
  if (hist.length > MAX_HISTORICO) hist = hist.slice(-MAX_HISTORICO);

  let resposta;
  try {
    resposta = await perguntarIA(hist);
  } catch (e) {
    console.error("Erro na IA:", e.message);
    resposta =
      `Oi! Aqui é da ${CFG.NOME_EMPRESA} 😊 Nosso sistema deu uma engasgada, ` +
      `mas já já te respondo. Se preferir, me diz seu nome e o melhor horário ` +
      `que eu já deixo seu exame gratuito reservado!`;
  }

  resposta = processarResposta(resposta, jid);
  if (!resposta) resposta = "Um momentinho... 😊";

  hist.push({ role: "atendente", text: resposta });
  historicos.set(jid, hist);

  await espera(CFG.DELAY_MS);
  const enviada = await sock.sendMessage(jid, { text: resposta });
  registrarIdEnviado(enviada?.key?.id);
  ultimoEnvioAutomatico.set(jid, Date.now());
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(DATA_DIR, "auth")
  );

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const codigo = await sock.requestPairingCode(CFG.NUMERO_BOT);
        console.log("\n==============================================");
        console.log("📲 CÓDIGO DE PAREAMENTO: " + codigo);
        console.log("==============================================");
        console.log("Mande esse código pro responsável digitar em:");
        console.log("WhatsApp > Aparelhos conectados > Conectar aparelho");
        console.log("> Conectar com número de telefone\n");
      } catch (e) {
        console.error("Erro ao gerar código:", e.message);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n📱 Ou escaneie o QR code:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      conectadoEm = Date.now();
      console.log("✅ Bot conectado ao WhatsApp!");
    }
    if (connection === "close") {
      const deveReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Conexão caiu.", deveReconectar ? "Reconectando..." : "Deslogado.");
      if (deveReconectar) iniciarBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;

      const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (msg.key.fromMe) {
        const limparId = (j) => (j || "").split("@")[0].split(":")[0];
        if (limparId(jid) === limparId(sock.user?.id)) continue;
        if (Date.now() - conectadoEm < JANELA_POS_CONEXAO_MS) continue;
        if (texto.trim().toLowerCase() === "/retomar") {
          if (pausados.delete(jid)) {
            salvarPausados(pausados);
            console.log("▶️  IA retomada para:", jid.replace("@s.whatsapp.net", ""));
          }
        } else if (
          !idsEnviadosPeloBot.has(msg.key.id) &&
          Date.now() - (ultimoEnvioAutomatico.get(jid) || 0) >= JANELA_ECO_MS &&
          !pausados.has(jid)
        ) {
          pausados.add(jid);
          salvarPausados(pausados);
          console.log(
            "⏸️  IA pausada (resposta manual detectada) para:",
            jid.replace("@s.whatsapp.net", "")
          );
        }
        continue;
      }

      registrarContato(jid);
      if (pausados.has(jid)) continue;
      if (!texto.trim()) continue;

      bufferizarMensagem(sock, jid, texto);
    }
  });

  return sock;
}

function iniciarServidorHTTP(getSock) {
  const app = express();
  app.use(express.json());

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "painel.html"));
  });

  app.get("/api/dados", (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    const conversas = Object.entries(contatos)
      .map(([telefone, info]) => ({
        telefone,
        pausado: pausados.has(telefone + "@s.whatsapp.net"),
        primeiraMensagem: info.primeiraMensagem,
        ultimaMensagem: info.ultimaMensagem,
      }))
      .sort((a, b) => (a.ultimaMensagem < b.ultimaMensagem ? 1 : -1));

    res.json({
      empresa: CFG.NOME_EMPRESA,
      horarios: CFG.HORARIOS,
      cidades: agruparHorariosPorCidade(CFG.HORARIOS),
      agendamentos: carregarAgendamentos(),
      pausados: [...pausados].map((jid) => jid.replace("@s.whatsapp.net", "")),
      conversas,
    });
  });

  app.post("/api/retomar", (req, res) => {
    const { chave, telefone } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!telefone) return res.status(400).json({ erro: "Envie telefone" });
    const jid = telefone.replace(/\D/g, "") + "@s.whatsapp.net";
    const havia = pausados.delete(jid);
    if (havia) salvarPausados(pausados);
    res.json({ ok: true, retomado: havia });
  });

  app.post("/api/pausar", (req, res) => {
    const { chave, telefone } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!telefone) return res.status(400).json({ erro: "Envie telefone" });
    const jid = telefone.replace(/\D/g, "") + "@s.whatsapp.net";
    const jaEstava = pausados.has(jid);
    pausados.add(jid);
    if (!jaEstava) salvarPausados(pausados);
    res.json({ ok: true });
  });

  app.post("/agendamento", async (req, res) => {
    const { chave, nome, telefone, horario } = req.body || {};

    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!nome || !telefone || !horario) {
      return res
        .status(400)
        .json({ erro: "Envie: nome, telefone (com DDI+DDD) e horario" });
    }

    const sock = getSock();
    if (!sock) return res.status(503).json({ erro: "Bot ainda não conectado" });

    const jid = telefone.replace(/\D/g, "") + "@s.whatsapp.net";

    try {
      salvarAgendamento({ nome, telefone, horario, origem: "site" });
      await sock.sendMessage(jid, {
        text:
          `Oi, ${nome}! Aqui é o ${CFG.NOME_EMPRESA} 😊\n\n` +
          `Vi que você agendou seu exame de vista gratuito pelo nosso site. ` +
          `Tá confirmado:\n\n` +
          `📅 ${horario}\n📍 ${CFG.ENDERECO}\n\n` +
          `O exame leva uns 30 minutos e não precisa levar nada. ` +
          `Qualquer dúvida é só me chamar por aqui!`,
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao enviar confirmação:", e.message);
      res.status(500).json({ erro: "Falha ao enviar mensagem" });
    }
  });

  app.get("/agendamentos", (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    res.json(carregarAgendamentos());
  });

  app.get("/agenda", (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).send("Chave inválida");
    }

    const lista = carregarAgendamentos();
    const porHorario = new Map();
    for (const h of CFG.HORARIOS) porHorario.set(h, []);
    const outros = [];

    for (const ag of lista) {
      if (porHorario.has(ag.horario)) {
        porHorario.get(ag.horario).push(ag);
      } else {
        outros.push(ag);
      }
    }

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Agenda - ${CFG.NOME_EMPRESA}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; max-width: 700px; margin: 0 auto; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin-top: 28px; border-bottom: 2px solid #333; padding-bottom: 4px; }
  ol { margin: 8px 0; padding-left: 24px; }
  li { margin-bottom: 4px; }
  .vazio { color: #888; font-style: italic; }
</style>
</head><body>
<h1>Agenda completa — ${CFG.NOME_EMPRESA}</h1>`;

    for (const [horario, pessoas] of porHorario) {
      html += `<h2>${horario} (${pessoas.length} agendado${pessoas.length === 1 ? "" : "s"})</h2>`;
      if (pessoas.length === 0) {
        html += `<p class="vazio">Nenhum agendamento ainda.</p>`;
      } else {
        html += "<ol>";
        for (const p of pessoas) {
          html += `<li>${p.nome} — ${p.telefone}</li>`;
        }
        html += "</ol>";
      }
    }

    if (outros.length > 0) {
      html += `<h2>Outros horários (fora da lista padrão)</h2><ol>`;
      for (const p of outros) {
        html += `<li>${p.nome} — ${p.telefone} — ${p.horario}</li>`;
      }
      html += "</ol>";
    }

    html += "</body></html>";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  app.listen(CFG.PORTA_HTTP, "0.0.0.0", () => {
    console.log(
      `🌐 Servidor HTTP no ar: http://localhost:${CFG.PORTA_HTTP}/agendamento`
    );
  });
}

let sockAtual = null;
(async () => {
  console.log("🤖 Iniciando bot com IA...");
  if (CFG.GEMINI_API_KEY.includes("COLE-SUA-CHAVE")) {
    console.log("⚠️  ATENÇÃO: configure a GEMINI_API_KEY no config.js!");
    console.log("   Pegue grátis em: https://aistudio.google.com/apikey\n");
  }
  sockAtual = await iniciarBot();
  iniciarServidorHTTP(() => sockAtual);
})();
