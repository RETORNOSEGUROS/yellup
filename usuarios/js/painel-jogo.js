const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let perguntaAtual = null;
let respostaEnviada = false;

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const uid = user.uid;

  // Buscar dados do jogo
  const jogo = await db.collection("jogos").doc(jogoId).get();
  if (!jogo.exists) {
    document.getElementById("tituloJogo").innerText = "Jogo não encontrado";
    return;
  }

  const dadosJogo = jogo.data();

  // Buscar nomes dos times
  const casa = await db.collection("times").doc(dadosJogo.timeCasaId).get();
  const fora = await db.collection("times").doc(dadosJogo.timeForaId).get();
  const nomeJogo = `${casa.exists ? casa.data().nome : "Time A"} x ${fora.exists ? fora.data().nome : "Time B"}`;
  document.getElementById("tituloJogo").innerText = nomeJogo;

  // Buscar time do usuário para filtrar pergunta
  const usuarioDoc = await db.collection("usuarios").doc(uid).get();
  const timeId = usuarioDoc.data().torcidas?.[jogoId];

  if (!timeId) {
    alert("Você ainda não escolheu um time para torcer.");
    window.location.href = "painel.html";
    return;
  }

  // Buscar 1 pergunta aleatória do time escolhido
  const perguntas = await db.collection("perguntas")
    .where("timeId", "==", timeId)
    .limit(1)
    .get();

  if (perguntas.empty) {
    document.getElementById("textoPergunta").innerText = "Nenhuma pergunta disponível.";
    return;
  }

  perguntaAtual = perguntas.docs[0];
  const dadosPergunta = perguntaAtual.data();

  document.getElementById("textoPergunta").innerText = dadosPergunta.texto;

  const opcoes = ["A", "B", "C", "D"];
  const lista = document.getElementById("opcoesRespostas");
  lista.innerHTML = "";

  opcoes.forEach((letra) => {
    const item = document.createElement("button");
    item.className = "list-group-item list-group-item-action";
    item.innerText = `${letra}) ${dadosPergunta[letra]}`;
    item.onclick = () => responder(letra, dadosPergunta.correta, uid);
    lista.appendChild(item);
  });

  // Iniciar cronômetro
  iniciarContagem(dadosPergunta.correta);
});

function iniciarContagem(correta) {
  const barra = document.getElementById("barra");
  barra.classList.remove("barra-tempo");
  void barra.offsetWidth; // reinicia animação
  barra.classList.add("barra-tempo");

  setTimeout(() => {
    if (!respostaEnviada) {
      document.getElementById("mensagemResultado").innerText = "Tempo esgotado!";
    }
  }, 10000);
}

function responder(letra, correta, uid) {
  if (respostaEnviada) return;
  respostaEnviada = true;

  const acertou = letra === correta;
  const mensagem = acertou ? "✅ Resposta correta!" : "❌ Resposta incorreta.";
  document.getElementById("mensagemResultado").innerText = mensagem;

  db.collection("respostas").add({
    userId: uid,
    perguntaId: perguntaAtual.id,
    jogoId: jogoId,
    alternativa: letra,
    correta: correta,
    acertou: acertou,
    timestamp: new Date()
  });
}
