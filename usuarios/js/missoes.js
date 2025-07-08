
const missoesPadrao = [
  { id: "responder_3", titulo: "Responda 3 perguntas hoje", total: 3, recompensa: { xp: 10, creditos: 5 } },
  { id: "torcer_1", titulo: "Torça para 1 time hoje", total: 1, recompensa: { xp: 5, creditos: 2 } },
  { id: "convidar_1", titulo: "Convide 1 amigo hoje", total: 1, recompensa: { xp: 15, creditos: 10 } }
];

async function carregarMissoes(usuarioId) {
  const lista = document.getElementById("listaMissoes");
  lista.innerHTML = "Carregando...";

  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const snap = await db.collection("usuarios").doc(usuarioId).collection("missoes").get();
    const jaTem = {};
    snap.forEach(doc => jaTem[doc.id] = doc.data());

    for (const m of missoesPadrao) {
      const missaoAtual = jaTem[m.id];
      const precisaCriar = !missaoAtual || (missaoAtual.data && missaoAtual.data.toDate() < hoje);

      if (precisaCriar) {
        await db.collection("usuarios").doc(usuarioId).collection("missoes").doc(m.id).set({
          ...m,
          atual: 0,
          concluido: false,
          data: firebase.firestore.Timestamp.now()
        });
      }
    }

    const novaSnap = await db.collection("usuarios").doc(usuarioId).collection("missoes").get();
    lista.innerHTML = "";
    novaSnap.forEach(doc => {
      const m = doc.data();
      const progresso = `${m.atual}/${m.total}`;
      const icone = m.concluido ? "✅" : "🔄";
      const li = document.createElement("li");
      li.innerHTML = `${icone} <strong>${m.titulo}</strong> – ${progresso}`;
      lista.appendChild(li);
    });

  } catch (e) {
    console.error("Erro ao carregar missões:", e);
    lista.innerHTML = "<li>Erro ao carregar missões.</li>";
  }
}

async function atualizarMissao(usuarioId, idMissao) {
  const ref = db.collection("usuarios").doc(usuarioId).collection("missoes").doc(idMissao);
  const doc = await ref.get();
  if (!doc.exists) return;

  const dados = doc.data();
  if (dados.concluido) return;

  const novo = (dados.atual || 0) + 1;
  const concluido = novo >= dados.total;
  await ref.update({ atual: novo, concluido });

  if (concluido) {
    const userRef = db.collection("usuarios").doc(usuarioId);
    const userDoc = await userRef.get();
    const creditos = userDoc.data().creditos || 0;
    await userRef.update({ creditos: creditos + dados.recompensa.creditos });
    await adicionarXP(usuarioId, dados.recompensa.xp);

    await userRef.collection("extrato").add({
      tipo: "entrada",
      valor: dados.recompensa.creditos,
      descricao: `Missão: ${dados.titulo}`,
      data: firebase.firestore.Timestamp.now()
    });
  }
}
