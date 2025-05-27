const db = firebase.firestore();
let listaIndicacoes = [];

async function carregarIndicacoes() {
  const tabela = document.getElementById("tabelaIndicacoes");
  tabela.innerHTML = "";
  listaIndicacoes = [];

  try {
    const snapshot = await db.collection("usuarios").orderBy("dataCadastro", "desc").get();

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.indicadoPor) {
        listaIndicacoes.push({
          nome: data.nome || "Sem nome",
          email: data.email || "-",
          indicador: data.indicadoPor,
          dataCadastro: data.dataCadastro?.toDate().toLocaleString("pt-BR") || "-"
        });
      }
    });

    exibirIndicacoes(listaIndicacoes);
  } catch (err) {
    console.error("Erro ao carregar indicações:", err);
    tabela.innerHTML = `<tr><td colspan="4">Erro ao carregar indicações.</td></tr>`;
  }
}

function exibirIndicacoes(lista) {
  const tabela = document.getElementById("tabelaIndicacoes");
  tabela.innerHTML = "";
  lista.forEach(user => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${user.nome}</td>
      <td>${user.email}</td>
      <td>${user.indicador}</td>
      <td>${user.dataCadastro}</td>
    `;
    tabela.appendChild(tr);
  });
}

function filtrarIndicacoes() {
  const termo = document.getElementById("filtroIndicacao").value.toLowerCase();
  const filtrados = listaIndicacoes.filter(u =>
    u.nome.toLowerCase().includes(termo) ||
    u.indicador.toLowerCase().includes(termo)
  );
  exibirIndicacoes(filtrados);
}

carregarIndicacoes();
