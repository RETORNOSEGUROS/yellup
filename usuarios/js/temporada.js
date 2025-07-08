
async function carregarRankingTemporada() {
  const hoje = new Date();
  const anoMes = hoje.toISOString().slice(0, 7); // ex: "2025-07"
  const lista = document.getElementById("rankingTemporada");
  lista.innerHTML = "Carregando...";

  try {
    const snap = await db.collection("temporadas").doc(anoMes).collection("usuarios")
      .orderBy("pontos", "desc").limit(10).get();

    if (snap.empty) {
      lista.innerHTML = "<li>Nenhum ponto registrado nesta temporada.</li>";
      return;
    }

    lista.innerHTML = "";
    snap.forEach(doc => {
      const d = doc.data();
      const li = document.createElement("li");
      li.textContent = `${d.nome}: ${d.pontos} pts`;
      lista.appendChild(li);
    });
  } catch (e) {
    console.error("Erro ao carregar temporada:", e);
    lista.innerHTML = "<li>Erro ao buscar dados da temporada.</li>";
  }
}

// Chamada ao marcar ponto (ex: ao responder corretamente no jogo)
async function registrarPontoTemporada(usuarioId, nome, pontos) {
  const hoje = new Date();
  const anoMes = hoje.toISOString().slice(0, 7); // "2025-07"
  const ref = db.collection("temporadas").doc(anoMes).collection("usuarios").doc(usuarioId);
  const doc = await ref.get();

  if (doc.exists) {
    const dados = doc.data();
    await ref.update({ pontos: (dados.pontos || 0) + pontos });
  } else {
    await ref.set({ nome, pontos: pontos, data: firebase.firestore.Timestamp.now() });
  }
}
