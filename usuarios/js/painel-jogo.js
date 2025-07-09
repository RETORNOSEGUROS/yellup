const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
let uid = null;
let timeTorcida = null;
let respostaEnviada = false;
let perguntaAtual = null;

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return (window.location.href = "/usuarios/index.html");
  uid = user.uid;

  const userDoc = await db.collection("usuarios").doc(uid).get();
  timeTorcida = userDoc.data().torcidas?.[jogoId];
  if (!timeTorcida) return alert("Você não escolheu um time para torcer.");

  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  const jogo = jogoDoc.data();

  const timeA = await db.collection("times").doc(jogo.timeCasaId).get();
  const timeB = await db.collection("times").doc(jogo.timeForaId).get();

  document.getElementById("tituloJogo").innerText = `${timeA.data().nome} x ${timeB.data().nome}`;
  document.getElementById("timeA").innerText = timeA.data().nome;
  document.getElementById("timeB").innerText = timeB.data().nome;
  document.getElementById("inicioJogo").innerText = formatarData(jogo.dataInicio.toDate());
  document.getElementById("fimJogo").innerText = formatarData(jogo.dataFim.toDate());

  atualizarTempoRestante(jogo.dataFim.toDate());
  setInterval(() => atualizarTempoRestante(jogo.dataFim.toDate()), 1000);

  calcularTorcida(jogo);
  calcularPontuacao(jogo);
  iniciarChat();
  montarRanking();
});

function formatarData(data) {
  return data.toLocaleString("pt-BR", { hour: '2-digit', minute: '2-digit' });
}

function atualizarTempoRestante(fim) {
  const agora = new Date();
  const diff = Math.max(0, fim - agora);
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  document.getElementById("tempoRestante").innerText = `${min}m ${sec}s`;
}

async function calcularTorcida(jogo) {
  const usuarios = await db.collection("usuarios").get();
  let a = 0, b = 0;
  usuarios.forEach(doc => {
    const t = doc.data().torcidas?.[jogoId];
    if (t === jogo.timeCasaId) a++;
    if (t === jogo.timeForaId) b++;
  });
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 0;
  const pb = total ? 100 - pa : 0;
  document.getElementById("torcidaA").innerText = a;
  document.getElementById("torcidaB").innerText = b;
  document.getElementById("porcentagemA").innerText = `${pa}%`;
  document.getElementById("porcentagemB").innerText = `${pb}%`;
}

async function responderPergunta() {
  const snap = await db.collection("perguntas").where("timeId", "==", timeTorcida).get();
  if (snap.empty) return alert("Nenhuma pergunta disponível para seu time.");
  const perguntas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const pergunta = perguntas[Math.floor(Math.random() * perguntas.length)];
  mostrarPergunta(pergunta);
}

function mostrarPergunta(p) {
  perguntaAtual = p;
  respostaEnviada = false;
  document.getElementById("textoPergunta").innerText = p.pergunta || p.texto || "Pergunta não encontrada";
  document.getElementById("opcoesRespostas").innerHTML = "";
  document.getElementById("mensagemResultado").innerText = "";

  const alternativas = p.alternativas || {};

  ["A", "B", "C", "D"].forEach(letra => {
    const textoAlt = alternativas[letra] || "Indefinido";
    const btn = document.createElement("button");
    btn.className = "list-group-item list-group-item-action";
    btn.innerText = `${letra}) ${textoAlt}`;
    btn.onclick = () => responder(letra, p.correta, p.pontuacao || 1, p.id);
    document.getElementById("opcoesRespostas").appendChild(btn);
  });

  iniciarContador();
}

function iniciarContador() {
  const barra = document.getElementById("barra");
  barra.style.display = "block";
  barra.style.animation = "none";
  barra.offsetHeight; // forçar reflow
  barra.style.animation = "barraTempo 9s linear forwards";

  setTimeout(() => {
    if (!respostaEnviada) {
      document.getElementById("mensagemResultado").innerText = "⏱️ Tempo esgotado!";
      desabilitarOpcoes();
    }
  }, 9000);
}

function desabilitarOpcoes() {
  document.querySelectorAll("#opcoesRespostas button").forEach(btn => btn.disabled = true);
}

async function responder(letra, correta, pontos, perguntaId) {
  if (respostaEnviada) return;
  respostaEnviada = true;
  const acertou = letra === correta;
  document.getElementById("mensagemResultado").innerText = acertou
    ? "✅ Resposta correta!"
    : `❌ Errado. Correta: ${correta}`;
  await db.collection("respostas").add({
    jogoId,
    perguntaId,
    userId: uid,
    timeId: timeTorcida,
    resposta: letra,
    correta,
    acertou,
    pontuacao: acertou ? pontos : 0,
    timestamp: new Date()
  });
  if (acertou) {
    await db.collection("usuarios").doc(uid).update({
      [`pontuacoes.${jogoId}`]: firebase.firestore.FieldValue.increment(pontos),
      xp: firebase.firestore.FieldValue.increment(pontos)
    });
  }
  await db.collection("usuarios").doc(uid).update({
    creditos: firebase.firestore.FieldValue.increment(-1)
  });
  calcularPontuacao();
  montarRanking();
}

function iniciarChat() {
  db.collection("chat")
    .where("jogoId", "==", jogoId)
    .orderBy("timestamp")
    .onSnapshot(snapshot => {
      const chatGeral = document.getElementById("chatGeral");
      const chatTime = document.getElementById("chatTime");
      chatGeral.innerHTML = "";
      chatTime.innerHTML = "";
      snapshot.forEach(doc => {
        const msg = doc.data();
        const el = `<div class='chat-message'><strong>${msg.nome}:</strong> ${msg.texto}</div>`;
        if (msg.tipo === "geral") chatGeral.innerHTML += el;
        if (msg.tipo === "time" && msg.timeId === timeTorcida) chatTime.innerHTML += el;
      });
      chatGeral.scrollTop = chatGeral.scrollHeight;
      chatTime.scrollTop = chatTime.scrollHeight;
    });

  document.getElementById("mensagemGeral").addEventListener("keydown", e => {
    if (e.key === "Enter") enviarMensagem("geral");
  });
  document.getElementById("mensagemTime").addEventListener("keydown", e => {
    if (e.key === "Enter") enviarMensagem("time");
  });
}

function enviarMensagem(tipo) {
  const input = document.getElementById(tipo === "geral" ? "mensagemGeral" : "mensagemTime");
  const texto = input.value.trim();
  if (!texto) return;
  input.value = "";
  db.collection("usuarios").doc(uid).get().then(doc => {
    const nome = doc.data().usuario || "Torcedor";
    db.collection("chat").add({
      jogoId,
      timeId: timeTorcida,
      tipo,
      userId: uid,
      nome,
      texto,
      timestamp: new Date()
    });
  });
}

function montarRanking() {
  db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("acertou", "==", true)
    .get()
    .then(async snap => {
      const ranking = {};
      snap.forEach(doc => {
        const r = doc.data();
        if (!ranking[r.userId]) ranking[r.userId] = 0;
        ranking[r.userId] += r.pontuacao || 1;
      });
      const lista = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const container = document.getElementById("rankingPontuacao");
      container.innerHTML = "";
      for (const [userId, pontos] of lista) {
        const user = await db.collection("usuarios").doc(userId).get();
        const nome = user.exists ? user.data().usuario : "Torcedor";
        container.innerHTML += `<li class='list-group-item'>${nome} - ${pontos} pts</li>`;
      }
    });
}
