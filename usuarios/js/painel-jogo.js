// painel-jogo.js - versão com busca de pergunta aleatória via campo perguntaAtualCasa/perguntaAtualFora

const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:6a44375b55e98c2ae5ff1e"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
let usuario = null;
let jogo = null;
let timeUsuario = null;
let timeIdUsuario = null;
let unsubscribePergunta = null;

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return window.location.href = "/usuarios/index.html";

  const docUser = await db.collection("usuarios").doc(user.uid).get();
  usuario = { id: user.uid, ...docUser.data() };
  timeIdUsuario = usuario.timeId;
  document.getElementById("timeA").textContent = "Time A";
  document.getElementById("timeB").textContent = "Time B";

  carregarJogo();
});

async function carregarJogo() {
  const doc = await db.collection("jogos").doc(jogoId).get();
  if (!doc.exists) return;
  jogo = doc.data();

  const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
  const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

  const timeCasa = timeCasaDoc.data();
  const timeFora = timeForaDoc.data();

  const nomeCasa = timeCasa?.nome || "Time A";
  const nomeFora = timeFora?.nome || "Time B";

  document.getElementById("tituloJogo").textContent = `${nomeCasa} x ${nomeFora}`;
  document.getElementById("timeA").textContent = nomeCasa;
  document.getElementById("timeB").textContent = nomeFora;

  timeUsuario = (timeIdUsuario === jogo.timeCasaId) ? "casa" : "fora";

  // Início e fim do jogo
  const inicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio);
  const fim = jogo.dataFim?.toDate?.() || new Date(jogo.dataFim);

  document.getElementById("inicioJogo").textContent = inicio.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
  document.getElementById("fimJogo").textContent = fim.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });

  atualizarTempo(fim);
  setInterval(() => atualizarTempo(fim), 1000);

  escutarPerguntaLiberada();
}

function atualizarTempo(fim) {
  const agora = new Date();
  const diffMs = fim - agora;
  const minutos = Math.floor(diffMs / 60000);
  const segundos = Math.floor((diffMs % 60000) / 1000);
  document.getElementById("tempoRestante").textContent = `${minutos}m ${segundos}s`;
}

function escutarPerguntaLiberada() {
  const campo = (timeUsuario === "casa") ? "perguntaAtualCasa" : "perguntaAtualFora";

  if (unsubscribePergunta) unsubscribePergunta();

  unsubscribePergunta = db.collection("jogos").doc(jogoId).onSnapshot(async (doc) => {
    const data = doc.data();
    const perguntaId = data[campo];
    if (!perguntaId) return exibirMensagem("Aguardando pergunta...");
    const perguntaDoc = await db.collection("perguntas").doc(perguntaId).get();
    if (!perguntaDoc.exists) return;
    exibirPergunta(perguntaDoc);
  });
}

function exibirMensagem(msg) {
  const container = document.getElementById("textoPergunta");
  container.innerHTML = `<em>${msg}</em>`;
  document.getElementById("opcoesRespostas").innerHTML = "";
}

function exibirPergunta(perguntaDoc) {
  const dados = perguntaDoc.data();
  const container = document.getElementById("textoPergunta");
  const opcoes = document.getElementById("opcoesRespostas");

  container.innerHTML = dados.pergunta;
  opcoes.innerHTML = "";

  ["A", "B", "C", "D"].forEach((letra) => {
    const texto = dados.alternativas?.[letra];
    if (!texto) return;

    const btn = document.createElement("button");
    btn.textContent = `${letra}) ${texto}`;
    btn.className = "list-group-item list-group-item-action";
    btn.onclick = () => enviarResposta(perguntaDoc.id, letra, dados);
    opcoes.appendChild(btn);
  });
}

async function enviarResposta(perguntaId, letra, dadosPergunta) {
  const resposta = {
    perguntaId,
    letra,
    usuarioId: usuario.id,
    jogoId,
    timeId: timeIdUsuario,
    pontos: letra === dadosPergunta.correta ? dadosPergunta.pontuacao : 0,
    data: new Date()
  };

  await db.collection("respostas").add(resposta);
  exibirMensagem(letra === dadosPergunta.correta ? "✅ Resposta correta!" : "❌ Resposta incorreta!");

  // Descontar crédito se respondeu
  await db.collection("usuarios").doc(usuario.id).update({
    creditos: firebase.firestore.FieldValue.increment(-1)
  });
}
