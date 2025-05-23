document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("listarTodos").addEventListener("click", listarTodosJogos);
  document.getElementById("buscar").addEventListener("click", buscarJogos);
  listarTodosJogos();
});

const db = firebase.firestore();

function listarTodosJogos() {
  db.collection("jogos").get().then(snapshot => {
    const jogos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    exibirJogos(jogos);
  });
}

function buscarJogos() {
  const dataInicio = document.getElementById("dataInicio").value;
  const dataFim = document.getElementById("dataFim").value;
  const status = document.getElementById("statusFiltro").value;

  let query = db.collection("jogos");

  if (dataInicio && dataFim) {
    const inicio = new Date(dataInicio + 'T00:00:00');
    const fim = new Date(dataFim + 'T23:59:59');
    query = query.where("dataInicio", ">=", inicio).where("dataInicio", "<=", fim);
  }

  if (status !== "todos") {
    query = query.where("status", "==", status);
  }

  query.get().then(snapshot => {
    const jogos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    exibirJogos(jogos);
  });
}

function exibirJogos(jogos) {
  const corpoTabela = document.querySelector("#tabelaJogos tbody");
  corpoTabela.innerHTML = "";

  jogos.forEach(jogo => {
    const tr = document.createElement("tr");

    const timeCasa = jogo.timeCasaNome || "Desconhecido";
    const timeFora = jogo.timeForaNome || "Desconhecido";
    const inicio = jogo.dataInicio?.toDate?.().toLocaleString("pt-BR") || "-";
    const fim = jogo.dataFim?.toDate?.().toLocaleString("pt-BR") || "-";

    tr.innerHTML = `
      <td>${timeCasa}</td>
      <td>${timeFora}</td>
      <td>${inicio}</td>
      <td>${fim}</td>
      <td>${jogo.status}</td>
      <td><button onclick="entrarNaPartida('${jogo.id}')">Entrar na Partida</button></td>
    `;
    corpoTabela.appendChild(tr);
  });
}

function entrarNaPartida(id) {
  window.location.href = `painel-jogo.html?id=${id}`;
}
