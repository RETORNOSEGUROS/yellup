
async function carregarRelatorioFinal(jogoId) {
  const resumo = document.getElementById("resumoRelatorio");
  resumo.innerHTML = "<p>🔄 Processando...</p>";

  try {
    // Buscar dados do jogo e times
    const jogoDoc = await db.collection("jogos").doc(jogoId).get();
    const jogo = jogoDoc.data();
    const casaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
    const foraDoc = await db.collection("times").doc(jogo.timeForaId).get();
    const nomeA = casaDoc.data().nome;
    const nomeB = foraDoc.data().nome;

    // Pontuação por time
    const respostasSnap = await db.collection("respostas").get();
    let pontosA = 0, pontosB = 0;
    let totalPerguntas = 0, totalAcertos = 0;

    const ranking = {};

    respostasSnap.forEach(doc => {
      const r = doc.data();
      if (!doc.id.startsWith(jogoId + "_")) return;
      totalPerguntas++;

      const pontos = r.pontos || 0;
      if (r.resposta === r.correta) totalAcertos++;

      if (r.timeId === jogo.timeCasaId) pontosA += pontos;
      else if (r.timeId === jogo.timeForaId) pontosB += pontos;

      if (!ranking[r.usuarioId]) {
        ranking[r.usuarioId] = { nome: r.nome, pontos: 0 };
      }
      ranking[r.usuarioId].pontos += pontos;
    });

    const listaRanking = Object.entries(ranking)
      .map(([id, obj]) => ({ ...obj }))
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 10);

    // Torcida por time
    const torcidaSnap = await db.collection("torcidas").doc(jogoId).collection("torcedores").get();
    let totalTorcedores = 0, torcedoresA = 0, torcedoresB = 0;
    torcidaSnap.forEach(doc => {
      totalTorcedores++;
      const t = doc.data().timeId;
      if (t === jogo.timeCasaId) torcedoresA++;
      else if (t === jogo.timeForaId) torcedoresB++;
    });

    const acertosPercent = totalPerguntas > 0 ? Math.round((totalAcertos / totalPerguntas) * 100) : 0;
    const percA = totalTorcedores > 0 ? Math.round((torcedoresA / totalTorcedores) * 100) : 0;
    const percB = totalTorcedores > 0 ? Math.round((torcedoresB / totalTorcedores) * 100) : 0;

    resumo.innerHTML = `
      <h4>${nomeA} x ${nomeB}</h4>
      <p><strong>🎯 Acertos totais:</strong> ${totalAcertos} de ${totalPerguntas} (${acertosPercent}%)</p>
      <p><strong>📣 Torcida:</strong> ${torcedoresA} (${percA}%) torcem por ${nomeA}, ${torcedoresB} (${percB}%) por ${nomeB}</p>
      <p><strong>💪 Pontuação final:</strong> ${nomeA} ${pontosA} x ${pontosB} ${nomeB}</p>
      <h4>🏅 Top 10 Usuários</h4>
      <ol>
        ${listaRanking.map(u => `<li>${u.nome}: ${u.pontos} pts</li>`).join("")}
      </ol>
    `;
  } catch (e) {
    console.error("Erro ao carregar relatório:", e);
    resumo.innerHTML = "<p>Erro ao carregar dados da partida.</p>";
  }
}
