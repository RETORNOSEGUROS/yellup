const db = firebase.firestore();

async function gerarRelatorio() {
  const dataInicio = document.getElementById("dataInicio").value;
  const dataFim = document.getElementById("dataFim").value;

  if (!dataInicio || !dataFim) {
    alert("Preencha as datas para gerar o relatório.");
    return;
  }

  const inicio = new Date(dataInicio + "T00:00:00");
  const fim = new Date(dataFim + "T23:59:59");

  const transacoesSnap = await db.collection("transacoes")
    .where("data", ">=", inicio)
    .where("data", "<=", fim)
    .get();

  let totalCreditos = 0;
  const pagamentosPorUsuario = {};

  transacoesSnap.forEach(doc => {
    const trans = doc.data();
    const userId = trans.userId;
    const creditos = trans.creditos || 0;
    const data = trans.data.toDate();

    totalCreditos += creditos;

    if (!pagamentosPorUsuario[userId]) {
      pagamentosPorUsuario[userId] = { total: 0, ultima: data };
    }

    pagamentosPorUsuario[userId].total += creditos;
    if (data > pagamentosPorUsuario[userId].ultima) {
      pagamentosPorUsuario[userId].ultima = data;
    }
  });

  exibirResumo(totalCreditos, Object.keys(pagamentosPorUsuario).length);
  exibirTabela(pagamentosPorUsuario);
}

function exibirResumo(totalCreditos, totalUsuarios) {
  const resumoDiv = document.getElementById("resumo");
  resumoDiv.innerHTML = `
    <h3>Resumo do Período</h3>
    <p><strong>Total de Créditos Pagos:</strong> ${totalCreditos}</p>
    <p><strong>Total de Usuários Premiados:</strong> ${totalUsuarios}</p>
  `;
}

async function exibirTabela(pagamentosPorUsuario) {
  const tbody = document.getElementById("tabelaFinanceiro");
  tbody.innerHTML = "";

  for (const userId in pagamentosPorUsuario) {
    const userDoc = await db.collection("usuarios").doc(userId).get();
    const nome = userDoc.exists ? (userDoc.data().nome || userId) : userId;
    const { total, ultima } = pagamentosPorUsuario[userId];

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${nome}</td>
      <td>${total}</td>
      <td>${ultima.toLocaleString("pt-BR")}</td>
    `;
    tbody.appendChild(tr);
  }
}