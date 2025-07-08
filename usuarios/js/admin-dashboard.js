
async function carregarDashboardAdmin() {
  const div = document.getElementById("indicadores");
  const lista = document.getElementById("listaTopCreditos");
  div.innerHTML = "<p>Carregando indicadores...</p>";

  try {
    const usuariosSnap = await db.collection("usuarios").get();
    const jogosSnap = await db.collection("jogos").get();

    let totalUsuarios = 0, totalCreditos = 0;
    const ranking = [];

    usuariosSnap.forEach(doc => {
      const d = doc.data();
      totalUsuarios++;
      const c = d.creditos || 0;
      totalCreditos += c;
      ranking.push({ nome: d.nome, creditos: c });
    });

    const totalJogos = jogosSnap.size;

    // Extratos (ganhos e gastos)
    let totalEntrada = 0, totalSaida = 0;
    for (const doc of usuariosSnap.docs) {
      const extratoSnap = await db.collection("usuarios").doc(doc.id).collection("extrato").get();
      extratoSnap.forEach(e => {
        const mov = e.data();
        if (mov.tipo === "entrada") totalEntrada += mov.valor || 0;
        if (mov.tipo === "saida") totalSaida += mov.valor || 0;
      });
    }

    div.innerHTML = `
      <div><strong>👥 Usuários:</strong> ${totalUsuarios}</div>
      <div><strong>🎮 Jogos:</strong> ${totalJogos}</div>
      <div><strong>💰 Créditos em circulação:</strong> ${totalCreditos}</div>
      <div><strong>📥 Créditos ganhos:</strong> ${totalEntrada}</div>
      <div><strong>📤 Créditos gastos:</strong> ${totalSaida}</div>
    `;

    ranking.sort((a, b) => b.creditos - a.creditos);
    lista.innerHTML = ranking.slice(0, 10).map(u => `<li>${u.nome}: ${u.creditos} créditos</li>`).join("");

  } catch (e) {
    console.error("Erro ao carregar painel admin:", e);
    div.innerHTML = "<p>Erro ao carregar dados.</p>";
  }
}
