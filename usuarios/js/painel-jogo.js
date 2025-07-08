// painel-jogo.js atualizado com lógica para buscar perguntas da coleção 'perguntas' e exibir aleatoriamente

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
let usuario = null;
let jogoId = new URLSearchParams(window.location.search).get("id");
let jogo = null;
let perguntaAtual = null;
let respostaSelecionada = null;
let tempoRestante = 9;
let timerInterval;

// DOM Elements
const perguntaContainer = document.getElementById("pergunta-container");
const perguntaTexto = document.getElementById("pergunta-texto");
const alternativasContainer = document.getElementById("alternativas-container");
const btnResponder = document.getElementById("btnResponderProxima");
const chatTorcidaBox = document.getElementById("chat-torcida");
const chatGeralBox = document.getElementById("chat-geral");
const inputTorcida = document.getElementById("mensagem-torcida");
const inputGeral = document.getElementById("mensagem-geral");
const enviarTorcida = document.getElementById("enviar-torcida");
const enviarGeral = document.getElementById("enviar-geral");

// Autenticação
firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    const userDoc = await db.collection("usuarios").doc(user.uid).get();
    usuario = userDoc.data();
    carregarJogo();
    configurarChat();
  } else {
    window.location.href = "/usuarios/index.html";
  }
});

// Carrega dados do jogo
async function carregarJogo() {
  const doc = await db.collection("jogos").doc(jogoId).get();
  jogo = doc.data();
  exibirInfoJogo();
}

function exibirInfoJogo() {
  document.getElementById("info-times").innerText = `${jogo.timeCasaNome} x ${jogo.timeForaNome}`;
  document.getElementById("time-casa-info").innerText = `${jogo.timeCasaNome}\n${jogo.totalTorcidaCasa || 0} torcedores - ${jogo.porcentagemTorcidaCasa || 0}%\nPontos: ${jogo.totalPontosCasa || 0} (${jogo.porcentagemPontosCasa || 0}%)`;
  document.getElementById("time-fora-info").innerText = `${jogo.timeForaNome}\n${jogo.totalTorcidaFora || 0} torcedores - ${jogo.porcentagemTorcidaFora || 0}%\nPontos: ${jogo.totalPontosFora || 0} (${jogo.porcentagemPontosFora || 0}%)`;

  const inicio = jogo.horarioInicio;
  const fim = jogo.horarioFim;
  document.getElementById("inicio-horario").innerText = inicio;
  document.getElementById("fim-horario").innerText = fim;
}
// Responder próxima pergunta aleatória do banco
btnResponder.addEventListener("click", async () => {
  if (!usuario || !usuario.torcidas || !usuario.torcidas[jogoId]) return;
  const timeId = usuario.torcidas[jogoId];

  const perguntasSnapshot = await db.collection("perguntas")
    .where("timeId", "==", timeId)
    .get();

  const perguntas = perguntasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  if (perguntas.length === 0) return;

  const aleatoria = perguntas[Math.floor(Math.random() * perguntas.length)];
  perguntaAtual = aleatoria;
  exibirPergunta();
});

// Exibe a pergunta na tela
function exibirPergunta() {
  if (!perguntaAtual) return;

  perguntaTexto.innerText = perguntaAtual.pergunta;
  alternativasContainer.innerHTML = "";
  ["A", "B", "C", "D"].forEach(letra => {
    const btn = document.createElement("button");
    btn.className = "alternativa";
    btn.innerText = `${letra}) ${perguntaAtual.alternativas[letra]}`;
    btn.onclick = () => responder(letra);
    alternativasContainer.appendChild(btn);
  });

  iniciarContagem();
}

// Temporizador da pergunta
function iniciarContagem() {
  tempoRestante = 9;
  atualizarBarraTempo();
  timerInterval = setInterval(() => {
    tempoRestante--;
    atualizarBarraTempo();
    if (tempoRestante <= 0) {
      clearInterval(timerInterval);
      mostrarRespostaCorreta();
    }
  }, 1000);
}

function atualizarBarraTempo() {
  const barra = document.getElementById("barra-tempo");
  barra.style.width = `${(tempoRestante / 9) * 100}%`;
}
// Ao clicar em uma alternativa
function responder(letra) {
  respostaSelecionada = letra;
  clearInterval(timerInterval);
  mostrarRespostaCorreta();
  registrarResposta();
}

// Destaque da resposta correta
function mostrarRespostaCorreta() {
  const botoes = document.querySelectorAll(".alternativa");
  botoes.forEach(btn => {
    if (btn.innerText.startsWith(perguntaAtual.correta)) {
      btn.style.backgroundColor = "#a3e635";
    } else {
      btn.style.opacity = "0.5";
    }
  });
}

// Salva resposta no Firestore
async function registrarResposta() {
  await db.collection("respostas").add({
    userId: firebase.auth().currentUser.uid,
    perguntaId: perguntaAtual.id,
    letra: respostaSelecionada,
    correta: perguntaAtual.correta === respostaSelecionada,
    pontos: perguntaAtual.pontuacao,
    jogoId,
    timeTorcida: usuario.torcidas[jogoId],
    created: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

// Configura chats em tempo real
function configurarChat() {
  enviarTorcida.addEventListener("click", enviarMensagemTorcida);
  inputTorcida.addEventListener("keydown", e => {
    if (e.key === "Enter") enviarMensagemTorcida();
  });
  enviarGeral.addEventListener("click", enviarMensagemGeral);
  inputGeral.addEventListener("keydown", e => {
    if (e.key === "Enter") enviarMensagemGeral();
  });

  db.collection("chats_jogo")
    .where("jogoId", "==", jogoId)
    .orderBy("created")
    .onSnapshot(snapshot => {
      chatTorcidaBox.innerHTML = "";
      chatGeralBox.innerHTML = "";
      snapshot.forEach(doc => {
        const msg = doc.data();
        const div = document.createElement("div");
        div.textContent = `${msg.nome}: ${msg.mensagem}`;
        if (msg.tipo === "torcida" && msg.timeId === usuario.torcidas[jogoId]) {
          chatTorcidaBox.appendChild(div);
        } else if (msg.tipo === "geral") {
          chatGeralBox.appendChild(div);
        }
      });
    });
}

// Envio das mensagens
function enviarMensagemTorcida() {
  const texto = inputTorcida.value.trim();
  if (!texto) return;
  db.collection("chats_jogo").add({
    jogoId,
    nome: usuario.usuario,
    mensagem: texto,
    tipo: "torcida",
    timeId: usuario.torcidas[jogoId],
    created: firebase.firestore.FieldValue.serverTimestamp()
  });
  inputTorcida.value = "";
}

function enviarMensagemGeral() {
  const texto = inputGeral.value.trim();
  if (!texto) return;
  db.collection("chats_jogo").add({
    jogoId,
    nome: usuario.usuario,
    mensagem: texto,
    tipo: "geral",
    created: firebase.firestore.FieldValue.serverTimestamp()
  });
  inputGeral.value = "";
}
