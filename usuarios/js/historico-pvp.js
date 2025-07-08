
async function carregarHistoricoPvP(usuarioId) {
  const resumo = document.getElementById("resumoPvP");
  const lista = document.getElementById("listaPvP");

  try {
    const snap = await db.collection("desafios")
      .where("status", "==", "finalizado").get();

    let vitorias = 0, derrotas = 0, total = 0;
    const historico = [];

    snap.forEach(doc => {
      const d = doc.data();
      if (d.jogadorA.uid !== usuarioId && d.jogadorB.uid !== usuarioId) return;

      total++;
      const venceu = d.vencedor === usuarioId;
      if (venceu) vitorias++; else derrotas++;

      const adversario = (d.jogadorA.uid === usuarioId) ? d.jogadorB.nome : d.jogadorA.nome;
      const resultado = venceu ? "✅ Venceu" : "❌ Perdeu";
      const dataStr = d.finalizadoEm?.toDate().toLocaleDateString("pt-BR") || "";

      historico.push(`${resultado} contra <strong>${adversario}</strong> (${dataStr})`);
    });

    resumo.innerHTML = `Total: ${total} | ✅ Vitórias: ${vitorias} | ❌ Derrotas: ${derrotas}`;
    lista.innerHTML = historico.slice(0, 10).map(txt => `<li>${txt}</li>`).join("");

  } catch (e) {
    console.error("Erro ao carregar histórico PvP:", e);
    resumo.innerHTML = "Erro ao carregar dados.";
  }
}
