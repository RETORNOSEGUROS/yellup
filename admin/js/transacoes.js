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

carregarTransacoes();
