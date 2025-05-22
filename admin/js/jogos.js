const db = firebase.firestore();

firebase.auth().onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarJogos();
  }
});

function cadastrarJogo() {
  const timeCasa = document.getElementById('timeCasa').value;
  const timeFora = document.getElementById('timeFora').value;
  const dataInicio = document.getElementById('dataInicio').value;
  const dataFim = document.getElementById('dataFim').value;
  const status = document.getElementById('statusJogo').value;

  if (!timeCasa || !timeFora || !dataInicio || !dataFim) {
    alert("Preencha todos os campos.");
    return;
  }

  db.collection("jogos").add({
    timeCasa,
    timeFora,
    dataInicio,
    dataFim,
    status
  }).then(() => {
    alert("Jogo cadastrado!");
    document.getElementById('timeCasa').value = '';
    document.getElementById('timeFora').value = '';
    document.getElementById('dataInicio').value = '';
    document.getElementById('dataFim').value = '';
    document.getElementById('statusJogo').value = 'agendado';
    carregarJogos();
  });
}

function carregarJogos() {
  const tabela = document.getElementById('tabelaJogos');
  tabela.innerHTML = '';

  db.collection("jogos").orderBy("dataInicio").get().then(snapshot => {
    snapshot.forEach(doc => {
      const jogo = doc.data();
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${jogo.timeCasa}</td>
        <td>${jogo.timeFora}</td>
        <td>${new Date(jogo.dataInicio).toLocaleString()}</td>
        <td>${new Date(jogo.dataFim).toLocaleString()}</td>
        <td>${jogo.status}</td>
      `;
      tabela.appendChild(linha);
    });
  });
}
