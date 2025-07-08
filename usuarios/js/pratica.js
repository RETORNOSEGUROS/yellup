
let perguntaAtualPratica = null;

async function carregarPerguntaPratica() {
  const userDoc = await db.collection("usuarios").doc(usuarioId).get();
  const timeId = userDoc.data().timeId;

  const snap = await db.collection("perguntas").where("timeId", "==", timeId).get();
  if (snap.empty) {
    document.getElementById("perguntaPratica").innerHTML = "<p>❌ Nenhuma pergunta encontrada.</p>";
    return;
  }

  const perguntas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  perguntaAtualPratica = perguntas[Math.floor(Math.random() * perguntas.length)];

  let html = `<h4>${perguntaAtualPratica.texto}</h4><div id="botoesPratica">`;
  ["A", "B", "C", "D"].forEach(letra => {
    html += `<button onclick="responderPratica('${letra}')">${letra}) ${perguntaAtualPratica[letra]}</button><br>`;
  });
  html += "</div><div id='feedbackPratica'></div>";

  document.getElementById("perguntaPratica").innerHTML = html;
}

async function responderPratica(resposta) {
  const correta = perguntaAtualPratica.correta;
  const pontos = (resposta === correta) ? perguntaAtualPratica.pontuacao : 0;

  await db.collection("respostas_pratica").add({
    usuarioId,
    nome,
    perguntaId: perguntaAtualPratica.id,
    resposta,
    correta,
    pontos,
    timeId: perguntaAtualPratica.timeId,
    data: firebase.firestore.Timestamp.now()
  });

  if (resposta === correta) {
    await adicionarXP(usuarioId, 3);
  }

  const botoes = document.querySelectorAll("#botoesPratica button");
  botoes.forEach(btn => {
    btn.disabled = true;
    const letra = btn.textContent[0];
    if (letra === correta) {
      btn.style.backgroundColor = "green";
      btn.style.color = "#fff";
    } else if (letra === resposta) {
      btn.style.backgroundColor = "red";
      btn.style.color = "#fff";
    }
  });

  const feedback = document.getElementById("feedbackPratica");
  feedback.innerHTML = resposta === correta
    ? "<p style='color:green;'>✅ Você acertou! +3 XP</p>"
    : "<p style='color:red;'>❌ Você errou. A resposta correta era " + correta + ".</p>";
}
