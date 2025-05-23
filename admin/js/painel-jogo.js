const db = firebase.firestore();
const tabela = document.getElementById("tabela-jogos");

function formatarData(timestamp) {
  if (!timestamp) return "-";
  const data = timestamp.toDate();
  return data.toLocaleString("pt-BR");
}

async function buscarNomeTime(id) {
  if (!id) return "Desconhecido";
  try {
    const doc = await db.collection("times").doc(id).get();
    return doc.exists ? doc.data().nome : "Desconhecido";
  } catch (e) {
    console.error("Erro ao buscar time:", e);
    return "Desconhecido";
  }
}

async function renderizarTabela(snapshot) {
  tabela.innerHTML = "";

  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const id = doc.id;

    const nomeCasa = await buscarNomeTime(jogo.timeCasa);
    const nomeFora = await buscarNomeTime(jogo.timeFora);

    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${nomeCasa}</td>
      <td>${nomeFora}</td>
      <td>${formatarData(jogo.dataInicio)}</td>
      <td>${formatarData(jogo.dataFim)}</td>
      <td>${jogo.status}</td>
      <td><button onclick="window.location.href='painel-jogo.html?id=${id}'">Entrar na Partida</button></td>
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

  query.get().then(renderizarTabela);
}

function listarTodos() {
  db.collection("jogos").get().then(renderizarTabela);
}

document.addEventListener("DOMContentLoaded", listarTodos);
