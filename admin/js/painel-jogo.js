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
      const dataJogo = new Date(j.dataInicio);

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
        <td>${new Date(j.dataInicio).toLocaleString()}</td>
        <td>${new Date(j.dataFim).toLocaleString()}</td>
        <td>${j.status}</td>
        <td><a href="/admin/painel-jogo.html?id=${doc.id}" target="_blank">Ver Painel</a></td>
      `;
      tabela.appendChild(linha);
    });
  });
}
