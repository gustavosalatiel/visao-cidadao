module.exports = {
  NOME_EMPRESA: "Visão Cidadão",
  NOME_ATENDENTE: "Gessica",
  ENDERECO: "O ponto de atendimento exato é confirmado pela equipe conforme a cidade do dia escolhido",
  CIDADE: "Acre, Amazonas e Rondônia (mutirão itinerante — uma cidade por dia)",
  HORARIOS: [
    "Sábado 15 de agosto em Xapuri-AC às 08:00",
    "Sábado 15 de agosto em Xapuri-AC às 09:00",
    "Sábado 15 de agosto em Xapuri-AC às 10:00",
    "Sábado 15 de agosto em Xapuri-AC às 14:00",
    "Sábado 15 de agosto em Xapuri-AC às 15:00",
    "Sábado 15 de agosto em Xapuri-AC às 16:00",
    "Domingo 16 de agosto em Boca do Acre-AM às 08:00",
    "Domingo 16 de agosto em Boca do Acre-AM às 09:00",
    "Domingo 16 de agosto em Boca do Acre-AM às 10:00",
    "Domingo 16 de agosto em Boca do Acre-AM às 14:00",
    "Domingo 16 de agosto em Boca do Acre-AM às 15:00",
    "Domingo 16 de agosto em Boca do Acre-AM às 16:00",
    "Segunda-feira 17 de agosto em Boca do Acre-AM às 08:00",
    "Segunda-feira 17 de agosto em Boca do Acre-AM às 09:00",
    "Segunda-feira 17 de agosto em Boca do Acre-AM às 10:00",
    "Segunda-feira 17 de agosto em Boca do Acre-AM às 14:00",
    "Segunda-feira 17 de agosto em Boca do Acre-AM às 15:00",
    "Segunda-feira 17 de agosto em Boca do Acre-AM às 16:00",
    "Terça-feira 18 de agosto em Acrelândia-AC às 08:00",
    "Terça-feira 18 de agosto em Acrelândia-AC às 09:00",
    "Terça-feira 18 de agosto em Acrelândia-AC às 10:00",
    "Terça-feira 18 de agosto em Acrelândia-AC às 14:00",
    "Terça-feira 18 de agosto em Acrelândia-AC às 15:00",
    "Terça-feira 18 de agosto em Acrelândia-AC às 16:00",
    "Quarta-feira 19 de agosto no Distrito de Extrema-RO às 08:00",
    "Quarta-feira 19 de agosto no Distrito de Extrema-RO às 09:00",
    "Quarta-feira 19 de agosto no Distrito de Extrema-RO às 10:00",
    "Quarta-feira 19 de agosto no Distrito de Extrema-RO às 14:00",
    "Quarta-feira 19 de agosto no Distrito de Extrema-RO às 15:00",
    "Quarta-feira 19 de agosto no Distrito de Extrema-RO às 16:00",
    "Sexta-feira 21 de agosto em Guajará-Mirim-RO às 08:00",
    "Sexta-feira 21 de agosto em Guajará-Mirim-RO às 09:00",
    "Sexta-feira 21 de agosto em Guajará-Mirim-RO às 10:00",
    "Sexta-feira 21 de agosto em Guajará-Mirim-RO às 14:00",
    "Sexta-feira 21 de agosto em Guajará-Mirim-RO às 15:00",
    "Sexta-feira 21 de agosto em Guajará-Mirim-RO às 16:00",
  ],
  INFORMACOES: `
- O exame de vista é 100% GRATUITO. Não vendemos nada, não tem custo nenhum em momento algum.
- Não precisa levar nenhum documento, só chegar no horário marcado.
- Atendemos qualquer idade.
- É um mutirão itinerante: passamos por uma cidade diferente do Acre, Amazonas e Rondônia a cada dia, conforme a agenda.
- A pessoa deve escolher a data e a cidade da lista de horários disponíveis mais perto dela.
- Depois do exame, o médico passa um atestado de horas pra pessoa levar no trabalho, na escola ou onde precisar, comprovando a ausência.
- Exames e avaliações que fazemos: retinografia, biomicroscopia, tonometria, refração computadorizada, avaliação cirúrgica, encaminhamentos e laudos cirúrgicos.
`,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "COLE-SUA-CHAVE-AQUI",
  NUMERO_BOT: process.env.NUMERO_BOT || "5500000000000",
  PORTA_HTTP: process.env.PORT || process.env.PORTA_HTTP || 3000,
  CHAVE_API: process.env.CHAVE_API || "troque-esta-chave-123",
  DELAY_MS: 2500,
};
