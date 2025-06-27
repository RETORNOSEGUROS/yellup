const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
const userId = "USUARIO_ATUAL";
const timeId = "SEU_TIME_ID";
const modoAdmin = true;

let tempoTotal = 10;
let perguntaRespondida = false;
let intervalId;

const container = document.getElementById("perguntaContainer");
const textoPergunta = document.getElementById("textoPergunta");
const botoesAlternativas = document.getElementById("botoesAlternativas");
const barraTempo = document.getElementById("barraTempo");
const rankingContainer = document.getElementById("rankingContainer");
const listaRanking = document.getElementById("listaRanking");
const minhaPontuacao = document.getElementById("minhaPontuacao");
const infoJogo = document.getElementById("infoJogo");

async function carregarJogo() {
  if (!jogoId) {
    infoJogo.innerHTML = "⚠️ Jogo não identificado.";
    return;
  }
  try {
    const doc = await db.collection("jogos").doc(jogoId).get();
    if (doc.exists) {
      const dados = doc.data();
      infoJogo.innerHTML = `
        <h2>🏟 ${dados.timeCasa || "Time A"} vs ${dados.timeVisitante || "Time B"}</h2>
        <p>⏰ Início: ${dados.inicio || "-"}<br />
        💳 Entrada: ${dados.valorCreditos || 0} créditos</p>
      `;
    } else {
      infoJogo.innerHTML = "⚠️ Jogo não encontrado.";
    }
  } catch (error) {
    infoJogo.innerHTML = "❌ Erro ao buscar dados do jogo.";
    console.error("Erro ao carregar jogo:", error);
  }
}

async function buscarCreditos(usuarioId) {
  const snap = await db.collection("usuarios").doc(usuarioId).get();
  return snap.exists ? (snap.data().creditos || 0) : 0;
}

async function descontarCreditos(usuarioId, valor) {
  const ref = db.collection("usuarios").doc(usuarioId);
  const docSnap = await ref.get();
  const dados = docSnap.data();
  await ref.set({ ...dados, creditos: (dados.creditos || 0) - valor }, { merge: true });
}

function mostrarPergunta(pergunta, perguntaId) {
  perguntaRespondida = false;
  container.style.display = "block";
  textoPergunta.textContent = pergunta.pergunta;
  botoesAlternativas.innerHTML = "";

  ["A", "B", "C", "D"].forEach(letra => {
    const btn = document.createElement("button");
    btn.textContent = `${letra}) ${pergunta.alternativas[letra]}`;
    btn.onclick = () => responder(letra, pergunta.correta, pergunta.pontuacao, perguntaId, btn);
    botoesAlternativas.appendChild(btn);
  });

  buscarCreditos(userId).then(cred => {
    tempoTotal = cred >= 5 ? 15 : 10;
    if (cred >= 5) descontarCreditos(userId, 5);
    iniciarTempo();
  });
}

function iniciarTempo() {
  let restante = tempoTotal;
  barraTempo.style.width = "100%";
  clearInterval(intervalId);
  intervalId = setInterval(() => {
    restante--;
    barraTempo.style.width = `${(restante / tempoTotal) * 100}%`;
    if (restante <= 0 && !perguntaRespondida) {
      clearInterval(intervalId);
      ocultarPergunta();
    }
  }, 1000);
}

function ocultarPergunta() {
  container.style.display = "none";
  botoesAlternativas.innerHTML = "";
  textoPergunta.textContent = "";
}

async function enviarMensagem() {
  const input = document.getElementById("mensagemInput");
  const texto = input.value.trim();
  if (!texto) return;
  await db.collection("chats_jogo_demo").add({
    jogoId, timeId, texto, tipo: "mensagem", data: new Date()
  });
  input.value = "";
}

async function enviarPerguntaParaTime() {
  const snap = await db.collection("perguntas").where("timeId", "==", timeId).get();
  const perguntas = snap.docs;
  if (perguntas.length === 0) return alert("Sem perguntas disponíveis.");
  const aleatoria = perguntas[Math.floor(Math.random() * perguntas.length)];
  await db.collection("chats_jogo_demo").add({
    tipo: "pergunta", jogoId, timeId, perguntaId: aleatoria.id, data: new Date()
  });
  document.getElementById("ultimaPerguntaEnviada").textContent = `Pergunta enviada: ${aleatoria.id}`;
}

if (modoAdmin) document.getElementById("painelAdmin").style.display = "block";
carregarJogo();
