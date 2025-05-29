const db = firebase.firestore();
let simulacao = [];

function exibirFiltros() {
  const tipo = document.getElementById("tipoRanking").value;
  document.getElementById("filtroData").style.display = ["mensal", "semanal", "time"].includes(tipo) ? "block" : "none";
  document.getElementById("filtroTime").style.display = tipo === "time" ? "block" : "none";
  document.getElementById("filtroJogo").style.display = tipo === "jogo" ? "block" : "none";
}

async function carregarTimesEJogos() {
  const jogosSnap = await db.collection("jogos").orderBy("dataInicio", "desc").get();
  const selectJogo = document.getElementById("jogoFiltro");
  selectJogo.innerHTML = "<option value=''>Selecione um jogo</option>";
  jogosSnap.forEach(doc => {
    const j = doc.data();
    const nome = `${j.timeCasaNome} x ${j.timeVisitanteNome}`;
    selectJogo.innerHTML += `<option value="${doc.id}">${nome}</option>`;
  });
}

function filtrarPorData(data, inicio, fim) {
  if (!inicio || !fim) return true;
  const d = data.toDate();
  return d >= inicio && d <= fim;
}

async function gerarPremiacao() {
  const tipo = document.getElementById("tipoRanking").value;
  const dataInicio = document.getElementById("dataInicio").value ? new Date(document.getElementById("dataInicio").value) : null;
  const dataFim = document.getElementById("dataFim").value ? new Date(document.getElementById("dataFim").value + "T23:59:59") : null;
  const timeFiltro = document.getElementById("timeFiltro").value.toLowerCase().trim();
  const jogoId = document.getElementById("jogoFiltro").value;

  const usuariosSnap = await db.collection("usuarios").get();
  const usuarios = [];

  for (const doc of usuariosSnap.docs) {
    const u = doc.data();
    usuarios.push({
      id: doc.id,
      nome: u.nome || "Sem nome",
      time: u.timeCoracao?.toLowerCase() || "-",
      pontos: 0
    });
  }

  const apostasSnap = await db.collection("apostas").get();
  apostasSnap.forEach(doc => {
    const a = doc.data();
    const usuario = usuarios.find(u => u.id === a.usuarioId);
    if (!usuario) return;

    const dataValida = !["mensal", "semanal", "time"].includes(tipo) || filtrarPorData(a.data, dataInicio, dataFim);
    const jogoValido = tipo !== "jogo" || a.jogoId === jogoId;
    const timeValido = tipo !== "time" || usuario.time === timeFiltro;

    if (dataValida && jogoValido && timeValido) {
      usuario.pontos += a.pontos || 0;
    }
  });

  const ranking = usuarios.filter(u => u.pontos > 0).sort((a, b) => b.pontos - a.pontos).slice(0, 5);
  const premioTotal = 100;
  const percentuais = [0.4, 0.25, 0.15, 0.10, 0.10];

  simulacao = ranking.map((u, i) => ({
    ...u,
    premio: Math.floor(premioTotal * percentuais[i])
  }));

  document.getElementById("valorPremioTotal").innerText = `R$ ${premioTotal}`;
  document.getElementById("tabelaPremios").innerHTML = simulacao.map((u, i) => `
    <tr>
      <td>${i + 1}º</td>
      <td>${u.nome}</td>
      <td>${u.pontos}</td>
      <td>${u.premio}</td>
    </tr>
  `).join("");

  document.getElementById("resultadoPremiacao").style.display = "block";
}

async function confirmarPremiacao() {
  const batch = db.batch();
  const agora = firebase.firestore.Timestamp.fromDate(new Date());

  simulacao.forEach(u => {
    const ref = db.collection("transacoes").doc();
    batch.set(ref, {
      nome: u.nome,
      valor: u.premio,
      tipo: "premio_ranking",
      data: agora
    });
  });

  await batch.commit();
  alert("Premiação registrada com sucesso!");
  location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  carregarTimesEJogos();
  exibirFiltros();
});
