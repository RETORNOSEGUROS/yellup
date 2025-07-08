
async function carregarRankingClubes(jogoId) {
  const tbody = document.querySelector("#tabelaRankingClubes tbody");
  tbody.innerHTML = "<tr><td colspan='3'>Carregando...</td></tr>";

  try {
    const respostasSnap = await db.collection("respostas").get();
    const clubesPontuacao = {};

    for (const doc of respostasSnap.docs) {
      const r = doc.data();
      if (!doc.id.startsWith(jogoId + "_")) continue;

      const userId = r.usuarioId;
      const usuarioDoc = await db.collection("usuarios").doc(userId).get();
      const clubeId = usuarioDoc.data().clubeId;
      if (!clubeId) continue;

      if (!clubesPontuacao[clubeId]) clubesPontuacao[clubeId] = 0;
      clubesPontuacao[clubeId] += r.pontos || 0;
    }

    const ranking = [];
    for (const clubeId in clubesPontuacao) {
      const clubeDoc = await db.collection("clubes").doc(clubeId).get();
      ranking.push({
        nome: clubeDoc.exists ? clubeDoc.data().nome : "Clube Desconhecido",
        pontos: clubesPontuacao[clubeId]
      });
    }

    ranking.sort((a, b) => b.pontos - a.pontos);
    tbody.innerHTML = "";

    if (ranking.length === 0) {
      tbody.innerHTML = "<tr><td colspan='3'>Nenhum clube pontuou neste jogo ainda.</td></tr>";
      return;
    }

    ranking.forEach((clube, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:8px; border:1px solid #ccc;">${i + 1}</td>
        <td style="padding:8px; border:1px solid #ccc;">${clube.nome}</td>
        <td style="padding:8px; border:1px solid #ccc;">${clube.pontos}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    console.error("Erro ao carregar ranking de clubes:", e);
    tbody.innerHTML = "<tr><td colspan='3'>Erro ao carregar dados.</td></tr>";
  }
}
