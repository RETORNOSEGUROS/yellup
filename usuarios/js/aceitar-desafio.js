
let desafioAtual = null;
let perguntasDesafio = [];
let rodada = 0;
let pontos = 0;

async function carregarDesafioPorId(id) {
  const info = document.getElementById("infoDesafio");
  const jogo = document.getElementById("jogoDesafio");

  try {
    const doc = await db.collection("desafios").doc(id).get();
    if (!doc.exists) {
      info.innerHTML = "❌ Desafio não encontrado.";
      return;
    }

    desafioAtual = { id, ...doc.data() };
    const { jogadorA, jogadorB, status, aposta } = desafioAtual;

    if (jogadorB.uid !== usuarioId) {
      info.innerHTML = "❌ Você não é o desafiado.";
      return;
    }

    if (status === "finalizado") {
      info.innerHTML = "⚠️ Este desafio já foi finalizado.";
      return;
    }

    if (status === "pendente") {
      info.innerHTML = `<p>💰 Desafio de <strong>${jogadorA.nome}</strong> para você<br>
        Apostando <strong>${aposta} créditos</strong>.<br>
        <button onclick="aceitarDesafio()">✅ Aceitar desafio</button></p>`;
    } else if (status === "aceito") {
      iniciarRodada();
    }
  } catch (e) {
    console.error("Erro ao carregar desafio:", e);
    info.innerHTML = "Erro ao carregar desafio.";
  }
}

async function aceitarDesafio() {
  const ref = db.collection("desafios").doc(desafioAtual.id);
  await ref.update({ status: "aceito" });

  // Carregar perguntas
  const snap = await db.collection("perguntas").where("timeId", "==", desafioAtual.jogadorB.timeId).limit(3).get();
  perguntasDesafio = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  iniciarRodada();
}

function iniciarRodada() {
  const jogo = document.getElementById("jogoDesafio");
  if (rodada >= perguntasDesafio.length) return finalizarDesafio();

  const p = perguntasDesafio[rodada];
  let html = `<h4>Pergunta ${rodada + 1}: ${p.texto}</h4>`;
  ["A", "B", "C", "D"].forEach(letra => {
    html += `<button onclick="responderDesafio('${letra}', '${p.correta}', ${p.pontuacao})">${letra}) ${p[letra]}</button><br>`;
  });

  jogo.innerHTML = html;
}

async function responderDesafio(resposta, correta, valor) {
  const botoes = document.querySelectorAll("#jogoDesafio button");
  botoes.forEach(btn => btn.disabled = true);
  if (resposta === correta) {
    pontos += valor;
  }

  rodada++;
  setTimeout(iniciarRodada, 1000);
}

async function finalizarDesafio() {
  const ref = db.collection("desafios").doc(desafioAtual.id);
  await ref.update({
    status: "finalizado",
    vencedor: usuarioId,
    pontosB: pontos,
    finalizadoEm: firebase.firestore.Timestamp.now()
  });

  // Transferir créditos
  const userRef = db.collection("usuarios").doc(usuarioId);
  const doc = await userRef.get();
  const novos = (doc.data().creditos || 0) + (desafioAtual.aposta * 2);
  await userRef.update({ creditos: novos });

  await userRef.collection("extrato").add({
    tipo: "entrada",
    valor: desafioAtual.aposta * 2,
    descricao: "Vitória no desafio PvP",
    data: firebase.firestore.Timestamp.now()
  });

  document.getElementById("jogoDesafio").innerHTML = `<p>🎉 Desafio finalizado! Você venceu com ${pontos} pontos!</p>`;
}
