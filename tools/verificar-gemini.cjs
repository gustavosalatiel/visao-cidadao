// Teste isolado: nenhum dado de paciente, gravação ou mensagem WhatsApp.
const path=require('node:path');
const cfg=require(path.join(process.cwd(),'config.js'));
(async()=>{
  const inicio=Date.now();
  const resposta=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key='+encodeURIComponent(cfg.GEMINI_API_KEY),{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
    body:JSON.stringify({contents:[{role:'user',parts:[{text:'Responda apenas: OK'}]}],generationConfig:{temperature:0,maxOutputTokens:32}})
  });
  const dados=await resposta.json();
  console.log(JSON.stringify({http:resposta.status,duracaoMs:Date.now()-inicio,termino:dados.candidates?.[0]?.finishReason,respondeu:!!dados.candidates?.[0]?.content?.parts?.some(p=>p.text?.trim()),erro:dados.error?.status}));
})().catch(e=>{console.error(e.name);process.exitCode=1});
