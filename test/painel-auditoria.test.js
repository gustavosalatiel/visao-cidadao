const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../painel.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
function painel(){
  const elementos=new Map(),avisos=[];
  const element=id=>{if(!elementos.has(id))elementos.set(id,{value:'',innerHTML:'',disabled:false,focus(){},addEventListener(){},classList:{add(){},remove(){}}});return elementos.get(id)};
  const ctx=vm.createContext({document:{querySelectorAll:()=>[],getElementById:element},localStorage:{getItem:()=>null},setInterval:()=>0,setTimeout:()=>0,clearInterval(){},alert:m=>avisos.push(m),console,fetch:async()=>({ok:false,json:async()=>({erro:'WhatsApp desconectado'})})});
  vm.runInContext(scripts,ctx);
  return {ctx,element,avisos};
}
test('exportação mantém horários alternativos em sua cidade',()=>{
  const {ctx}=painel();vm.runInContext(`dadosAtuais={cidades:[{cidade:'Bela Vista do Caracol-PA',horarios:['Sábado 19 de setembro em Bela Vista do Caracol-PA às 08:00']}]}`,ctx);
  const csv=ctx.gerarCSVDeAgendamentos([{nome:'Maria Teste',telefone:'5593999001111',horario:'Sábado 19 de setembro em Bela Vista do Caracol-PA às 11:30'}]);
  assert.match(csv,/"Bela Vista do Caracol-PA","Maria Teste"/);assert.doesNotMatch(csv,/Outros horários/);
});
test('envio manual com erro preserva o texto e avisa a equipe',async()=>{
  const {ctx,element,avisos}=painel();element('envio-5593999001111').value='Mensagem importante';
  await ctx.enviarMensagem('5593999001111');
  assert.equal(element('envio-5593999001111').value,'Mensagem importante');assert.equal(avisos[0],'WhatsApp desconectado');
});
test('cidade contém seção fora do padrão e protege o nome do paciente',()=>{
  const {ctx}=painel();vm.runInContext(`dadosAtuais={horarios:['Sábado 19 de setembro em Bela Vista do Caracol-PA às 08:00'],cidades:[{cidade:'Bela Vista do Caracol-PA',horarios:['Sábado 19 de setembro em Bela Vista do Caracol-PA às 08:00'],passada:false}],agendamentos:[{nome:'<img src=x onerror=alert(1)>',telefone:'5593999001111',horario:'Sábado 19 de setembro em Bela Vista do Caracol-PA às 11:30',criadoEm:'2026-09-17T12:00:00Z'}]}`,ctx);
  const bloco=ctx.montarBlocoCidade('Bela Vista do Caracol-PA',ctx.prepararDadosAgenda(''));
  assert.match(bloco.html,/fora-padrao/);assert.match(bloco.html,/11:30/);assert.doesNotMatch(bloco.html,/<img src=x/);
});
test('botão por cidade exporta somente seus pacientes incluindo horários alternativos',()=>{
  const {ctx}=painel();
  vm.runInContext(`dadosAtuais={cidades:[{cidade:'Divinópolis-PA',horarios:['Quarta-feira 23 de setembro em Divinópolis-PA às 08:00']}],agendamentos:[{nome:'Maria Teste',telefone:'5593999001111',horario:'Quarta-feira 23 de setembro em Divinópolis-PA às 08:00'},{nome:'João Teste',telefone:'5593999002222',horario:'Quarta-feira 23 de setembro em Divinópolis-PA às 11:30'},{nome:'Outra Cidade',horario:'Sábado 19 de setembro em Bela Vista do Caracol-PA às 08:00'}]}`,ctx);
  let resultado;
  ctx.baixarCSVString=(csv,nome)=>{resultado={csv,nome}};
  ctx.exportarCidade('Divinópolis-PA');
  assert.match(resultado.csv,/Maria Teste/);assert.match(resultado.csv,/João Teste/);
  assert.doesNotMatch(resultado.csv,/Outra Cidade/);assert.equal(resultado.nome,'agendamentos_Divinopolis_PA.csv');
});
test('download mantém URL disponível até o navegador iniciar a transferência',()=>{
  const {ctx}=painel();const passos=[];let liberar;
  ctx.Blob=Blob;
  ctx.URL={createObjectURL:()=> 'blob:teste',revokeObjectURL:()=>passos.push('liberou')};
  ctx.document.body={appendChild:()=>passos.push('anexou')};
  ctx.document.createElement=()=>({click:()=>passos.push('clicou'),remove:()=>passos.push('removeu')});
  ctx.setTimeout=(fn)=>{liberar=fn};
  ctx.baixarCSVString('cidade,nome','agenda.csv');
  assert.deepEqual(passos,['anexou','clicou','removeu']);liberar();assert.equal(passos.at(-1),'liberou');
});
test('espera aparece na agenda sem data fictícia ou contagem de confirmados',()=>{
  const {ctx}=painel();
  vm.runInContext(`dadosAtuais={cidades:[],horarios:[],agendamentos:[],listaEsperaNovoProgresso:[{nome:'Ana Teste',telefone:'5593999001111'}],listaEsperaRetornos:[]}`,ctx);
  const lista=ctx.montarBlocoCidade('Novo Progresso-PA',ctx.prepararDadosAgenda(''),true);
  assert.match(lista.html,/Novo Progresso-PA — Lista de espera/);
  assert.match(lista.html,/atendimento ainda não confirmado/);
  assert.match(lista.html,/Ana Teste/);
  assert.doesNotMatch(lista.html,/1 agendado|às 08:00/);
  assert.equal(ctx.montarBlocoCidade('Novo Progresso-PA',ctx.prepararDadosAgenda('não existe'),true),null);
  assert.doesNotMatch(html,/data-aba="esperaNovoProgresso"|id="painelEsperaNovoProgresso"/);
});
test('cidade encerrada tem retorno na agenda sem trazer os agendados antigos',()=>{
  const {ctx}=painel();
  vm.runInContext(`dadosAtuais={cidades:[{cidade:'Xapuri-AC',passada:true,horarios:[]}],horarios:[],agendamentos:[],listaEsperaRetornos:[{cidade:'Xapuri-AC',nome:'João Teste',telefone:'5593999002222'}]}`,ctx);
  const bloco=ctx.montarBlocoCidade('Xapuri-AC',ctx.prepararDadosAgenda(''),true);
  assert.equal(bloco.passada,false);assert.match(bloco.html,/João Teste/);
  let download;ctx.baixarCSVString=(csv,nome)=>download={csv,nome};ctx.exportarListaEspera('Xapuri-AC');
  assert.match(download.csv,/atendimento ainda não confirmado/);assert.match(download.nome,/lista_espera_Xapuri_AC/);
});
test('quadradinho da espera mostra verificado e desfaz mudança se servidor falhar',async()=>{
  const {ctx,avisos}=painel();
  const linha=ctx.linhaListaEspera({nome:'Maria Teste',idEspera:'abc',origemLista:'retornos',verificado:true});
  assert.match(linha,/type="checkbox" checked/);assert.match(linha,/Já verificado/);
  const input={checked:true,disabled:false,dataset:{id:'abc',origem:'retornos'}};
  await ctx.marcarEsperaVerificada(input);
  assert.equal(input.checked,false);assert.equal(input.disabled,false);assert.equal(avisos.length,1);
});
