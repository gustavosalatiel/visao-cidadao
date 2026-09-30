# Auditoria do Visão Cidadão — 17/09/2026

## Evidências

- Vídeo analisado visualmente: confirmações de local em Caracol entravam em repetição, apesar de a pessoa responder “Sim será na escola Bela Vista do Caracol”. O filtro tratava a palavra “será” como dúvida. O endereço também contém Trairão, o que exige distinguir município de referência e destino do atendimento.
- Código local e servidor tinham os mesmos hashes no início da revisão; as alterações anteriores não foram descartadas.
- Consulta de produção: 1.490 agendamentos em arquivo e os mesmos 1.490 retornados ao painel; 2.438 contatos e 2.381 históricos. Isso prova a correspondência arquivo/painel, não que toda promessa feita em conversa foi gravada.
- API Gemini respondeu HTTP 200, com resposta completa, no teste isolado sem pacientes. Logs acumulados contêm 123 ocorrências 503 e 23 `fetch failed`; não há base para atribuir todas a um período recente.
- WhatsApp: processo online, mas sessão desconectada e eventos de logout. API da IA e conexão WhatsApp são serviços independentes.

## Correções desta revisão

- Aceite do local mostrado no vídeo reconhecido sem tratar “será” isoladamente como dúvida.
- Normalização de horário mantém a data; não procura mais qualquer outro dia da mesma cidade.
- Nova reserva reconhece registro existente mesmo após 24h e com diferenças de maiúsculas/acentos do nome. Dados manuais entram nessa verificação.
- Reagendamento exige encontrar a pessoa no horário anterior e preserva os outros familiares e os metadados do cadastro.
- Contagem de capacidade inclui os familiares já agendados; confirmação parcial identifica que nem todos os pedidos foram concluídos.
- Cada confirmação vincula pessoa, data, horário e endereço no mesmo bloco.
- Agenda gravada por arquivo temporário e substituição; falha de leitura não vira lista vazia que sobrescreve dados.
- Pausa geral persistente inclui contatos novos e lembretes. Respostas em andamento são invalidadas quando a equipe pausa/assume ou muda a geração da conexão.
- Histórico deixa de ser apagado a cada 80 mensagens. Janela da IA considera até 15 dias de mensagens datadas, preserva o material antigo sem data e tem teto de 120 mil caracteres. Mensagens já removidas pelas versões antigas não podem ser recuperadas por essa mudança.
- Rotas do painel normalizam o identificador da conversa, inclusive contato identificado por LID; número curto não é tratado como telefone de outro paciente por sufixo.
- API da IA não repete erros permanentes (ex.: 403) e rejeita conteúdo cortado/bloqueado, em vez de usá-lo para marcar consulta.
- Cadastro manual valida nome completo, telefone, cidade, data, horário e capacidade. Seleção manual mostra horários disponíveis.
- Erro de envio manual preserva texto e informa a equipe. Exportação mantém horários alternativos na própria cidade.
- Reconexões antigas não podem substituir uma conexão nova; geração de QR é protegida contra cliques simultâneos. Troca de sessão pelo painel arquiva a sessão anterior em vez de apagá-la. A configuração de apagar autenticação a cada reinício foi bloqueada.
- Dados de pacientes e sessões arquivadas adicionados às exclusões do Git.

## Pendências nos dados anteriores

A consulta encontrou 14 grupos de possíveis duplicidades, 7 nomes inválidos e 23 horários com mais de 20 registros, além de 5 agendamentos fora do padrão. Todos possuem cidade identificável e telefone resolvido. Os horários alternativos não são, por si só, erros.

Esses registros foram preservados: excluir ou remanejar automaticamente poderia cancelar pacientes reais. Precisam de conferência com a equipe, especialmente nomes semelhantes, reservas de familiares e exceções autorizadas. A revisão não enviou mensagens aos pacientes.

## Validação e limites

82 testes automatizados aprovados: regras anteriores, vídeo, duplicidade, reagendamento, pausa durante chamada da IA, resposta truncada, arquivo inválido, integração HTTP e comportamento do painel. Dados fictícios isolados, sem mensagens reais.

Não é possível prometer ausência absoluta de falhas: linguagem livre continua dependendo da IA; a conexão WhatsApp usa Baileys e pode exigir novo pareamento. Não houve teste real de recebimento/envio com o telefone do cliente porque a sessão estava deslogada. Agendamento gravado e mensagem entregue são operações diferentes; falha de rede pode impedir a confirmação de chegar mesmo com a reserva salva.

## Publicação

Correções de `index.js` e `painel.html` publicadas na VPS e hashes conferidos com os arquivos locais. Backup anterior em `/opt/visao-cidadao/backups/auditoria-20260918-044907` (acesso restrito).

Após a publicação: processo online, painel HTTP 200, os mesmos 1.490 agendamentos e 2.381 históricos. WhatsApp retornou código 401/deslogado; precisa de novo pareamento na aba Conexão. A sessão não foi apagada durante esta publicação. Nenhuma chave foi alterada ou exposta e nenhum paciente recebeu mensagem de teste.
