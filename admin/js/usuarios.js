const db = firebase.firestore();

firebase.auth().onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarUsuarios();
  }
});

function carregarUsuarios() {
  const tabela = document.getElementById('tabelaUsuarios');
  tabela.innerHTML = '';

  db.collection('usuarios').get().then(snapshot => {
    snapshot.forEach(doc => {
      const dados = doc.data();
      const linha = document.createElement('tr');

      linha.innerHTML = `
        <td>${dados.nome || '-'}</td>
        <td>${dados.email}</td>
        <td>${dados.creditos ?? 0}</td>
        <td>${dados.status ?? 'ativo'}</td>
        <td>
          <button onclick="alterarStatus('${doc.id}', '${dados.status}')">
            ${dados.status === 'inativo' ? 'Ativar' : 'Bloquear'}
          </button>
        </td>
      `;

      tabela.appendChild(linha);
    });
  });
}

function alterarStatus(uid, statusAtual) {
  const novoStatus = statusAtual === 'ativo' ? 'inativo' : 'ativo';
  firebase.firestore().collection('usuarios').doc(uid).update({
    status: novoStatus
  }).then(() => {
    alert('Status atualizado!');
    carregarUsuarios();
  });
}
