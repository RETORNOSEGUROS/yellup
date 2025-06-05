const db = firebase.firestore();
let listaTransacoes = [];

async function carregarTransacoes() {
  const tabela = document.getElementById("tabelaTransacoes");
  tabela.innerHTML = "";
  listaTransacoes = [];

  const snapshot = await db.collection("transacoes").orderBy("data", "desc").get();

  snapshot.forEach(doc => {
    const d = doc.data();
    listaTransacoes.push({
      nome: d.nome || "Sem nome",
      valor: d.valor || 0,
      tipo: d.tipo || "-",
      data: d.data?.toDate().toLocaleString("pt-BR") || "-"
    });
  });

  exibirTransacoes(listaTransacoes);
}

function exibirTransacoes(lista) {
  const tabela = document.getElementById("tabelaTransacoes");
  tabela.innerHTML = "";

  lista.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.data}</td>
      <td>${t.nome}</td>
      <td>${t.valor >= 0 ? '+' : ''}${t.valor}</td>
      <td>${t.tipo}</td>
    `;
    tabela.appendChild(tr);
  });
}

function filtrarTransacoes() {
  const termo = document.getElementById("filtroNome").value.toLowerCase();
  const filtradas = listaTransacoes.filter(t =>
    t.nome.toLowerCase().includes(termo)
  );
  exibirTransacoes(filtradas);
}

document.getElementById("formTransacao").addEventListener("submit", async (e) => {
  e.preventDefault();

  const nome = document.getElementById("nomeUsuario").value.trim();
  const valor = parseFloat(document.getElementById("valor").value);
  const tipo = document.getElementById("tipo").value.trim();
  const data = new Date();

  if (!nome || isNaN(valor) || !tipo) {
    alert("Preencha todos os campos corretamente.");
    return;
  }

  try {
    await db.collection("transacoes").add({
      nome,
      valor,
      tipo,
      data: firebase.firestore.Timestamp.fromDate(data)
    });

    alert("Transação registrada com sucesso.");
    document.getElementById("formTransacao").reset();
    carregarTransacoes();
  } catch (err) {
    console.error("Erro ao registrar transação:", err);
    alert("Erro ao registrar.");
  }
});

carregarTransacoes();
