const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bot-cotas-"));
process.env.AUTH_DIR = path.join(process.env.DATA_DIR, "auth");
delete process.env.LIMPAR_AUTH;
// Estas regras são de setembro: o teste não pode depender da data real de execução.
test.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-17T12:00:00Z") });

const {
  ordenarHorariosEquilibrados,
  escolherHorarioEquilibrado,
  COTAS_DE_ABERTURA,
} = require("../index");

const DIA_19 = "Sábado 19 de setembro em Bela Vista do Caracol-PA";
const DIA_18 = "Sexta-feira 18 de setembro em Bela Vista do Caracol-PA";

const horariosDoDia = (stem) =>
  ["08:00", "09:00", "10:00", "14:00", "15:00", "16:00"].map((h) => `${stem} às ${h}`);

const cheios = (...pares) =>
  pares.flatMap(([hora, quantos]) =>
    Array.from({ length: quantos }, () => ({ horario: `${DIA_19} às ${hora}`, telefone: "55" }))
  );

const escolher = (agendamentos, quantidade = 1) =>
  escolherHorarioEquilibrado(`${DIA_19} às 08:00`, agendamentos, quantidade);

test("dia 19 começa pelas 08:00", () => {
  assert.equal(escolher([]), `${DIA_19} às 08:00`);
});

test("dia 19: com a cota das 08:00 cheia (10), vai para 09:00", () => {
  assert.equal(escolher(cheios(["08:00", 10])), `${DIA_19} às 09:00`);
});

test("dia 19: com 08:00 e 09:00 cheias, vai para 14:00 e não para 10:00", () => {
  const escolhido = escolher(cheios(["08:00", 10], ["09:00", 10]));
  assert.equal(escolhido, `${DIA_19} às 14:00`);
});

test("dia 19: com as três primeiras cotas cheias, vai para 15:00", () => {
  const escolhido = escolher(cheios(["08:00", 10], ["09:00", 10], ["14:00", 10]));
  assert.equal(escolhido, `${DIA_19} às 15:00`);
});

test("dia 19: fechadas as 4 cotas, volta a dividir manhã e tarde e libera 10:00/16:00", () => {
  const agendamentos = cheios(["08:00", 10], ["09:00", 10], ["14:00", 10], ["15:00", 10]);
  const escolhido = escolher(agendamentos);
  assert.ok(
    [`${DIA_19} às 10:00`, `${DIA_19} às 16:00`].includes(escolhido),
    `esperava 10:00 ou 16:00 depois das cotas, veio ${escolhido}`
  );
});

test("dia 19: a cota aparece em primeiro lugar na lista mostrada à IA", () => {
  const ordem = ordenarHorariosEquilibrados(horariosDoDia(DIA_19), cheios(["08:00", 10]));
  assert.equal(ordem[0], `${DIA_19} às 09:00`);
});

test("família de 4 entra inteira na mesma cota", () => {
  const escolhido = escolher(cheios(["08:00", 3]), 4);
  assert.equal(escolhido, `${DIA_19} às 08:00`);
});

test("família que não cabe no resto da cota vai inteira para a cota seguinte", () => {
  // sobram 2 vagas nas 08:00 e a família tem 5: ninguém fica para trás
  const escolhido = escolher(cheios(["08:00", 8]), 5);
  assert.equal(escolhido, `${DIA_19} às 09:00`);
});

test("dia 18 também segue a prioridade de abertura", () => {
  const agendamentos = Array.from({ length: 3 }, () => ({
    horario: `${DIA_18} às 08:00`,
    telefone: "55",
  }));
  const ordem = ordenarHorariosEquilibrados(horariosDoDia(DIA_18), agendamentos);
  assert.equal(ordem[0], `${DIA_18} às 08:00`);
});

test("todo dia com cota existe de fato na agenda do config", () => {
  const CFG = require("../config.js");
  const stem = (h) => h.replace(/às\s*\d{2}:\d{2}/i, "").trim();
  const hora = (h) => (h.match(/às\s*(\d{2}:\d{2})/i) || [])[1];

  for (const [dia, cotas] of Object.entries(COTAS_DE_ABERTURA)) {
    const doDia = CFG.HORARIOS.filter((h) => stem(h) === dia);
    assert.ok(doDia.length, `"${dia}" não existe em CFG.HORARIOS — a cota não pegaria ninguém`);
    for (const { hora: h } of cotas) {
      assert.ok(
        doDia.some((item) => hora(item) === h),
        `"${dia}" não tem o horário ${h} no config`
      );
    }
  }
});

test("50 pessoas chegando uma a uma caem na ordem 8h, 9h, 14h, 15h e só depois se dividem", () => {
  const agendados = [];
  const hora = (h) => (h.match(/às\s*(\d{2}:\d{2})/) || [])[1];
  const ordem = [];

  for (let i = 1; i <= 50; i++) {
    const h = escolherHorarioEquilibrado(`${DIA_19} às 08:00`, agendados, 1);
    agendados.push({ horario: h, telefone: "55" + i });
    ordem.push(hora(h));
  }

  assert.deepEqual(ordem.slice(0, 10), Array(10).fill("08:00"));
  assert.deepEqual(ordem.slice(10, 20), Array(10).fill("09:00"));
  assert.deepEqual(ordem.slice(20, 30), Array(10).fill("14:00"));
  assert.deepEqual(ordem.slice(30, 40), Array(10).fill("15:00"));

  // depois das 4 cotas, ninguém mais é empilhado: entram 10:00 e 16:00
  const depois = new Set(ordem.slice(40));
  assert.ok(depois.has("10:00"), "10:00 deveria abrir depois das cotas");
  assert.ok(depois.has("16:00"), "16:00 deveria abrir depois das cotas");
});
