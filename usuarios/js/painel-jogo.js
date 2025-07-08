// painel-jogo.js FINALIZADO ✅

const auth = firebase.auth();
const db = firebase.firestore();

let jogoId = new URLSearchParams(window.location.search).get("id");
let usuario = null;
let timeTorcida = null;
let perguntaAtual = null;
let tempoPergunta = 0;
let tempoLimite = null;
let respondeu = false;

auth.onAuthStateChanged(async (user) => {
  if (!user) return location.href = "/usuarios/index.html";
  const userDoc = await db.collection("usuarios").doc(user.uid).get();
  usuario = { id: user.uid, ...userDoc.data() };
  timeTorcida = usuario.torcidas?.[jogoId];
  if (!timeTorcida) return alert("Você ainda não escolheu seu time para este jogo.");

  iniciarPainel();
});

async function iniciarPainel() {
  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  const jogo = jogoDoc.data();

  document.getElementById("inicioJogo").innerText = new Date(jogo.dataInicio.toDate()).toLocaleTimeString();
  document.getElementById("fimJogo").innerText = new Date(jogo.dataFim.toDate()).toLocaleTimeString();
  atualizarTempoRestante(jogo.dataFim.toDate());
  setInterval(() => atualizarTempoRestante(jogo.dataFim.toDate()), 1000);

  carregarNomesTimes(jogo);
  iniciarChat();
  escutarPerguntaLiberada();
  escutarRanking();
}

async function carregarNomesTimes(jogo) {
  const timeA = await db.collection("times").doc(jogo.timeCasaId).get();
  const timeB = await db.collection("times").doc(jogo.timeForaId).get();
  document.getElementById("tituloJogo").innerText = `${timeA.data().nome} x ${timeB.data().nome}`;
  document.getElementById("timeA").innerText = timeA.data().nome;
  document.getElementById("timeB").innerText = timeB.data().nome;
}

function atualizarTempoRestante(fim) {
  const agora = new Date();
  const restante = Math.max(0, (fim - agora) / 1000);
  const min = Math.floor(restante / 60);
  const seg = Math.floor(restante % 60);
  document.getElementById("tempoRestante").innerText = `${min}m ${seg}s`;
}

function escutarPerguntaLiberada() {
  db.collection("perguntas_enviadas")
    .where("jogoId", "==", jogoId)
    .where("timeId", "==", timeTorcida)
    .orderBy("data", "desc")
    .limit(1)
    .onSnapshot(async (snap) => {
      if (snap.empty) return;

      const dados = snap.docs[0].data();
      perguntaAtual = await db.collection("perguntas").doc(dados.perguntaId).get();
      tempoPergunta = dados.tempo ?? 10;
      tempoLimite = dados.data.toDate().getTime() + tempoPergunta * 1000;
      respondeu = false;
      exibirPergunta(perguntaAtual.data());
    });
}

function exibirPergunta(p) {
  document.getElementById("textoPergunta").innerText = p.texto;
  document.documentElement.style.setProperty("--duracao", `${tempoPergunta}s`);
  document.getElementById("barra").classList.remove("barra-tempo");
  void document.getElementById("barra").offsetWidth;
  document.getElementById("barra").classList.add("barra-tempo");

  const lista = document.getElementById("opcoesRespostas");
  lista.innerHTML = "";
  ["A", "B", "C", "D"].forEach(letra => {
    const btn = document.createElement("button");
    btn.className = "list-group-item list-group-item-action";
    btn.innerText = `${letra}) ${p[letra]}`;
    btn.onclick = () => responder(letra, p);
    lista.appendChild(btn);
  });

  document.getElementById("mensagemResultado").innerText = "";
  atualizarEstatisticas(p.id);
  setTimeout(() => bloquearResposta(), tempoPergunta * 1000);
}

function responder(letra, p) {
  if (respondeu || new Date().getTime() > tempoLimite) return;
  respondeu = true;
  const acertou = letra === p.correta;
  document.getElementById("mensagemResultado").innerText = acertou ? "✅ Acertou!" : "❌ Errou.";

  db.collection("respostas").add({
    userId: usuario.id,
    jogoId,
    perguntaId: perguntaAtual.id,
    alternativa: letra,
    correta: p.correta,
    acertou,
    pontuacao: acertou ? p.pontuacao : 0,
    timestamp: new Date(),
    timeId: timeTorcida
  });

  db.collection("usuarios").doc(usuario.id).update({
    xp: firebase.firestore.FieldValue.increment(acertou ? p.pontuacao : 0),
    creditos: firebase.firestore.FieldValue.increment(-1)
  });
}

function bloquearResposta() {
  if (!respondeu) document.getElementById("mensagemResultado").innerText = "⏱️ Tempo esgotado.";
  const botoes = document.querySelectorAll("#opcoesRespostas button");
  botoes.forEach(btn => btn.disabled = true);
}

function iniciarChat() {
  const ref = db.collection("chat")
    .where("jogoId", "==", jogoId)
    .orderBy("timestamp", "asc");

  ref.onSnapshot(snap => {
    const chatGeral = document.getElementById("chatGeral");
    const chatTime = document.getElementById("chatTime");
    chatGeral.innerHTML = "";
    chatTime.innerHTML = "";
    snap.forEach(doc => {
      const m = doc.data();
      const el = `<div class='chat-message'><strong>${m.nome}:</strong> ${m.texto}</div>`;
      if (m.tipo === "geral") chatGeral.innerHTML += el;
      if (m.tipo === "time" && m.timeId === timeTorcida) chatTime.innerHTML += el;
    });
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
  db.collection("chat").add({
    jogoId,
    tipo,
    texto,
    nome: usuario.usuario,
    timestamp: new Date(),
    timeId: timeTorcida,
    userId: usuario.id
  });
}

async function atualizarEstatisticas(perguntaId) {
  const snap = await db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("perguntaId", "==", perguntaId).get();
  const total = snap.size;
  const acertos = snap.docs.filter(d => d.data().acertou).length;
  document.getElementById("estatisticasPergunta").innerText = total ? `${acertos} de ${total} acertaram.` : "Ninguém respondeu ainda.";
}

function escutarRanking() {
  db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("acertou", "==", true)
    .onSnapshot(async (snap) => {
      const pontuacoes = {};
      snap.forEach(doc => {
        const r = doc.data();
        if (!pontuacoes[r.userId]) pontuacoes[r.userId] = 0;
        pontuacoes[r.userId] += r.pontuacao || 1;
      });

      const lista = Object.entries(pontuacoes).sort((a,b) => b[1] - a[1]).slice(0,5);
      const container = document.getElementById("rankingPontuacao");
      container.innerHTML = "";
      for (const [userId, pontos] of lista) {
        const userDoc = await db.collection("usuarios").doc(userId).get();
        const nome = userDoc.exists ? userDoc.data().usuario : "Torcedor";
        container.innerHTML += `<li class='list-group-item'>${nome} - ${pontos} pts</li>`;
      }
    });
}
