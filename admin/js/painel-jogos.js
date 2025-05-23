const db = firebase.firestore();
const tabela = document.getElementById("tabela-jogos");

function formatarData(timestamp) {
  if (!timestamp) return "-";
  const data = timestamp.toDate();
  return data.toLocaleString("pt-BR");
}

async function buscarNomeTime(id) {
  if (!id) return "Desconhecido";
  const doc = await db.collection("times").doc(id).get();
  return doc.exists ? doc.data().nome : "Desconhecido";
}

async function contarTorcedores(jogoId) {
  const snapshot = await db.collection("torcidas").where("jogoId", "==", jogoId).get();
  return snapshot.size;
}

async function somarCreditos(jogoId) {
  const snapshot = await db.collection("apostas").where("jogoId", "==", jogoId).get();
  let total = 0;
  snapshot.forEach(doc => {
    const dados = doc.data();
    if (dados.creditos) total += Number(dados.creditos);
  });
  return total;
}

async function renderizarTabela(snapshot) {
  tabela.innerHTML = "";
  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const id = doc.id;

    const nomeCasa = await buscarNomeTime(jogo.timeCasa);
    const nomeFora = await buscarNomeTime(jogo.timeFora);
    const torcedores = await contarTorcedores(id);
    const creditos = await somarCreditos(id);

    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${nomeCasa}</td>
      <td>${nomeFora}</td>
      <td>${formatarData(jogo.dataInicio)}</td>
      <td>${formatarData(jogo.dataFim)}</td>
      <td>${jogo.status}</td>
      <td>${torcedores}</td>
      <td>${creditos}</td>
      <td><button onclick="location.href='painel-jogo.html?id=${id}'">Entrar na Partida</button></td>
    `;
    tabela.appendChild(linha);
  }
}

function buscarJogos() {
  const dataInicio = document.getElementById("dataInicio").value;
  const dataFim = document.getElementById("dataFim").value;
  const statusFiltro = document.getElementById("statusFiltro").value;

  let query = db.collection("jogos");

  if (dataInicio && dataFim) {
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim);
    fim.setHours(23, 59, 59, 999);
    query = query.where("dataInicio", ">=", inicio).where("dataInicio", "<=", fim);
  }

  if (statusFiltro !== "Todos") {
    query = query.where("status", "==", statusFiltro);
  }

  query = query.orderBy("dataInicio", "desc");
  query.get().then(renderizarTabela);
}

function listarPorPadrao() {
  const query = db.collection("jogos")
    .where("status", "in", ["agendado", "ao_vivo"])
    .orderBy("dataInicio", "desc");

  query.get().then(renderizarTabela);
}

document.addEventListener("DOMContentLoaded", listarPorPadrao);