const db = firebase.firestore();
let mapaTimes = {};

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarTimes();
  }
});

function carregarTimes() {
  db.collection("times").get().then(snapshot => {
    snapshot.forEach(doc => {
      mapaTimes[doc.id] = doc.data().nome;
    });
  });
}

function formatarData(data) {
  const d = data instanceof Date ? data : new Date(data?.toDate?.() || data);
  return d.toLocaleString();
}

function buscarJogos() {
  const inicio = document.getElementById("filtroDataInicio").value;
  const fim = document.getElementById("filtroDataFim").value;
  const status = document.getElementById("filtroStatus").value;
  let ref = db.collection("jogos");

  if (status !== "todos") {
    ref = ref.where("status", "==", status);
  }

  ref.get().then(snapshot => {
    const tabela = document.getElementById("tabelaJogos");
    tabela.innerHTML = "";

    snapshot.forEach(doc => {
      const j = doc.data();
      const id = doc.id;

      const dataJogo = j.dataInicio instanceof Date
        ? j.dataInicio
        : new Date(j.dataInicio?.toDate?.() || j.dataInicio);

      const inicioFiltro = inicio ? new Date(inicio + 'T00:00') : null;
      const fimFiltro = fim ? new Date(fim + 'T23:59') : null;

      const dentroDoPeriodo =
        (!inicioFiltro || dataJogo >= inicioFiltro) &&
        (!fimFiltro || dataJogo <= fimFiltro);

      if (!dentroDoPeriodo) return;

      const linha = document.createElement("tr");
      linha.innerHTML = `
        <td>${mapaTimes[j.timeCasa] ?? j.timeCasa}</td>
        <td>${mapaTimes[j.timeFora] ?? j.timeFora}</td>
        <td>${formatarData(j.dataInicio)}</td>
        <td>${formatarData(j.dataFim)}</td>
        <td>${j.status}</td>
        <td>
          <a href="/admin/painel-jogo.html?id=${id}" target="_blank">
            <button>Entrar na Partida</button>
          </a>
        </td>
      `;
      tabela.appendChild(linha);
    });
  });
}

function listarTodosJogos() {
  const tabela = document.getElementById("tabelaJogos");
  tabela.innerHTML = "";

  db.collection("jogos").orderBy("dataInicio").get().then(snapshot => {
    snapshot.forEach(doc => {
      const j = doc.data();
      const id = doc.id;

      const linha = document.createElement("tr");
      linha.innerHTML = `
        <td>${mapaTimes[j.timeCasa] ?? j.timeCasa}</td>
        <td>${mapaTimes[j.timeFora] ?? j.timeFora}</td>
        <td>${formatarData(j.dataInicio)}</td>
        <td>${formatarData(j.dataFim)}</td>
        <td>${j.status}</td>
        <td>
          <a href="/admin/painel-jogo.html?id=${id}" target="_blank">
            <button>Entrar na Partida</button>
          </a>
        </td>
      `;
      tabela.appendChild(linha);
    });
  });
}
