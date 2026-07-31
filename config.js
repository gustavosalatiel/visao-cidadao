module.exports = {
  NOME_EMPRESA: "Visão Cidadão",
  NOME_ATENDENTE: "Gessica",
  ENDERECO: "O ponto de atendimento exato é confirmado pela equipe conforme a cidade do dia escolhido",
  CIDADE: "Acre, Amazonas e Rondônia (mutirão itinerante — uma cidade por dia)",
  HORARIOS: [
    "Sábado 15/08 em Xapuri-AC às 09:00",
    "Sábado 15/08 em Xapuri-AC às 14:00",
    "Domingo 16/08 em Boca do Acre-AM às 09:00",
    "Domingo 16/08 em Boca do Acre-AM às 14:00",
    "Segunda-feira 17/08 em Boca do Acre-AM às 09:00",
    "Segunda-feira 17/08 em Boca do Acre-AM às 14:00",
    "Terça-feira 18/08 em Acrelândia-AC às 09:00",
    "Terça-feira 18/08 em Acrelândia-AC às 14:00",
    "Quarta-feira 19/08 no Distrito de Extrema-RO às 09:00",
    "Quarta-feira 19/08 no Distrito de Extrema-RO às 14:00",
    "Sexta-feira 21/08 em Guajará-Mirim-RO às 09:00",
    "Sexta-feira 21/08 em Guajará-Mirim-RO às 14:00",
  ],
  INFORMACOES: `
- O exame de vista é 100% GRATUITO. Não vendemos nada, não tem custo nenhum em momento algum.
- Não precisa levar nenhum documento, só chegar no horário marcado.
- Atendemos qualquer idade.
- É um mutirão itinerante: passamos por uma cidade diferente do Acre, Amazonas e Rondônia a cada dia, conforme a agenda.
- A pessoa deve escolher a data e a cidade da lista de horários disponíveis mais perto dela.
`,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "COLE-SUA-CHAVE-AQUI",
  NUMERO_BOT: process.env.NUMERO_BOT || "5500000000000",
  PORTA_HTTP: process.env.PORT || process.env.PORTA_HTTP || 3000,
  CHAVE_API: process.env.CHAVE_API || "troque-esta-chave-123",
  DELAY_MS: 2500,
};
