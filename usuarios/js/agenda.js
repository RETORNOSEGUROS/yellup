
async function carregarAgenda(usuarioId) {
  const lista = document.getElementById("listaAgenda");
  lista.innerHTML = "<li>Carregando...</li>";

  try {
    const agora = new Date();
    const snap = await db.collection("jogos")
      .where("dataInicio", ">", agora)
      .orderBy("dataInicio")
      .limit(10)
      .get();

    if (snap.empty) {
      lista.innerHTML = "<li>Nenhum jogo futuro encontrado.</li>";
      return;
    }

    lista.innerHTML = "";

    for (const doc of snap.docs) {
      const jogo = doc.data();
      const jogoId = doc.id;

      const torcidaDoc = await db.collection("torcidas").doc(jogoId)
        .collection("torcedores").doc(usuarioId).get();

      if (torcidaDoc.exists) continue; // já torceu

      const timeA = await db.collection("times").doc(jogo.timeCasaId).get();
      const timeB = await db.collection("times").doc(jogo.timeForaId).get();

      const nomeA = timeA.exists ? timeA.data().nome : "Time A";
      const nomeB = timeB.exists ? timeB.data().nome : "Time B";

      const dataStr = jogo.dataInicio.toDate().toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      });

      const li = document.createElement("li");
      li.innerHTML = `
        <strong>${nomeA} x ${nomeB}</strong> – ${dataStr}
        <br>
        <a href="painel-jogo.html?id=${jogoId}" style="color:blue;">👉 Torcer</a>
      `;
      lista.appendChild(li);
    }

    if (lista.innerHTML.trim() === "") {
      lista.innerHTML = "<li>Você já está torcendo em todos os jogos futuros!</li>";
    }

  } catch (e) {
    console.error("Erro ao carregar agenda:", e);
    lista.innerHTML = "<li>Erro ao carregar jogos.</li>";
  }
}
