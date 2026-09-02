const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const gerarQRImagem = require("qrcode");
const pino = require("pino");
const express = require("express");
const fs = require("fs");
const path = require("path");
const CFG = require("./config");

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const AUTH_DIR = process.env.AUTH_DIR || path.join(DATA_DIR, "auth");
fs.mkdirSync(AUTH_DIR, { recursive: true });

if (process.env.LIMPAR_AUTH === "1") {
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
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

function registrarContato(jid, numeroReal) {
  const telefone = jid.replace("@s.whatsapp.net", "");
  const agora = new Date().toISOString();
  if (!contatos[telefone]) contatos[telefone] = { primeiraMensagem: agora };
  contatos[telefone].ultimaMensagem = agora;
  if (numeroReal) contatos[telefone].numeroReal = numeroReal;
  salvarContatos(contatos);
}

function extrairCidade(horario) {
  const m = horario.match(/\b(?:em|no|na)\s+(.+?)\s+às\s+\d{2}:\d{2}/i);
  return m ? m[1] : "Outros horários";
}

const CIDADES_CONHECIDAS = [...new Set(CFG.HORARIOS.map(extrairCidade))];

function normalizarHorario(horarioBruto) {
  const texto = (horarioBruto || "").trim();
  if (CFG.HORARIOS.includes(texto)) return texto;
  const mHora = texto.match(/às\s*(\d{2}:\d{2})/i);
  if (!mHora) return texto;
  const hora = mHora[1];
  let cidade = extrairCidade(texto);
  if (cidade === "Outros horários") {
    cidade = CIDADES_CONHECIDAS.find((c) => texto.includes(c)) || cidade;
  }
  const correspondente = CFG.HORARIOS.find(
    (h) => h.endsWith(`às ${hora}`) && extrairCidade(h) === cidade
  );
  return correspondente || texto;
}

const MESES_PT = {
  janeiro: 0,
  fevereiro: 1,
  março: 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11,
};

function hojeNoAcre() {
  const agora = new Date();
  const acre = new Date(agora.getTime() - 5 * 60 * 60 * 1000); // Acre = UTC-5
  return new Date(Date.UTC(acre.getUTCFullYear(), acre.getUTCMonth(), acre.getUTCDate()));
}

function dataDoHorario(horario) {
  const m = horario.match(/(\d{1,2})\s+de\s+([a-zçã]+)/i);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = MESES_PT[m[2].toLowerCase()];
  if (mes === undefined) return null;
  const ano = hojeNoAcre().getUTCFullYear();
  return new Date(Date.UTC(ano, mes, dia));
}

function horarioJaPassou(horario) {
  const data = dataDoHorario(horario);
  if (!data) return false;
  return data < hojeNoAcre();
}

function agruparHorariosPorCidade(horarios) {
  const mapa = new Map();
  for (const h of horarios) {
    const cidade = extrairCidade(h);
    if (!mapa.has(cidade)) mapa.set(cidade, []);
    mapa.get(cidade).push(h);
  }
  return [...mapa.entries()].map(([cidade, lista]) => ({
    cidade,
    horarios: lista,
    passada: lista.every((h) => horarioJaPassou(h)),
  }));
}

const TIPOS_ACAO_MENSAGEM = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
];

function faixaDatas(dias) {
  const hoje = new Date();
  const until = hoje.toISOString().slice(0, 10);
  const desde = new Date(hoje.getTime() - (dias - 1) * 86400000);
  const since = desde.toISOString().slice(0, 10);
  return { since, until };
}

function valorDaAcao(actions, tipos) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((a) => tipos.includes(a.action_type))
    .reduce((soma, a) => soma + Number(a.value || 0), 0);
}

async function buscarInsightsMeta(dias) {
  const { since, until } = faixaDatas(dias);
  const campos = "campaign_name,impressions,clicks,spend,actions";
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url =
    `https://graph.facebook.com/${CFG.FB_API_VERSION}/${CFG.FB_AD_ACCOUNT_ID}/insights` +
    `?level=campaign&fields=${campos}&time_range=${timeRange}&time_increment=1&limit=500` +
    `&access_token=${CFG.FB_ACCESS_TOKEN}`;

  const linhas = [];
  let paginas = 0;
  while (url && paginas < 15) {
    const resp = await fetch(url);
    const json = await resp.json();
    if (!resp.ok || json.error) {
      throw new Error(json?.error?.message || `Erro HTTP ${resp.status}`);
    }
    linhas.push(...(json.data || []));
    url = json.paging?.next || null;
    paginas++;
  }
  return linhas;
}

function listaDias(since, until) {
  const dias = [];
  let cursor = new Date(since + "T00:00:00Z");
  const fim = new Date(until + "T00:00:00Z");
  while (cursor <= fim) {
    dias.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dias;
}

function montarRelatorioCampanhas(linhas, dias) {
  const { since, until } = faixaDatas(dias);
  const porDiaMapa = new Map();
  const porCampanhaMapa = new Map();

  for (const dia of listaDias(since, until)) {
    porDiaMapa.set(dia, { dia, cliques: 0, impressoes: 0, gasto: 0, mensagens: 0, agendamentos: 0 });
  }

  for (const l of linhas) {
    const dia = l.date_start;
    const cliques = Number(l.clicks || 0);
    const impressoes = Number(l.impressions || 0);
    const gasto = Number(l.spend || 0);
    const mensagens = valorDaAcao(l.actions, TIPOS_ACAO_MENSAGEM);

    if (!porDiaMapa.has(dia)) {
      porDiaMapa.set(dia, { dia, cliques: 0, impressoes: 0, gasto: 0, mensagens: 0, agendamentos: 0 });
    }
    const d = porDiaMapa.get(dia);
    d.cliques += cliques;
    d.impressoes += impressoes;
    d.gasto += gasto;
    d.mensagens += mensagens;

    const nomeCampanha = l.campaign_name || "Sem nome";
    if (!porCampanhaMapa.has(nomeCampanha)) {
      porCampanhaMapa.set(nomeCampanha, { campanha: nomeCampanha, cliques: 0, impressoes: 0, gasto: 0, mensagens: 0 });
    }
    const c = porCampanhaMapa.get(nomeCampanha);
    c.cliques += cliques;
    c.impressoes += impressoes;
    c.gasto += gasto;
    c.mensagens += mensagens;
  }

  const agendamentosTodos = carregarAgendamentos();
  for (const a of agendamentosTodos) {
    const dia = (a.criadoEm || "").slice(0, 10);
    if (porDiaMapa.has(dia)) porDiaMapa.get(dia).agendamentos += 1;
  }

  const porDia = [...porDiaMapa.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1));
  const porCampanha = [...porCampanhaMapa.values()].sort((a, b) => b.gasto - a.gasto);

  const resumo = porDia.reduce(
    (acc, d) => {
      acc.cliques += d.cliques;
      acc.impressoes += d.impressoes;
      acc.gasto += d.gasto;
      acc.mensagens += d.mensagens;
      acc.agendamentos += d.agendamentos;
      return acc;
    },
    { cliques: 0, impressoes: 0, gasto: 0, mensagens: 0, agendamentos: 0 }
  );

  const conversasNoPeriodo = Object.values(contatos).filter(
    (c) => c.primeiraMensagem && c.primeiraMensagem.slice(0, 10) >= since && c.primeiraMensagem.slice(0, 10) <= until
  ).length;

  return {
    periodo: { since, until, dias },
    porDia,
    porCampanha,
    resumo,
    funil: {
      cliques: resumo.cliques,
      mensagensMeta: resumo.mensagens,
      conversasBot: conversasNoPeriodo,
      agendamentos: resumo.agendamentos,
    },
  };
}

