// Somente leitura. Executar na pasta do bot; não importa index.js nem conecta WhatsApp.
const fs = require('node:fs');
const path = require('node:path');
const cfg = require(path.join(process.cwd(), 'config.js'));
const dir = process.env.DATA_DIR || process.cwd();
const ler = (nome, padrao) => fs.existsSync(path.join(dir,nome)) ? JSON.parse(fs.readFileSync(path.join(dir,nome),'utf8')) : padrao;
const agenda=ler('agendamentos.json',[]), contatos=ler('contatos.json',{}), historicos=ler('historicos.json',{});
const normal = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const grupos=new Map(), ocupacao=new Map();
let semTelefone=0,semNome=0,semCidade=0,foraPadrao=0;
for(const a of agenda){
  if(!a.telefone || /@lid$/.test(a.telefone)) semTelefone++;
  if(!a.nome || /usu.rio|whatsapp|desconhecid/i.test(a.nome))semNome++;
  if(!/\b(?:em|no|na)\s+(.+?)\s+às\s+\d{2}:\d{2}/i.test(a.horario||''))semCidade++;
  if(!cfg.HORARIOS.includes(a.horario))foraPadrao++;
  const k=normal(a.nome)+'|'+String(a.telefone||'').replace(/\D/g,'')+'|'+a.horario;
  grupos.set(k,(grupos.get(k)||0)+1);
  ocupacao.set(a.horario,(ocupacao.get(a.horario)||0)+1);
}
(async()=>{
  const processos=JSON.parse(require('node:child_process').execFileSync('pm2',['jlist'],{encoding:'utf8'}));
  const processo=processos.find(p=>p.name==='visao-cidadao');
  const dadosProcesso=processo ? {status:processo.pm2_env.status,reinicios:processo.pm2_env.restart_time,script:processo.pm2_env.pm_exec_path,cwd:processo.pm2_env.pm_cwd,limparAuthPM2:processo.pm2_env.LIMPAR_AUTH==='1'} : null;
  const log=processo && fs.existsSync(processo.pm2_env.pm_out_log_path)?fs.readFileSync(processo.pm2_env.pm_out_log_path,'utf8'):'';
  const erroLog=processo && fs.existsSync(processo.pm2_env.pm_err_log_path)?fs.readFileSync(processo.pm2_env.pm_err_log_path,'utf8'):'';
  const conexoes=log.split('\n').filter(l=>/Conexão caiu|Bot conectado ao WhatsApp|Iniciando bot/.test(l)).slice(-8);
  const resposta=await fetch('http://localhost:'+cfg.PORTA_HTTP+'/api/dados?chave='+encodeURIComponent(cfg.CHAVE_API),{signal:AbortSignal.timeout(10000)});
  const painel=await resposta.json();
  console.log(JSON.stringify({agenda:agenda.length,contatos:Object.keys(contatos).length,conversas:Object.keys(historicos).length,
    semTelefoneResolvido:semTelefone,nomesInvalidos:semNome,semCidadeIdentificavel:semCidade,foraPadrao,
    gruposDuplicados:[...grupos.values()].filter(n=>n>1).length,horariosAcima20:[...ocupacao.values()].filter(n=>n>20).length,
    painelHttp:resposta.status,statusConexao:painel.statusConexao,agendaNoPainel:painel.agendamentos?.length,
    limparAuthAtivo:process.env.LIMPAR_AUTH==='1',horaServidor:new Date().toISOString(),processo:dadosProcesso,ultimosEventosConexao:conexoes,
    errosAcumulados:{gemini503:(erroLog.match(/Gemini 503/g)||[]).length,fetch:(erroLog.match(/fetch failed/g)||[]).length}},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
