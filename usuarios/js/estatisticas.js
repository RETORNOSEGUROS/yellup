
async function carregarEstatisticas(usuarioId) {
  const ul = document.getElementById("estatisticasUsuario");
  ul.innerHTML = "<li>Carregando...</li>";

  try {
    const respostasSnap = await db.collection("respostas")
      .where("usuarioId", "==", usuarioId).get();

    let acertos = 0, erros = 0;
    const jogosSet = new Set();
    const timesContagem = {};

    respostasSnap.forEach(doc => {
      const r = doc.data();
      const jogoId = doc.id.split("_")[0];
      jogosSet.add(jogoId);

      if (r.resposta === r.correta) acertos++;
      else erros++;

      const timeId = r.timeId;
      if (timeId) {
        timesContagem[timeId] = (timesContagem[timeId] || 0) + 1;
      }
    });

    const totalRespostas = acertos + erros;
    const aproveitamento = totalRespostas > 0 ? Math.round((acertos / totalRespostas) * 100) : 0;
    const totalJogos = jogosSet.size;

    // Time mais jogado
    let timeMaisJogado = "N/A";
    let max = 0;
    for (const t in timesContagem) {
      if (timesContagem[t] > max) {
        max = timesContagem[t];
        timeMaisJogado = t;
      }
    }

    if (timeMaisJogado !== "N/A") {
      const timeDoc = await db.collection("times").doc(timeMaisJogado).get();
      if (timeDoc.exists) {
        timeMaisJogado = timeDoc.data().nome;
      }
    }

    // Conquistas
    const conquistasSnap = await db.collection("usuarios").doc(usuarioId)
      .collection("conquistas").get();
    const totalConquistas = conquistasSnap.size;

    ul.innerHTML = `
      <li>✅ Acertos: <strong>${acertos}</strong></li>
      <li>❌ Erros: <strong>${erros}</strong></li>
      <li>⚽ Jogos Participados: <strong>${totalJogos}</strong></li>
      <li>🎯 Aproveitamento: <strong>${aproveitamento}%</strong></li>
      <li>🏆 Conquistas: <strong>${totalConquistas}</strong></li>
      <li>💡 Time mais jogado: <strong>${timeMaisJogado}</strong></li>
    `;
  } catch (e) {
    console.error("Erro ao carregar estatísticas:", e);
    ul.innerHTML = "<li>Erro ao carregar dados.</li>";
  }
}
