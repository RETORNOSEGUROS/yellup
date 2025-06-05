const db = firebase.firestore();
let listaCreditos = [];

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
  listaCreditos = [];

  const snapshot = await db.collection("creditos").orderBy("dataRegistro", "desc").get();

  snapshot.forEach(doc => {
    const data = doc.data();
    listaCreditos.push({
      nome: data.nomeUsuario || "-",
      valor: data.valorCredito || 0,
      forma: data.formaPagamento || "-",
      data: data.dataRegistro.toDate().toLocaleString("pt-BR")
    });
  });

  exibirCreditos(listaCreditos);
}

function exibirCreditos(lista) {
  const tabela = document.getElementById("tabelaCreditos");
  tabela.innerHTML = "";
  lista.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.data}</td>
      <td>${c.nome}</td>
      <td>${c.valor}</td>
      <td>${c.forma}</td>
    `;
    tabela.appendChild(tr);
  });
}

function filtrarCreditos() {
  const termo = document.getElementById("filtroCredito").value.toLowerCase();
  const filtrados = listaCreditos.filter(c => c.nome.toLowerCase().includes(termo));
  exibirCreditos(filtrados);
}

carregarCreditos();
