function listarTodos() {
  gerarRanking(null, null);
}

function buscarRanking() {
  const dataInicio = document.getElementById("dataInicio").value;
  const dataFim = document.getElementById("dataFim").value;

  if (!dataInicio || !dataFim) {
    alert("Selecione o período completo.");
    return;
  }

  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  fim.setHours(23, 59, 59, 999);

  gerarRanking(inicio, fim);
}

function gerarRanking(inicio, fim) {
  let query = db.collection("respostas");

  if (inicio && fim) {
    query = query.where("data", ">=", inicio).where("data", "<=", fim);
  }

  query.get().then(snapshot => {
    const ranking = {};

    snapshot.forEach(doc => {
      const { userId, pontos } = doc.data();
      if (!ranking[userId]) ranking[userId] = 0;
      ranking[userId] += pontos;
    });

    exibirRanking(ranking);
  });
}

function exibirRanking(ranking) {
  const tabela = document.getElementById("tabelaRanking");
  tabela.innerHTML = "";

  Object.entries(ranking)
    .sort((a, b) => b[1] - a[1])
    .forEach(([user, pontos]) => {
      const linha = document.createElement("tr");
      linha.innerHTML = `<td>${user}</td><td>${pontos}</td>`;
      tabela.appendChild(linha);
    });
}

document.addEventListener("DOMContentLoaded", listarTodos);
