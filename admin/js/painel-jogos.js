const db = firebase.firestore();
const tabela = document.getElementById("tabela-jogos");

function formatarData(timestamp) {
  if (!timestamp || !timestamp.toDate) return "-";
  const data = timestamp.toDate();
  return data.toLocaleString("pt-BR");
}

async function buscarNomeTime(id) {
  if (!id) return "Desconhecido";
  const doc = await db.collection("times").doc(id).get();
  return doc.exists ? doc.data().nome : "Desconhecido";
}

async function calcularStats(jogoId) {
  const torcidasSnap = await db.collection("torcidas").where("jogoId", "==", jogoId).get();
  const totalTorcedores = torcidasSnap.size;
  let creditosTotal = 0;
  torcidasSnap.forEach(doc => {
    const data = doc.data();
    creditosTotal += data.creditosGastos || 0;
  });
  return { totalTorcedores, creditosTotal };
}

async function renderizarTabela(snapshot) {
  tabela.innerHTML = "";
  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const id = doc.id;

    const nomeCasa = await buscarNomeTime(jogo.timeCasa);
    const nomeFora = await buscarNomeTime(jogo.timeFora);
    const stats = await calcularStats(id);

    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${nomeCasa}</td>
      <td>${nomeFora}</td>
      <td>${formatarData(jogo.dataInicio)}</td>
      <td>${formatarData(jogo.dataFim)}</td>
      <td>${jogo.status}</td>
      <td>
        <button class="btn" onclick="entrarPartida('${id}')">Entrar</button>
        <button class="btn" onclick="verRelatorio('${id}')">Relatório</button>
      </td>
      <td>${stats.totalTorcedores}</td>
      <td>R$ ${stats.creditosTotal.toFixed(2)}</td>
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

function entrarPartida(jogoId) {
  window.location.href = `painel-jogo.html?id=${jogoId}`;
}

function verRelatorio(jogoId) {
  window.location.href = `relatorio-jogo.html?id=${jogoId}`;
}

document.addEventListener("DOMContentLoaded", listarTodos);
document.getElementById("btnBuscar").addEventListener("click", buscarJogos);
document.getElementById("btnListarTodos").addEventListener("click", listarTodos);
