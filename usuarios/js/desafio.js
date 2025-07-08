
async function criarDesafio() {
  const nomeB = document.getElementById("nomeDesafiado").value.trim();
  const aposta = parseInt(document.getElementById("creditosAposta").value);
  const status = document.getElementById("statusDesafio");
  status.textContent = "Verificando...";

  if (!nomeB || aposta < 1) {
    status.textContent = "Preencha os dados corretamente.";
    return;
  }

  try {
    // Buscar jogador B
    const usuariosSnap = await db.collection("usuarios").where("nome", "==", nomeB).limit(1).get();
    if (usuariosSnap.empty) {
      status.textContent = "Usuário não encontrado.";
      return;
    }

    const jogadorBDoc = usuariosSnap.docs[0];
    const jogadorB = { uid: jogadorBDoc.id, ...jogadorBDoc.data() };

    // Buscar jogador A
    const jogadorADoc = await db.collection("usuarios").doc(usuarioId).get();
    const jogadorA = { uid: usuarioId, ...jogadorADoc.data() };

    // Verificar créditos
    if ((jogadorA.creditos || 0) < aposta) {
      status.textContent = "Você não tem créditos suficientes.";
      return;
    }

    // Criar desafio
    const desafioRef = await db.collection("desafios").add({
      jogadorA: { uid: jogadorA.uid, nome: jogadorA.nome, timeId: jogadorA.timeId },
      jogadorB: { uid: jogadorB.uid, nome: jogadorB.nome, timeId: jogadorB.timeId },
      status: "pendente",
      aposta: aposta,
      criadoEm: firebase.firestore.Timestamp.now()
    });

    status.innerHTML = `✅ Desafio criado! Aguarde ${jogadorB.nome} aceitar. ID: ${desafioRef.id}`;
  } catch (e) {
    console.error("Erro ao criar desafio:", e);
    status.textContent = "Erro ao criar desafio.";
  }
}
