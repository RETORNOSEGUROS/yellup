
async function carregarRankingGeral() {
  const tbody = document.querySelector("#tabelaRankingGeral tbody");
  tbody.innerHTML = "<tr><td colspan='3'>Carregando...</td></tr>";

  try {
    const snap = await db.collection("respostas").get();
    const mapa = {};

    snap.forEach(doc => {
      const r = doc.data();
      const uid = r.usuarioId;
      if (!mapa[uid]) {
        mapa[uid] = { nome: r.nome || "Usuário", pontos: 0 };
      }
      mapa[uid].pontos += r.pontos || 0;
    });

    const lista = Object.entries(mapa)
      .map(([uid, val]) => ({ uid, ...val }))
      .sort((a, b) => b.pontos - a.pontos);

    tbody.innerHTML = "";

    lista.forEach((u, i) => {
      const medalha = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:8px; border:1px solid #ccc;">${medalha}</td>
        <td style="padding:8px; border:1px solid #ccc;">${u.nome}</td>
        <td style="padding:8px; border:1px solid #ccc;">${u.pontos}</td>
      `;
      tbody.appendChild(tr);
    });

    if (lista.length === 0) {
      tbody.innerHTML = "<tr><td colspan='3'>Nenhuma pontuação registrada ainda.</td></tr>";
    }

  } catch (e) {
    console.error("Erro ao carregar ranking geral:", e);
    tbody.innerHTML = "<tr><td colspan='3'>Erro ao carregar dados.</td></tr>";
  }
}
