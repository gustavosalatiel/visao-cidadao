// Verificação somente leitura: não conecta ao WhatsApp nem importa index.js.
const path=require('node:path');
const cfg=require(path.join(process.cwd(),'config.js'));
(async()=>{
 const r=await fetch('http://localhost:'+cfg.PORTA_HTTP+'/api/dados?chave='+encodeURIComponent(cfg.CHAVE_API),{signal:AbortSignal.timeout(15000)});
 if(!r.ok) throw new Error('Painel HTTP '+r.status);
 const d=await r.json();
 const cidades=['Cachoeira da Serra-PA','Castelo dos Sonhos-PA','Novo Progresso-PA','Uruará-PA'];
 console.log(JSON.stringify({http:r.status,statusConexao:d.statusConexao,agendamentos:d.agendamentos?.length,esperaPreservada:d.listaEsperaNovoProgresso?.length,cidades:cidades.map(cidade=>({cidade,horarios:cfg.HORARIOS.filter(h=>h.includes('em '+cidade+' às')).length,presenteNaAPI:JSON.stringify(d).includes(cidade),endereco:cfg.ENDERECOS_POR_CIDADE[cidade]}))},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
