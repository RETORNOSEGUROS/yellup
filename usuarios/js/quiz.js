
let perguntasDisponiveis = [];
let perguntaAtual = null;
let tempoRestante = 10;
let timer = null;
let acertosSeguidos = 0;

async function carregarQuiz(jogoId, usuarioId, timeId) {
  try {
    const snap = await db.collection("perguntas").where("timeId", "==", timeId).get();
    perguntasDisponiveis = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (perguntasDisponiveis.length === 0) {
      document.getElementById("textoPergunta").textContent = "Nenhuma pergunta disponível.";
      return;
    }
    sortearPergunta();
  } catch (e) {
    console.error("Erro ao carregar perguntas:", e);
  }
}

function sortearPergunta() {
  if (perguntasDisponiveis.length === 0) {
    document.getElementById("textoPergunta").textContent = "Fim das perguntas!";
    document.getElementById("opcoesQuiz").innerHTML = "";
    document.getElementById("contadorTempo").textContent = "";
    return;
  }

  const index = Math.floor(Math.random() * perguntasDisponiveis.length);
  perguntaAtual = perguntasDisponiveis.splice(index, 1)[0];

  document.getElementById("textoPergunta").textContent = perguntaAtual.texto;
  const opcoes = ["A", "B", "C", "D"];
  const ul = document.getElementById("opcoesQuiz");
  ul.innerHTML = "";

  opcoes.forEach(op => {
    const li = document.createElement("li");
    li.innerHTML = `<button onclick="responderPergunta('${op}')" style="width:100%; margin:5px 0; padding:10px;">(${op}) ${perguntaAtual[op]}</button>`;
    ul.appendChild(li);
  });

  tempoRestante = 10;
  document.getElementById("contadorTempo").textContent = `⏳ Tempo restante: ${tempoRestante}s`;
  timer = setInterval(atualizarTempo, 1000);
}

function atualizarTempo() {
  tempoRestante--;
  document.getElementById("contadorTempo").textContent = `⏳ Tempo restante: ${tempoRestante}s`;
  if (tempoRestante <= 0) {
    clearInterval(timer);
    responderPergunta(null);
  }
}


async function responderPergunta(resposta) {
  const userRef = db.collection("usuarios").doc(usuarioId);
  const userDoc = await userRef.get();
  const creditos = userDoc.data().creditos || 0;

  if (creditos < 1) {
    document.getElementById("contadorTempo").textContent = "❌ Sem créditos para responder.";
    return;
  }

  await userRef.update({ creditos: creditos - 1 });
  await db.collection("usuarios").doc(usuarioId).collection("extrato").add({
    tipo: "saida",
    valor: 1,
    descricao: "Resposta de pergunta",
    data: firebase.firestore.Timestamp.now()
  });

  clearInterval(timer);

  const acertou = resposta && resposta === perguntaAtual.correta;
  const pontos = acertou ? perguntaAtual.pontuacao : 0;

  if (acertou) {
    acertosSeguidos++;
    if (acertosSeguidos === 5) {
      const jogoDoc = await db.collection("jogos").doc(jogoId).get();
      const timeCasa = await db.collection("times").doc(jogoDoc.data().timeCasaId).get();
      const timeFora = await db.collection("times").doc(jogoDoc.data().timeForaId).get();
      const nomeJogo = `${timeCasa.data().nome} x ${timeFora.data().nome}`;
      const conquistaRef = db.collection("usuarios").doc(usuarioId)
        .collection("conquistas").doc(jogoId + "_acertos5");

      const doc = await conquistaRef.get();
      if (!doc.exists) {
        await conquistaRef.set({
          tipo: "Precisão",
          descricao: `5 acertos seguidos no jogo ${nomeJogo}`,
          data: firebase.firestore.Timestamp.now()
        });
      }
    }
  } else {
    acertosSeguidos = 0;
  }

  await db.collection("respostas").doc(`${jogoId}_${usuarioId}_${perguntaAtual.id}`).set({
    usuarioId,
    perguntaId: perguntaAtual.id,
    resposta,
    correta: perguntaAtual.correta,
    pontos,
    nome: localStorage.getItem("nomeUsuario") || "Torcedor",
    data: firebase.firestore.Timestamp.now()
  });

  const feedback = acertou ? `✅ Resposta correta! +${pontos} pontos` : `❌ Você errou. Resposta correta: (${perguntaAtual.correta}) ${perguntaAtual[perguntaAtual.correta]}`;
  document.getElementById("contadorTempo").textContent = feedback;

  setTimeout(sortearPergunta, 3000);
}


let quizRespondido = false;

async function responderPergunta(resposta) {
  if (quizRespondido) return;
  quizRespondido = true;

  const userRef = db.collection("usuarios").doc(usuarioId);
  const userDoc = await userRef.get();
  const creditos = userDoc.data().creditos || 0;

  if (creditos < 1) {
    document.getElementById("contadorTempo").textContent = "❌ Sem créditos para responder.";
    return;
  }

  await userRef.update({ creditos: creditos - 1 });
  await db.collection("usuarios").doc(usuarioId).collection("extrato").add({
    tipo: "saida",
    valor: 1,
    descricao: "Resposta de pergunta",
    data: firebase.firestore.Timestamp.now()
  });

  clearInterval(tempoInterval);
  const correta = perguntaAtual.correta;
  const pontos = (resposta === correta) ? perguntaAtual.pontuacao : 0;

  const respostaDocId = `${jogoId}_${usuarioId}_${perguntaAtual.id}`;
  await db.collection("respostas").doc(respostaDocId).set({
    usuarioId,
    nome,
    jogoId,
    perguntaId: perguntaAtual.id,
    resposta,
    correta,
    pontos,
    timeId,
    data: firebase.firestore.Timestamp.now()
  });

  const botoes = document.querySelectorAll("#botoesRespostas button");
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

  mostrarEstatisticaPergunta(perguntaAtual.id);
  await adicionarXP(usuarioId, 5);
}

async function mostrarEstatisticaPergunta(perguntaId) {
  try {
    const snap = await db.collection("respostas")
      .where("perguntaId", "==", perguntaId).get();

    if (snap.empty) return;

    let total = 0, acertos = 0;
    snap.forEach(doc => {
      total++;
      const r = doc.data();
      if (r.resposta === r.correta) acertos++;
    });

    const percent = Math.round((acertos / total) * 100);
    document.getElementById("blocoEstatisticaPergunta").style.display = "block";
    document.getElementById("textoEstatisticaPergunta").textContent = `${acertos} de ${total} usuários acertaram (${percent}%)`;
  } catch (e) {
    console.error("Erro ao calcular estatística:", e);
  }
}
