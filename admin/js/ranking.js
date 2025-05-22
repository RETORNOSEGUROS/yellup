const db = firebase.firestore();

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarRanking();
  }
});

function carregarRanking() {
  const tabela = document.getElementById('tabelaRanking');
  tabela.innerHTML = '';

  db.collection("usuarios")
    .orderBy("pontuacao", "desc")
    .get()
    .then(snapshot => {
      let pos = 1;
      snapshot.forEach(doc => {
        const dados = doc.data();
        const linha = document.createElement('tr');
        linha.innerHTML = `
          <td>${pos++}</td>
          <td>${dados.nome ?? '-'}</td>
          <td>${dados.email}</td>
          <td>${dados.creditos ?? 0}</td>
          <td>${dados.pontuacao ?? 0}</td>
        `;
        tabela.appendChild(linha);
      });
    });
}
