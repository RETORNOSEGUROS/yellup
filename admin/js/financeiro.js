const db = firebase.firestore();

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarFinanceiro();
  }
});

function carregarFinanceiro() {
  const tabela = document.getElementById('tabelaFinanceiro');
  tabela.innerHTML = '';

  db.collection("usuarios").get().then(snapshot => {
    snapshot.forEach(doc => {
      const dados = doc.data();
      const linha = document.createElement('tr');

      linha.innerHTML = `
        <td>${dados.nome ?? '-'}</td>
        <td>${dados.email}</td>
        <td>${dados.creditos ?? 0}</td>
        <td>
          <input type="number" id="valor-${doc.id}" placeholder="0">
          <button onclick="adicionarCredito('${doc.id}')">Adicionar</button>
        </td>
      `;
      tabela.appendChild(linha);
    });
  });
}

function adicionarCredito(userId) {
  const input = document.getElementById(`valor-${userId}`);
  const valor = parseInt(input.value);

  if (isNaN(valor) || valor <= 0) {
    alert("Informe um valor válido.");
    return;
  }

  const usuarioRef = db.collection("usuarios").doc(userId);

  db.runTransaction(async (t) => {
    const doc = await t.get(usuarioRef);
    const atual = doc.data().creditos || 0;
    const novoTotal = atual + valor;

    t.update(usuarioRef, { creditos: novoTotal });

    db.collection("transacoes").add({
      userId,
      tipo: "crédito manual",
      valor,
      data: new Date().toISOString()
    });
  }).then(() => {
    alert("Créditos adicionados com sucesso!");
    carregarFinanceiro();
  });
}
