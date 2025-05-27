const db = firebase.firestore();

async function carregarRanking() {
  const rankingBody = document.getElementById("rankingBody");
  rankingBody.innerHTML = "";

  try {
    const snapshot = await db.collection("usuarios").orderBy("pontuacao", "desc").get();

    let posicao = 1;
    snapshot.forEach(doc => {
      const data = doc.data();
      const nome = data.nome || "Sem nome";
      const pontos = data.pontuacao || 0;
      const creditos = data.creditos || 0;
      const time = data.timeCoracao || "Não definido";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${posicao++}</td>
        <td>${nome}</td>
        <td>${pontos}</td>
        <td>${creditos}</td>
        <td>${time}</td>
      `;
      rankingBody.appendChild(tr);
    });
  } catch (error) {
    console.error("Erro ao carregar ranking:", error);
    rankingBody.innerHTML = `<tr><td colspan="5">Erro ao carregar ranking.</td></tr>`;
  }
}

carregarRanking();