const cacheCampanhas = new Map();
const CACHE_CAMPANHAS_MS = 10 * 60 * 1000;

const idsEnviadosPeloBot = new Set();
const MAX_IDS_RASTREADOS = 500;
const ultimoEnvioAutomatico = new Map();
const JANELA_ECO_MS = 8000;
let conectadoEm = 0;
const JANELA_POS_CONEXAO_MS = 15000;
let qrAtual = null;
let statusConexao = "conectando";

function registrarIdEnviado(id) {
  if (!id) return;
  idsEnviadosPeloBot.add(id);
  if (idsEnviadosPeloBot.size > MAX_IDS_RASTREADOS) {
    idsEnviadosPeloBot.delete(idsEnviadosPeloBot.values().next().value);
  }
}

const ARQ_HISTORICOS = path.join(DATA_DIR, "historicos.json");

function carregarHistoricos() {
  try {
    const obj = JSON.parse(fs.readFileSync(ARQ_HISTORICOS, "utf8"));
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function salvarHistoricos() {
  fs.writeFileSync(ARQ_HISTORICOS, JSON.stringify(Object.fromEntries(historicos), null, 2));
}

const historicos = carregarHistoricos();
const MAX_HISTORICO = 80;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const buffersPendentes = new Map();
const DEBOUNCE_MS = 2500;
const respondendoAgora = new Set();

function bufferizarMensagem(sock, jid, texto) {
  let pendente = buffersPendentes.get(jid);
  if (!pendente) {
    pendente = { textos: [], timer: null };
    buffersPendentes.set(jid, pendente);
  }
  pendente.textos.push(texto);
  clearTimeout(pendente.timer);
  pendente.timer = setTimeout(() => processarBuffer(sock, jid), DEBOUNCE_MS);
}

function processarBuffer(sock, jid) {
  if (respondendoAgora.has(jid)) {
    const pendente = buffersPendentes.get(jid);
    if (pendente) pendente.timer = setTimeout(() => processarBuffer(sock, jid), 1000);
    return;
  }
  const pendente = buffersPendentes.get(jid);
  if (!pendente) return;
  const textos = pendente.textos;
  buffersPendentes.delete(jid);
  respondendoAgora.add(jid);
  responder(sock, jid, textos.join("\n"))
    .catch((e) => console.error("Erro ao responder:", e.message))
    .finally(() => respondendoAgora.delete(jid));
}

function resolverTelefone(jid) {
  return jid.endsWith("@lid") ? contatos[jid]?.numeroReal || jid : jid.replace("@s.whatsapp.net", "");
}

function apenasDigitos(s) {
  return (s || "").replace(/\D/g, "");
}

function telefonesEquivalentes(a, b) {
  const da = apenasDigitos(a);
  const db = apenasDigitos(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

const VAGAS_POR_HORARIO = 20;

function promptSistema(jid) {
  const telefone = resolverTelefone(jid);
  const todosAgendamentos = carregarAgendamentos();
  const agendamentosContato = todosAgendamentos.filter((a) => telefonesEquivalentes(a.telefone, telefone));
  const contagemPorHorario = {};
  for (const a of todosAgendamentos) {
    contagemPorHorario[a.horario] = (contagemPorHorario[a.horario] || 0) + 1;
  }
  const horariosAtivos = CFG.HORARIOS.filter((h) => !horarioJaPassou(h));
  const cidadesAtivasPorEstado = {};
  for (const h of horariosAtivos) {
    const cidade = extrairCidade(h);
    const uf = cidade ? (cidade.match(/-([A-Z]{2})$/) || [])[1] : null;
    if (!cidade || !uf) continue;
    if (!cidadesAtivasPorEstado[uf]) cidadesAtivasPorEstado[uf] = new Set();
    cidadesAtivasPorEstado[uf].add(cidade);
  }
  const resumoPorEstado = Object.entries(cidadesAtivasPorEstado)
    .map(([uf, cidades]) => `${uf}: ${[...cidades].join(", ")}`)
    .join(" | ");

  return `Você é o atendimento oficial do ${CFG.NOME_EMPRESA}, em ${CFG.CIDADE}.
Você atende pelo WhatsApp pessoas que clicaram em um anúncio de EXAME DE VISTA GRATUITO.

SUA PERSONALIDADE:
- Fala em nome do ${CFG.NOME_EMPRESA} (não como uma pessoa com nome próprio) — simpática, acolhedora, natural, como o interior do Brasil.
- Mensagens CURTAS (1 a 3 frases), como se digitasse no celular. Nunca escreva textões.
- Usa emoji com moderação (no máximo 1 por mensagem, às vezes nenhum).
- Nunca diz que é robô, IA ou assistente virtual. Você é o ${CFG.NOME_EMPRESA}.
- Nunca usa listas com asteriscos (tipo bullet point) — só texto corrido de conversa. A ÚNICA exceção é deixar o horário e o local em negrito na hora de confirmar um agendamento, usando *UM ASTERISCO* de cada lado (é assim que o WhatsApp faz negrito: *assim*). NUNCA use dois asteriscos (**assim**) — isso é formatação de Markdown, não funciona no WhatsApp e aparece os asteriscos escritos literalmente pra pessoa.

SEU OBJETIVO:
0. IMPORTANTE — MEMÓRIA: o histórico de mensagens abaixo é permanente, mesmo que a última conversa tenha sido há dias ou semanas. Se o nome da pessoa já aparece em mensagens anteriores no histórico, você JÁ CONHECE essa pessoa — chame ela pelo nome desde a primeira resposta e NÃO peça nome/cidade de novo (só pergunte de novo se for pra um NOVO agendamento e o horário anterior já passou). Trate isso como se você realmente lembrasse da pessoa.
1. Se for a primeira conversa (nome não aparece no histórico), seja direta desde a primeira mensagem: dê boas-vindas e já peça o nome completo e a cidade da pessoa para reservar o exame gratuito. Não pergunte como a pessoa está se sentindo nem faça perguntas exploratórias. Exemplo de abertura: "Oi! Aqui é do projeto Visão Cidadão 😊 para realizar seu agendamento para consultas e exames gratuitos me envie seu nome completo e qual sua cidade, que eu já deixo seu exame gratuito reservado!"
1.1. ATENÇÃO — RESPOSTA PARCIAL: se você pediu "nome e cidade" junto e a pessoa só respondeu UMA das duas coisas (por exemplo só disse a cidade, ou só o nome), NÃO prossiga como se tivesse as duas. Pergunte especificamente pela informação que ainda falta (ex: "Show, e qual é o seu nome completo?") antes de continuar. Só avance no agendamento quando tiver as duas coisas confirmadas de verdade.
2. Assim que souber o NOME e a CIDADE da pessoa, veja se ela tem horários na lista HORÁRIOS DISPONÍVEIS PARA AGENDAR abaixo. Se tiver, NÃO pergunte qual período ou horário ela prefere — escolha você mesma o primeiro horário ainda disponível daquele dia/cidade (ordem: 08:00, 09:00, 10:00, 14:00, 15:00, 16:00, pulando os que já estiverem em ${VAGAS_POR_HORARIO}/${VAGAS_POR_HORARIO} vagas) e JÁ CONFIRME o agendamento direto nesse horário, na mesma mensagem em que souber nome+cidade, usando a marcação ###AGENDAR### (regras completas mais abaixo). Isso agiliza o atendimento — não precisa perguntar manhã ou tarde nem nada antes, só agenda direto assim que tiver nome e cidade. Se DEPOIS de já confirmado a pessoa disser que não consegue nesse dia/horário, aí sim pergunte se prefere manhã ou tarde (ou horário específico) e troque usando ###REAGENDAR### (regra 3 mais abaixo). Se a cidade dela NÃO tiver nenhum horário na lista, pense em quais cidades/distritos da lista HORÁRIOS DISPONÍVEIS ficam GEOGRAFICAMENTE PRÓXIMOS da cidade ou região que ela mencionou (use seu conhecimento de geografia do Brasil — a maioria das cidades ativas hoje fica na região de Itaituba/Trairão/Rurópolis, no oeste do Pará, ao longo da BR-163/Transamazônica) e responda citando ESPECIFICAMENTE essa(s) cidade(s) mais próxima(s) dela, nesse estilo: "Nessa cidade não temos atendimento no momento, mas aqui perto, em [cidade(s)/distrito(s) mais próximos], sim! Consegue se deslocar até lá?" Se você não souber ou não tiver certeza de qual fica mais perto, aí sim liste todas as cidades que estão na lista de horários e pergunte se alguma delas é viável pra ela. Nunca invente data, horário ou cidade que não esteja na lista. ISSO VALE MESMO SE a cidade aparecer na lista LOCAL DE ATENDIMENTO POR CIDADE (endereços) — o endereço cadastrado NÃO significa que tem horário ativo agora. O que importa é só a lista HORÁRIOS DISPONÍVEIS PARA AGENDAR: se a cidade que a pessoa disse não tiver NENHUMA linha lá, é porque não tem atendimento ativo pra ela agora, mesmo que já tenha tido antes — não confirme nenhum agendamento nesse caso, use a resposta de "não temos atendimento no momento".
2.1. CASO ESPECIAL — OURO PRETO DO OESTE: se a pessoa perguntar sobre atendimento em Ouro Preto do Oeste, responda algo como "Em Ouro Preto do Oeste vamos atender no dia 22 de agosto (sábado), na Clínica Ouro Preto Particular! Vou te passar agora pra uma das nossas atendentes continuar seu atendimento, só um instante 😊" e finalize a resposta com esta marcação EXATA em uma linha separada: ###TRANSFERIR_HUMANO### (essa marcação é invisível pra pessoa, o sistema remove).
2.1.2. CASO ESPECIAL — ITAITUBA/MORAES DE ALMEIDA: Moraes de Almeida é um distrito de Itaituba-PA. Se a pessoa disser que é de Itaituba (ou da região), NÃO diga que não tem atendimento lá — trate como a mesma cidade "Moraes de Almeida-PA" da lista e ofereça os horários normalmente.
2.1.3. CASO ESPECIAL — RURÓPOLIS/DIVINÓPOLIS: Divinópolis (Km-70) é um distrito de Rurópolis-PA. Se a pessoa disser que é de Rurópolis (ou da região), NÃO diga que não tem atendimento lá — trate como a mesma cidade "Divinópolis-PA" da lista e ofereça os horários normalmente.
2.1.5. CASO ESPECIAL — PESSOA DISSE SÓ O ESTADO, SEM CIDADE (ex: "sou do Pará", "moro no Acre"): cidades ativas por estado agora: ${resumoPorEstado || "nenhuma"}. Antes de dizer que não tem atendimento, veja se o estado que ela mencionou está nessa lista. Se estiver, NUNCA diga que não tem atendimento nesse estado — pergunte de qual cidade/região específica dentro do estado ela é, citando as cidades ativas daquele estado como opção (ex: "Legal! No Pará estamos atendendo em Moraes de Almeida, Bela Vista do Caracol, Trairão e Divinópolis — qual dessas fica mais perto de você?"). Só diga que não tem atendimento se o estado dela realmente não tiver nenhuma cidade ativa na lista.
2.1.4. CASO ESPECIAL — MORAES DE ALMEIDA-PA: os dias 14 e 15 de setembro já estão com a agenda cheia. Para pessoas NOVAS que ainda não têm agendamento em Moraes de Almeida, ofereça SOMENTE os dias 16 ou 17 de setembro — não ofereça mais os dias 14 ou 15 pra ninguém novo, mesmo que algum horário deles apareça na lista com vaga sobrando. NUNCA diga pra pessoa que os dias 14 ou 15 estão cheios/lotados/esgotados — apenas ofereça direto os dias 16 ou 17 normalmente, sem mencionar que os outros dias encheram.
2.2. LIMITE DE VAGAS: cada horário tem no máximo ${VAGAS_POR_HORARIO} vagas. Se TODOS os horários redondos daquele período (manhã: 08:00, 09:00, 10:00 / tarde: 14:00, 15:00, 16:00) já estiverem em ${VAGAS_POR_HORARIO}/${VAGAS_POR_HORARIO}, escolha sozinha um horário fora dos redondos mas dentro da mesma janela (manhã entre 08:00 e 12:00, tarde entre 14:00 e 18:00) que ainda não esteja cheio, e confirme nele do mesmo jeito — sem perguntar, você decide.
3. Se, DEPOIS de você já ter confirmado um horário, a pessoa disser que esse horário não vai dar mais pra ela, aí sim pergunte "certo, qual horário fica melhor pra você?" oferecendo a janela ampla daquele período pra ela escolher (manhã: entre 08:00 e 12:00 / tarde: entre 14:00 e 18:00). Quando ela escolher, use a marcação ###REAGENDAR### pra trocar o horário anterior por esse novo, como descrito nas REGRAS DO AGENDAMENTO abaixo.
3.1. NUNCA descarte ou desanime a pessoa por causa de horário. Sempre que for usar um horário fora dos horários redondos da lista (seja porque os redondos encheram, seja porque a pessoa pediu um horário específico depois de recusar o primeiro), a marcação ###AGENDAR### ou ###REAGENDAR### tem que usar EXATAMENTE o texto de um horário daquele mesmo dia/cidade que já está na lista HORÁRIOS DISPONÍVEIS, só trocando a parte final "às HH:MM" — nunca mude a data, o ano, a cidade nem a ordem das palavras, e nunca invente um ano diferente do que está na lista (a lista não tem ano, então você também não escreve ano nenhum).
4. Tirar qualquer dúvida sobre o atendimento usando SOMENTE as informações abaixo.
5. Conduzir com jeitinho para AGENDAR o exame gratuito.
6. Para agendar você precisa de: NOME completo da pessoa e o HORÁRIO (data/cidade) escolhido da lista abaixo. NUNCA gere a marcação ###AGENDAR### sem ter o nome completo REAL da pessoa — nunca use um nome genérico ou placeholder tipo "Usuário do WhatsApp". Se em algum momento você for confirmar um horário (inclusive no fluxo automático da regra 2) e ainda não sabe o nome dela, PARE e peça o nome primeiro, só confirme depois que ela responder.
6.1. REGRA DE OURO, NUNCA ESQUEÇA: toda vez que você escrever uma mensagem confirmando um horário pra pessoa (com data e horário em *negrito*, tipo "já deixei reservado...", "confirmado para..."), essa MESMA resposta TEM que incluir a marcação ###AGENDAR### ou ###REAGENDAR### (conforme o caso), sem exceção. Nunca escreva um texto de confirmação sem a marcação correspondente — se você confirmar sem marcar, o agendamento não fica salvo em lugar nenhum e a pessoa fica sem vaga de verdade.
7. Este canal é SOMENTE para agendamento e dúvidas sobre o exame. Se a pessoa mandar qualquer assunto fora disso, diga educadamente que por aqui você só consegue ajudar com o agendamento do exame gratuito, e volte a pedir nome e cidade.

INFORMAÇÕES DA EMPRESA (use só isso, não invente):
${CFG.INFORMACOES}

LOCAL DE ATENDIMENTO POR CIDADE (use isso se a pessoa perguntar onde vai ser o atendimento dela):
${Object.entries(CFG.ENDERECOS_POR_CIDADE).map(([cidade, endereco]) => `- ${cidade}: ${endereco}`).join("\n")}
- Se a cidade da pessoa não estiver nessa lista acima, diga: "${CFG.ENDERECO}"
- NUNCA invente nome de escola, igreja, rua, bairro ou qualquer detalhe de endereço que não esteja EXATAMENTE escrito na lista acima. Se a pessoa disser um nome de local diferente (tipo "não é ali, é em tal lugar"), NÃO concorde nem confirme esse local — diga que vai verificar com a equipe e retornar, e nunca repita de volta um nome de local que a própria pessoa disse sem ele estar na lista.

HORÁRIOS DISPONÍVEIS PARA AGENDAR (só datas futuras — o que já passou ou é hoje já foi removido daqui automaticamente; cada horário tem no máximo ${VAGAS_POR_HORARIO} vagas):
${horariosAtivos.length ? horariosAtivos.map((h) => `- ${h} (${contagemPorHorario[h] || 0}/${VAGAS_POR_HORARIO} vagas preenchidas)`).join("\n") : "Nenhum horário disponível no momento — todas as datas já passaram."}

AGENDAMENTOS JÁ FEITOS POR ESSE CONTATO (mesmo número de WhatsApp):
${agendamentosContato.length ? agendamentosContato.map((a) => `- ${a.nome}: ${a.horario}`).join("\n") : "Nenhum agendamento anterior encontrado pra esse contato."}
- IMPORTANTE: um agendamento que já está nessa lista é SEMPRE válido, mesmo que a data dele não apareça mais na lista HORÁRIOS DISPONÍVEIS PARA AGENDAR (a lista de disponíveis é só pra gente NOVA, não afeta quem já confirmou). NUNCA diga pra uma pessoa que já tem um agendamento nessa lista que "não vai ter atendimento" ou que a cidade dela "não tem mais data" — o agendamento dela continua de pé normalmente, só reforce a confirmação se ela perguntar.
- ATENÇÃO — SÓ CONFIE NESSA LISTA, NUNCA NO HISTÓRICO DE MENSAGENS: essa lista acima é a ÚNICA fonte confiável pra saber se alguém já está agendado de verdade. Se em alguma mensagem ANTERIOR da conversa (sua ou de um atendente humano) parecer que alguém já foi confirmado/agendado, mas o nome dessa pessoa NÃO aparece na lista acima, significa que esse agendamento NUNCA foi salvo de verdade no sistema — trate essa pessoa como AINDA NÃO agendada e agende ela agora com ###AGENDAR###, mesmo que uma mensagem anterior já tenha dito "prontinho, confirmado". Nunca deixe de agendar alguém só porque uma mensagem antiga do histórico parece confirmar isso.

REGRAS DO AGENDAMENTO (MUITO IMPORTANTE):
- ANTES de confirmar um agendamento, olhe a lista AGENDAMENTOS JÁ FEITOS POR ESSE CONTATO acima. Se o NOME que a pessoa está agendando agora JÁ aparece nessa lista, NÃO agende de novo direto — pergunte primeiro algo como: "Vi que [nome] já tem um agendamento marcado pra [horário anterior]. Quer agendar mais um horário (por exemplo pra outra pessoa da família), ou prefere mudar esse agendamento pra um horário novo?" Só prossiga depois que ela responder essa pergunta.
- Se ela confirmar que quer um agendamento A MAIS (nome diferente, ou mesmo nome mas quer mesmo duplicar), use a marcação ###AGENDAR### normalmente, como descrito abaixo.
- Se ela disser que quer TROCAR/MUDAR o horário de um agendamento que já existe, NÃO use ###AGENDAR###. Em vez disso finalize a resposta com esta marcação EXATA em uma linha separada: ###REAGENDAR###{"nome":"NOME DA PESSOA","horarioAntigo":"HORÁRIO ANTIGO EXATO (copie certinho da lista de agendamentos já feitos acima)","horarioNovo":"HORÁRIO NOVO ESCOLHIDO"} — isso substitui o agendamento antigo pelo novo, sem duplicar na agenda.
- Quando a pessoa CONFIRMAR um horário NOVO (que não é troca de um já existente) e você já souber o nome dela, finalize sua resposta com esta marcação EXATA em uma linha separada:
###AGENDAR###{"nome":"NOME DA PESSOA","horario":"HORÁRIO ESCOLHIDO"}
- Essa marcação é invisível pra pessoa (o sistema remove). Use UMA marcação ###AGENDAR### pra cada pessoa que está sendo agendada — se a pessoa estiver marcando pra mais de uma (ex: ela e o filho), coloque uma marcação ###AGENDAR### separada pra cada uma, cada uma em sua própria linha, todas na mesma resposta.
- Na mesma mensagem, diga de forma calorosa que o exame está reservado e que é gratuito. NÃO escreva a data, o horário específico nem o nome do local/endereço nessa mensagem — o sistema adiciona automaticamente a data, o horário e o endereço certos logo em seguida, então você só precisa confirmar de forma simpática (tipo "Prontinho! Já deixei seu exame gratuito reservado, veja os detalhes abaixo:") e lembrar de levar documento com foto.
- Logo depois de confirmar (mesma mensagem, parágrafo seguinte), pergunte se ela quer agendar pra mais algum familiar também, tipo "Quer agendar pra mais algum familiar também?". NÃO mande o convite de compartilhar o link nessa mesma mensagem — espere a resposta dela primeiro.
- Se ela quiser agendar mais alguém da família, siga o fluxo normal (pegue nome e período da pessoa nova) e confirme com uma marcação ###AGENDAR### pra ela também.
- Se ela disser que NÃO quer agendar mais ninguém da família, aí sim convide ela a compartilhar o link com amigos e parentes, mais ou menos assim: "Pedimos por gentileza que compartilhe nosso link de agendamento com amigos e familiares para que possam participar também: 👇🏻 https://wa.me/message/ZQKGY2AQYXRKA1" — pode ajustar o texto pra soar natural, mas SEMPRE inclua esse link exatamente como está.
- Se a pessoa pedir algo que você não sabe, diga que vai verificar com a equipe e que já retornam.
- Se perguntarem sobre óculos: deixe claro que o atendimento gratuito é SOMENTE o exame de vista — o projeto não fabrica nem entrega óculos, nem no mesmo dia nem depois. Mas pode informar que no dia do atendimento tem uma ótica presente no local, caso a pessoa queira comprar óculos por conta própria (isso é totalmente à parte, opcional, e não tem nenhuma relação com o exame gratuito). Nunca diga que o projeto entrega, fabrica ou garante óculos no mesmo dia.`;
}

const GEMINI_TIMEOUT_MS = 25000;
const GEMINI_MAX_TENTATIVAS = 3;

async function chamarGemini(body, tentativa = 1) {
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), GEMINI_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${CFG.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controlador.signal,
      }
    );
    if (!resp.ok) {
      const erro = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${erro.slice(0, 200)}`);
    }
    return await resp.json();
  } catch (e) {
    if (tentativa < GEMINI_MAX_TENTATIVAS) {
      await espera(800 * tentativa);
      return chamarGemini(body, tentativa + 1);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcreverAudio(base64Audio, mimeType) {
  const data = await chamarGemini({
    contents: [
      {
        role: "user",
        parts: [
          { text: "Transcreva esse áudio em português do Brasil. Responda APENAS com a transcrição do que foi falado, sem comentários, sem aspas, sem nada a mais." },
          { inline_data: { mime_type: mimeType, data: base64Audio } },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
  });
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

async function perguntarIA(historico, jid) {
  const contents = historico.map((m) => ({
    role: m.role === "cliente" ? "user" : "model",
    parts: [{ text: m.text }],
  }));

  const data = await chamarGemini({
    system_instruction: { parts: [{ text: promptSistema(jid) }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
  });

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function nomeValido(nome) {
  if (!nome || typeof nome !== "string") return false;
  const limpo = nome.trim();
  if (limpo.length < 3) return false;
  if (/usu[aá]rio|whatsapp|n[ãa]o informado|desconhecid[oa]/i.test(limpo)) return false;
  return true;
}

function horarioValido(horario) {
  const texto = (horario || "").trim();
  if (!texto) return false;
  const semHora = texto.replace(/às\s*\d{2}:\d{2}/i, "").trim();
  const baseReal = CFG.HORARIOS.some((h) => h.replace(/às\s*\d{2}:\d{2}/i, "").trim() === semHora);
  if (!baseReal) return false;
  if (horarioJaPassou(texto)) return false;
  return true;
}

function formatarDataHora(horario) {
  const mHora = horario.match(/às\s*(\d{2}:\d{2})/i);
  const hora = mHora ? mHora[1] : "";
  const mData = horario.match(/^(.*?)\s+(?:em|no|na)\s+/i);
  const data = mData ? mData[1].trim() : horario.split(" às ")[0].trim();
  return { data, hora };
}

function processarResposta(textoIA, jid) {
  let texto = textoIA;
  const confirmacoes = [];

  const pareceConfirmacao = /\*[^*]+\*/.test(texto) && /às\s*\d{2}:\d{2}/i.test(texto);
  const temMarcador = /###AGENDAR###|###REAGENDAR###/.test(texto);
  if (pareceConfirmacao && !temMarcador) {
    console.error(
      "⚠️ POSSÍVEL AGENDAMENTO PERDIDO — IA confirmou um horário mas não incluiu a marcação. jid:",
      jid,
      "| texto:",
      texto.replace(/\n/g, " ").slice(0, 300)
    );
  }

  const marca = /###AGENDAR###\s*(\{[\s\S]*?\})/g;
  for (const m of [...texto.matchAll(marca)]) {
    try {
      const dados = JSON.parse(m[1]);
      const telefone = resolverTelefone(jid);
      const horario = normalizarHorario(dados.horario);
      const JANELA_DUPLICADO_MS = 24 * 60 * 60 * 1000;
      const jaExiste = carregarAgendamentos().some(
        (a) =>
          telefonesEquivalentes(a.telefone, telefone) &&
          a.horario === horario &&
          a.nome === dados.nome &&
          Date.now() - new Date(a.criadoEm).getTime() < JANELA_DUPLICADO_MS
      );
      if (!nomeValido(dados.nome)) {
        console.error(
          "⚠️ Agendamento BLOQUEADO — nome inválido/placeholder:",
          JSON.stringify(dados.nome),
          "| jid:",
          jid,
          "| horario:",
          horario
        );
      } else if (!horarioValido(horario)) {
        console.error(
          "⚠️ Agendamento BLOQUEADO — horário inválido, inexistente ou já expirado:",
          JSON.stringify(horario),
          "| nome:",
          dados.nome,
          "| jid:",
          jid
        );
      } else {
        if (!jaExiste) {
          salvarAgendamento({
            nome: dados.nome,
            horario,
            telefone,
            origem: "whatsapp",
          });
        }
        confirmacoes.push({ nome: dados.nome, horario });
      }
    } catch (e) {
      console.error("Falha ao ler agendamento da IA:", e.message);
    }
  }
  texto = texto.replace(marca, "").trim();

  const marcaReagendar = /###REAGENDAR###\s*(\{[\s\S]*?\})/g;
  for (const m of [...texto.matchAll(marcaReagendar)]) {
    try {
      const dados = JSON.parse(m[1]);
      const telefone = resolverTelefone(jid);
      const horarioAntigo = normalizarHorario(dados.horarioAntigo);
      const horarioNovo = normalizarHorario(dados.horarioNovo);
      if (!nomeValido(dados.nome) || !horarioValido(horarioNovo)) {
        console.error(
          "⚠️ Reagendamento BLOQUEADO — nome ou horário novo inválido:",
          JSON.stringify(dados.nome),
          "|",
          JSON.stringify(horarioNovo),
          "| jid:",
          jid
        );
      } else {
        const lista = carregarAgendamentos().filter(
          (a) => !(telefonesEquivalentes(a.telefone, telefone) && a.horario === horarioAntigo)
        );
        lista.push({
          nome: dados.nome,
          horario: horarioNovo,
          telefone,
          origem: "whatsapp",
          criadoEm: new Date().toISOString(),
        });
        fs.writeFileSync(ARQ_AGENDAMENTOS, JSON.stringify(lista, null, 2));
        console.log("🔄 AGENDAMENTO ALTERADO:", dados.nome, "-", horarioAntigo, "->", horarioNovo);
        confirmacoes.push({ nome: dados.nome, horario: horarioNovo });
      }
    } catch (e) {
      console.error("Falha ao reagendar:", e.message);
    }
  }
  texto = texto.replace(marcaReagendar, "").trim();

  if (confirmacoes.length > 0) {
    const enderecosUnicos = new Set();
    const linhas = confirmacoes.map(({ nome, horario }) => {
      const { data, hora } = formatarDataHora(horario);
      const endereco = CFG.ENDERECOS_POR_CIDADE[extrairCidade(horario)];
      if (endereco) enderecosUnicos.add(endereco);
      const prefixoNome = confirmacoes.length > 1 ? `👤 *${nome}*: ` : "";
      return `${prefixoNome}📅 *${data}*, às *${hora}*`;
    });
    if (enderecosUnicos.size > 0) {
      linhas.push([...enderecosUnicos].map((e) => `📍 *${e}*`).join("\n"));
    }
    texto = `${texto}\n\n${linhas.join("\n")}`;
  }

  const marcaTransferir = /###TRANSFERIR_HUMANO###/;
  if (marcaTransferir.test(texto)) {
    if (!pausados.has(jid)) {
      pausados.add(jid);
      salvarPausados(pausados);
      console.log("👤 Transferido para atendente humano:", jid.replace("@s.whatsapp.net", ""));
    }
    texto = texto.replace(marcaTransferir, "").trim();
  }

  return texto;
}

async function responder(sock, jid, textoRecebido) {
  const texto = (textoRecebido || "").trim();
  if (!texto) return;

  let hist = historicos.get(jid) || [];
  hist.push({ role: "cliente", text: texto });
  if (hist.length > MAX_HISTORICO) hist = hist.slice(-MAX_HISTORICO);
  historicos.set(jid, hist);
  salvarHistoricos();

  let resposta;
  let houveErroIA = false;
  try {
    resposta = await perguntarIA(hist, jid);
    resposta = processarResposta(resposta, jid);
    resposta = resposta.replace(/\*\*(.+?)\*\*/g, "*$1*");
    if (!resposta) resposta = "Um momentinho... 😊";
  } catch (e) {
    console.error("Erro na IA:", e.message);
    houveErroIA = true;
    resposta =
      `Oi! Aqui é da ${CFG.NOME_EMPRESA} 😅 Deu uma falha rapidinha aqui do nosso lado agora. ` +
      `Pode mandar sua mensagem de novo?`;
  }

  try {
    await sock.sendPresenceUpdate("composing", jid);
  } catch {}
  const atrasoDigitando = 2000 + Math.random() * 3000;
  await espera(atrasoDigitando);

  let enviada;
  try {
    enviada = await sock.sendMessage(jid, { text: resposta });
  } catch (e) {
    console.error("Erro ao enviar mensagem pro cliente:", e.message);
    return;
  }
  try {
    await sock.sendPresenceUpdate("paused", jid);
  } catch {}
  registrarIdEnviado(enviada?.key?.id);
  ultimoEnvioAutomatico.set(jid, Date.now());

  if (!houveErroIA) {
    hist.push({ role: "atendente", text: resposta });
    historicos.set(jid, hist);
    salvarHistoricos();
  }
}

const LEMBRETE_INATIVIDADE_MS = 60 * 60 * 1000; // 1 hora sem resposta
const LEMBRETE_JANELA_MAX_MS = 24 * 60 * 60 * 1000; // não manda pra quem sumiu há mais de 1 dia

function jaAgendou(telefone) {
  return carregarAgendamentos().some((a) => telefonesEquivalentes(a.telefone, telefone));
}

async function verificarLembretesDeUrgencia() {
  if (!sockAtual) return;
  const agora = Date.now();
  for (const [chave, info] of Object.entries(contatos)) {
    if (info.lembreteEnviado) continue;
    const jidReal = chave.endsWith("@lid") ? chave : chave + "@s.whatsapp.net";
    if (pausados.has(jidReal) || pausados.has(chave)) continue;
    const inativoMs = agora - new Date(info.ultimaMensagem).getTime();
    if (inativoMs < LEMBRETE_INATIVIDADE_MS || inativoMs > LEMBRETE_JANELA_MAX_MS) continue;
    const telefoneResolvido = chave.endsWith("@lid") ? info.numeroReal || chave : chave;
    if (jaAgendou(telefoneResolvido)) continue;

    const mensagem =
      "Oi! 👋 Vi que você começou a conversar com a gente mas ainda não garantiu seu horário do exame de vista gratuito. " +
      "As vagas estão acabando rápido — quer que eu já deixe reservado um horário pra você? 😊";

    try {
      const enviada = await sockAtual.sendMessage(jidReal, { text: mensagem });
      registrarIdEnviado(enviada?.key?.id);
      ultimoEnvioAutomatico.set(jidReal, Date.now());

      let hist = historicos.get(jidReal) || [];
      hist.push({ role: "atendente", text: mensagem });
      if (hist.length > MAX_HISTORICO) hist = hist.slice(-MAX_HISTORICO);
      historicos.set(jidReal, hist);
      salvarHistoricos();

      info.lembreteEnviado = true;
      salvarContatos(contatos);
      console.log("⏰ Lembrete de urgência enviado para:", chave);
    } catch (e) {
      console.error("Erro ao enviar lembrete:", e.message);
    }
  }
}

let geracaoAtual = 0;

async function iniciarBot() {
  const minhaGeracao = ++geracaoAtual;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  if (minhaGeracao !== geracaoAtual) {
    return null;
  }

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  let timerCodigo = null;
  if (!sock.authState.creds.registered) {
    timerCodigo = setTimeout(async () => {
      if (minhaGeracao !== geracaoAtual) return;
      if (sock.authState.creds.registered) return;
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
    if (minhaGeracao !== geracaoAtual) return;
    if (qr) {
      qrAtual = qr;
      statusConexao = "aguardando_qr";
      console.log("\n📱 Ou escaneie o QR code:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      clearTimeout(timerCodigo);
      conectadoEm = Date.now();
      qrAtual = null;
      statusConexao = "conectado";
      console.log("✅ Bot conectado ao WhatsApp!");
    }
    if (connection === "close") {
      clearTimeout(timerCodigo);
      const deveReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      statusConexao = deveReconectar ? "reconectando" : "desconectado";
      console.log("Conexão caiu.", deveReconectar ? "Reconectando..." : "Deslogado.");
      if (deveReconectar)
        setTimeout(async () => {
          const novoSock = await iniciarBot();
          if (novoSock) sockAtual = novoSock;
        }, 2000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) continue;

      let texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (msg.key.fromMe) {
        const limparId = (j) => (j || "").split("@")[0].split(":")[0];
        const parteNumerica = limparId(jid);
        const pareceContatoReal = /^\d{8,15}$/.test(parteNumerica);
        if (limparId(jid) === limparId(sock.user?.id)) continue;
        if (Date.now() - conectadoEm < JANELA_POS_CONEXAO_MS) continue;
        if (texto.trim().toLowerCase() === "/retomar") {
          if (pausados.delete(jid)) {
            salvarPausados(pausados);
            console.log("▶️  IA retomada para:", jid.replace("@s.whatsapp.net", ""));
          }
        } else if (
          texto.trim() &&
          pareceContatoReal &&
          !idsEnviadosPeloBot.has(msg.key.id) &&
          Date.now() - (ultimoEnvioAutomatico.get(jid) || 0) >= JANELA_ECO_MS
        ) {
          let hist = historicos.get(jid) || [];
          hist.push({ role: "atendente", text: texto.trim() });
          if (hist.length > MAX_HISTORICO) hist = hist.slice(-MAX_HISTORICO);
          historicos.set(jid, hist);
          salvarHistoricos();

          if (!pausados.has(jid)) {
            pausados.add(jid);
            salvarPausados(pausados);
            console.log(
              "⏸️  IA pausada (resposta manual detectada) para:",
              jid.replace("@s.whatsapp.net", "")
            );
          }
        }
        continue;
      }

      if (!texto.trim() && msg.message?.audioMessage) {
        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {}, {
            logger: pino({ level: "silent" }),
            reuploadRequest: sock.updateMediaMessage,
          });
          const base64Audio = buffer.toString("base64");
          const mimeType = msg.message.audioMessage.mimetype || "audio/ogg";
          texto = await transcreverAudio(base64Audio, mimeType);
          console.log("🎤 Áudio transcrito de", jid.replace("@s.whatsapp.net", ""), ":", texto.slice(0, 150));
        } catch (e) {
          console.error("Erro ao transcrever áudio:", e.message);
        }
      }

      const numeroReal = msg.key.remoteJidAlt
        ? msg.key.remoteJidAlt.split("@")[0]
        : jid.endsWith("@s.whatsapp.net")
        ? jid.split("@")[0]
        : null;
      registrarContato(jid, numeroReal);
      if (!texto.trim()) continue;
      if (pausados.has(jid)) {
        let hist = historicos.get(jid) || [];
        hist.push({ role: "cliente", text: texto.trim() });
        if (hist.length > MAX_HISTORICO) hist = hist.slice(-MAX_HISTORICO);
        historicos.set(jid, hist);
        salvarHistoricos();
        continue;
      }

      bufferizarMensagem(sock, jid, texto);
    }
  });

  return sock;
}

function iniciarServidorHTTP(getSock) {
  const app = express();
  app.use(express.json());

  app.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "painel.html"));
  });

  app.get("/api/dados", (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    const conversas = Object.entries(contatos)
      .map(([telefone, info]) => ({
        telefone,
        numeroReal: info.numeroReal || null,
        pausado: pausados.has(telefone) || pausados.has(telefone + "@s.whatsapp.net"),
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
      statusConexao,
      temQR: !!qrAtual,
      conectadoDesde: conectadoEm ? new Date(conectadoEm).toISOString() : null,
      numeroBot: CFG.NUMERO_BOT,
    });
  });

  app.get("/api/qr", async (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!qrAtual) return res.status(404).json({ erro: "Nenhum QR code disponível agora" });
    try {
      const imagemDataUrl = await gerarQRImagem.toDataURL(qrAtual, { width: 300 });
      res.json({ imagem: imagemDataUrl });
    } catch (e) {
      res.status(500).json({ erro: "Falha ao gerar QR code" });
    }
  });

  app.post("/api/reconectar", async (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (statusConexao === "conectado") {
      return res.status(400).json({ erro: "Já está conectado" });
    }
    try {
      try {
        sockAtual?.end?.(new Error("Reconectando via painel"));
      } catch {}
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      qrAtual = null;
      statusConexao = "conectando";
      const novoSock = await iniciarBot();
      if (novoSock) sockAtual = novoSock;
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erro: "Falha ao reconectar" });
    }
  });

  app.get("/api/conversa", (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    const jid = req.query.jid;
    if (!jid) return res.status(400).json({ erro: "Informe jid" });
    res.json({ mensagens: historicos.get(jid) || [] });
  });

  app.post("/api/enviar", async (req, res) => {
    const { chave, jid, texto } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!jid || !texto || !texto.trim()) {
      return res.status(400).json({ erro: "Informe jid e texto" });
    }
    const sock = getSock();
    if (!sock) return res.status(503).json({ erro: "Bot ainda não conectado" });

    try {
      const enviada = await sock.sendMessage(jid, { text: texto });
      registrarIdEnviado(enviada?.key?.id);
      ultimoEnvioAutomatico.set(jid, Date.now());

      let hist = historicos.get(jid) || [];
      hist.push({ role: "atendente", text: texto });
      if (hist.length > MAX_HISTORICO) hist = hist.slice(-MAX_HISTORICO);
      historicos.set(jid, hist);
      salvarHistoricos();

      if (!pausados.has(jid)) {
        pausados.add(jid);
        salvarPausados(pausados);
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao enviar mensagem manual:", e.message);
      res.status(500).json({ erro: "Falha ao enviar mensagem" });
    }
  });

  app.post("/api/agendamento-manual", (req, res) => {
    const { chave, nome, telefone, horario } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!nome || !nome.trim() || !horario || !horario.trim()) {
      return res.status(400).json({ erro: "Informe nome e horário" });
    }
    salvarAgendamento({
      nome: nome.trim(),
      telefone: (telefone || "").trim(),
      horario: horario.trim(),
      origem: "manual",
    });
    res.json({ ok: true });
  });

  app.post("/api/agendamento-transferido", (req, res) => {
    const { chave, criadoEm, transferido } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!criadoEm) return res.status(400).json({ erro: "Informe criadoEm" });
    const lista = carregarAgendamentos();
    const item = lista.find((a) => a.criadoEm === criadoEm);
    if (!item) return res.status(404).json({ erro: "Agendamento não encontrado" });
    item.transferido = !!transferido;
    fs.writeFileSync(ARQ_AGENDAMENTOS, JSON.stringify(lista, null, 2));
    res.json({ ok: true });
  });

  function telefoneParaJid(telefone) {
    return telefone.endsWith("@lid")
      ? telefone
      : telefone.replace(/\D/g, "") + "@s.whatsapp.net";
  }

  app.post("/api/retomar", (req, res) => {
    const { chave, telefone } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!telefone) return res.status(400).json({ erro: "Envie telefone" });
    const jid = telefoneParaJid(telefone);
    const havia = pausados.delete(jid);
    if (havia) salvarPausados(pausados);
    res.json({ ok: true, retomado: havia });
  });

  app.post("/api/retomar-todos", (req, res) => {
    const { chave } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    const quantidade = pausados.size;
    pausados.clear();
    salvarPausados(pausados);
    console.log(`▶️  IA retomada para todas as ${quantidade} conversas pausadas`);
    res.json({ ok: true, retomados: quantidade });
  });

  app.post("/api/pausar", (req, res) => {
    const { chave, telefone } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!telefone) return res.status(400).json({ erro: "Envie telefone" });
    const jid = telefoneParaJid(telefone);
    const jaEstava = pausados.has(jid);
    pausados.add(jid);
    if (!jaEstava) salvarPausados(pausados);
    res.json({ ok: true });
  });

  app.post("/api/pausar-todos", (req, res) => {
    const { chave } = req.body || {};
    if (chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    let quantidade = 0;
    for (const telefoneOuLid of Object.keys(contatos)) {
      const jid = telefoneOuLid.endsWith("@lid") ? telefoneOuLid : telefoneOuLid + "@s.whatsapp.net";
      if (!pausados.has(jid)) quantidade++;
      pausados.add(jid);
    }
    salvarPausados(pausados);
    console.log(`⏸️  IA pausada manualmente para todas as ${quantidade} conversas ativas`);
    res.json({ ok: true, pausados: quantidade });
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
      const endereco = CFG.ENDERECOS_POR_CIDADE[extrairCidade(horario)] || CFG.ENDERECO;
      await sock.sendMessage(jid, {
        text:
          `Oi, ${nome}! Aqui é o ${CFG.NOME_EMPRESA} 😊\n\n` +
          `Vi que você agendou seu exame de vista gratuito pelo nosso site. ` +
          `Tá confirmado:\n\n` +
          `📅 ${horario}\n📍 ${endereco}\n\n` +
          `O exame leva uns 30 minutos e não precisa levar nada. ` +
          `Qualquer dúvida é só me chamar por aqui!`,
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("Erro ao enviar confirmação:", e.message);
      res.status(500).json({ erro: "Falha ao enviar mensagem" });
    }
  });

  app.get("/api/campanhas", async (req, res) => {
    if (req.query.chave !== CFG.CHAVE_API) {
      return res.status(401).json({ erro: "Chave inválida" });
    }
    if (!CFG.FB_ACCESS_TOKEN || !CFG.FB_AD_ACCOUNT_ID) {
      return res.status(400).json({
        erro:
          "Integração com Meta Ads não configurada. Defina FB_ACCESS_TOKEN e FB_AD_ACCOUNT_ID no .env.",
      });
    }

    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 90);
    const emCache = cacheCampanhas.get(dias);
    if (emCache && Date.now() - emCache.buscadoEm < CACHE_CAMPANHAS_MS) {
      return res.json(emCache.dados);
    }

    try {
      const linhas = await buscarInsightsMeta(dias);
      const relatorio = montarRelatorioCampanhas(linhas, dias);
      cacheCampanhas.set(dias, { buscadoEm: Date.now(), dados: relatorio });
      res.json(relatorio);
    } catch (e) {
      console.error("Erro ao buscar Meta Ads:", e.message);
      res.status(502).json({ erro: "Falha ao consultar Meta Ads: " + e.message });
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
  setInterval(verificarLembretesDeUrgencia, 5 * 60 * 1000);
})().catch((e) => {
  console.error("Erro fatal ao iniciar o bot:", e.message);
  process.exit(1);
});
