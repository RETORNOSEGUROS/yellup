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
      <td><a href="painel-jogo.html?id=${id}" class="btn btn-primary">Entrar na Partida</a></td>
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
    const inicio = new Date(dataInicio + 'T00:00:00');
    const fim = new Date(dataFim + 'T23:59:59');

    console.log("Filtro entre:", inicio, "e", fim);

    query = query
      .where("dataInicio", ">=", firebase.firestore.Timestamp.fromDate(inicio))
      .where("dataInicio", "<=", firebase.firestore.Timestamp.fromDate(fim));
  }

  if (statusFiltro !== "Todos") {
    query = query.where("status", "==", statusFiltro);
  }

  query.get()
    .then(snapshot => {
      console.log("Jogos encontrados:", snapshot.size);
      renderizarTabela(snapshot);
    })
    .catch(error => {
      console.error("Erro ao buscar jogos:", error);
    });
}

function listarTodos() {
  db.collection("jogos").get().then(renderizarTabela);
}

document.getElementById("btnBuscar").addEventListener("click", buscarJogos);
document.getElementById("btnListarTodos").addEventListener("click", listarTodos);

document.addEventListener("DOMContentLoaded", listarTodos);
