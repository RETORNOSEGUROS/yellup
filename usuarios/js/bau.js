
async function abrirBauDiario() {
  const resultado = document.getElementById("resultadoBau");
  resultado.innerHTML = "Verificando...";

  try {
    const ref = db.collection("usuarios").doc(usuarioId).collection("bau_diario").doc("registro");
    const doc = await ref.get();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (doc.exists) {
      const ultima = doc.data().dataUltimoAcesso?.toDate();
      if (ultima && ultima >= hoje) {
        resultado.innerHTML = "⛔ Você já abriu o baú hoje. Volte amanhã!";
        return;
      }
    }

    // Sorteio de recompensa
    const opcoes = [
      { tipo: "xp", valor: 5, texto: "🎉 Você ganhou +5 XP!" },
      { tipo: "xp", valor: 10, texto: "🔥 Você ganhou +10 XP!" },
      { tipo: "creditos", valor: 3, texto: "💰 Você ganhou 3 créditos!" },
      { tipo: "creditos", valor: 5, texto: "🪙 Você ganhou 5 créditos!" }
    ];
    const sorteado = opcoes[Math.floor(Math.random() * opcoes.length)];

    // Atualiza usuário
    const userRef = db.collection("usuarios").doc(usuarioId);
    const userDoc = await userRef.get();
    const dados = userDoc.data();

    if (sorteado.tipo === "xp") {
      await adicionarXP(usuarioId, sorteado.valor);
    } else if (sorteado.tipo === "creditos") {
      const novos = (dados.creditos || 0) + sorteado.valor;
      await userRef.update({ creditos: novos });

      await userRef.collection("extrato").add({
        tipo: "entrada",
        valor: sorteado.valor,
        descricao: "Baú Diário",
        data: firebase.firestore.Timestamp.now()
      });
    }

    // Salva acesso
    await ref.set({
      dataUltimoAcesso: firebase.firestore.Timestamp.now(),
      ultimaRecompensa: sorteado
    });

    resultado.innerHTML = `<p>${sorteado.texto}</p>`;

  } catch (e) {
    console.error("Erro ao abrir baú:", e);
    resultado.innerHTML = "Erro ao abrir baú.";
  }
}
