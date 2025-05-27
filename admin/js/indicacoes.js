const db = firebase.firestore();

async function carregarIndicacoes() {
  const tabela = document.getElementById("tabelaIndicacoes");
  tabela.innerHTML = "";

  try {
    const snapshot = await db.collection("usuarios").orderBy("dataCadastro", "desc").get();

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.indicadoPor) {
        const nome = data.nome || "Sem nome";
        const email = data.email || "-";
        const indicador = data.indicadoPor;
        const dataFormatada = data.dataCadastro?.toDate().toLocaleString("pt-BR") || "-";

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${nome}</td>
          <td>${email}</td>
          <td>${indicador}</td>
          <td>${dataFormatada}</td>
        `;
        tabela.appendChild(tr);
      }
    });
  } catch (err) {
    console.error("Erro ao carregar indicações:", err);
    tabela.innerHTML = `<tr><td colspan="4">Erro ao carregar indicações.</td></tr>`;
  }
}

carregarIndicacoes();
