const db = firebase.firestore();

document.getElementById("formCredito").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome = document.getElementById("nomeUsuario").value.trim();
  const valor = parseInt(document.getElementById("valorCredito").value);
  const pagamento = document.getElementById("formaPagamento").value.trim();
  const data = new Date();

  if (!nome || !valor) {
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  try {
    await db.collection("creditos").add({
      nomeUsuario: nome,
      valorCredito: valor,
      formaPagamento: pagamento,
      dataRegistro: firebase.firestore.Timestamp.fromDate(data)
    });

    document.getElementById("formCredito").reset();
    carregarCreditos();
  } catch (err) {
    console.error("Erro ao registrar crédito:", err);
  }
});

async function carregarCreditos() {
  const tabela = document.getElementById("tabelaCreditos");
  tabela.innerHTML = "";

  const snapshot = await db.collection("creditos").orderBy("dataRegistro", "desc").get();

  snapshot.forEach(doc => {
    const data = doc.data();
    const dataFormatada = data.dataRegistro.toDate().toLocaleString("pt-BR");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${dataFormatada}</td>
      <td>${data.nomeUsuario}</td>
      <td>${data.valorCredito}</td>
      <td>${data.formaPagamento}</td>
    `;
    tabela.appendChild(tr);
  });
}

carregarCreditos();
