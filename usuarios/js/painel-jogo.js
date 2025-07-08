// painel-jogo.js atualizado
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
let uid = null;
let timeTorcida = null;
let perguntaAtual = null;
let respostaEnviada = false;

auth.onAuthStateChanged(async (user) => {
  if (!user) return (window.location.href = "index.html");
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
  carregarPerguntaLiberada(jogo);
  iniciarChat(jogo);
  montarRanking(jogo);
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

async function calcularPontuacao(jogo) {
  const respostas = await db.collection("respostas").where("jogoId", "==", jogoId).get();
  let a = 0, b = 0;
  respostas.forEach(doc => {
    const r = doc.data();
    if (!r.acertou) return;
    if (r.timeId === jogo.timeCasaId) a += r.pontuacao || 1;
    if (r.timeId === jogo.timeForaId) b += r.pontuacao || 1;
  });
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 0;
  const pb = total ? 100 - pa : 0;
  document.getElementById("pontosA").innerText = a;
  document.getElementById("pontosB").innerText = b;
  document.getElementById("porcentagemPontosA").innerText = `${pa}%`;
  document.getElementById("porcentagemPontosB").innerText = `${pb}%`;
}

async function carregarPerguntaLiberada(jogo) {
  const snap = await db.collection("perguntasLiberadas")
    .where("jogoId", "==", jogoId)
    .orderBy("ordem", "desc")
    .limit(1)
    .get();

  if (snap.empty) return document.getElementById("textoPergunta").innerText = "Aguardando próxima pergunta...";

  const refPergunta = snap.docs[0].data().perguntaId;
  const doc = await db.collection("perguntas").doc(refPergunta).get();
  if (!doc.exists) return;

  perguntaAtual = doc;
  const p = doc.data();

  document.getElementById("textoPergunta").innerText = p.texto;
  const lista = document.getElementById("opcoesRespostas");
  lista.innerHTML = "";
  ["A", "B", "C", "D"].forEach(letra => {
    const btn = document.createElement("button");
    btn.className = "list-group-item list-group-item-action";
    btn.innerText = `${letra}) ${p[letra]}`;
    btn.onclick = () => responder(letra, p.correta, p.pontuacao || 1);
    lista.appendChild(btn);
  });
  iniciarContagem();
  atualizarEstatisticasPergunta(refPergunta);
}

function iniciarContagem() {
  const barra = document.getElementById("barra");
  barra.classList.remove("barra-tempo");
  void barra.offsetWidth;
  barra.classList.add("barra-tempo");
  setTimeout(() => {
    if (!respostaEnviada) document.getElementById("mensagemResultado").innerText = "⏰ Tempo esgotado.";
  }, 10000);
}

function responder(letra, correta, pontuacao) {
  if (respostaEnviada) return;
  respostaEnviada = true;
  const acertou = letra === correta;
  document.getElementById("mensagemResultado").innerText = acertou ? "✅ Resposta correta!" : "❌ Resposta incorreta.";
  db.collection("respostas").add({
    userId: uid,
    jogoId,
    timeId: timeTorcida,
    perguntaId: perguntaAtual.id,
    alternativa: letra,
    correta,
    acertou,
    pontuacao,
    timestamp: new Date()
  });
  db.collection("usuarios").doc(uid).update({
    xp: firebase.firestore.FieldValue.increment(pontuacao)
  });
}

function iniciarChat(jogo) {
  db.collection("chat").where("jogoId", "==", jogoId)
    .orderBy("timestamp", "asc")
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

  document.getElementById("mensagemGeral").addEventListener("keypress", e => {
    if (e.key === "Enter") enviarMensagem("geral");
  });
  document.getElementById("mensagemTime").addEventListener("keypress", e => {
    if (e.key === "Enter") enviarMensagem("time");
  });
}

function enviarMensagem(tipo) {
  const input = document.getElementById(tipo === "geral" ? "mensagemGeral" : "mensagemTime");
  const texto = input.value.trim();
  if (!texto) return;
  input.value = "";
  db.collection("usuarios").doc(uid).get().then(doc => {
    const nome = doc.data().usuario || "Anônimo";
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

async function montarRanking(jogo) {
  const snap = await db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("acertou", "==", true).get();

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
}

async function atualizarEstatisticasPergunta(perguntaId) {
  const snap = await db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("perguntaId", "==", perguntaId).get();

  const total = snap.size;
  const acertos = snap.docs.filter(d => d.data().acertou).length;
  const texto = total ? `${acertos} de ${total} acertaram.` : "Ninguém respondeu ainda.";
  document.getElementById("estatisticasPergunta").innerText = texto;
}
