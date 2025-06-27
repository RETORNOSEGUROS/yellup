// Extrair ID do jogo da URL
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

// Firestore já está inicializado pelo HTML
const db = firebase.firestore();

// Elementos da página
const tituloJogo = document.getElementById("tituloJogo");
const inicioJogo = document.getElementById("inicioJogo");
const entradaJogo = document.getElementById("entradaJogo");
const chatInput = document.getElementById("chatInput");
const chatMensagens = document.getElementById("chatMensagens");

// Carregar dados do jogo + nomes dos times
async function carregarJogo() {
  if (!jogoId) return;

  const doc = await db.collection("jogos").doc(jogoId).get();
  if (!doc.exists) return;

  const dados = doc.data();

  // Buscar nomes reais dos times
  const timeCasaDoc = await db.collection("times").doc(dados.timeCasaId).get();
  const timeForaDoc = await db.collection("times").doc(dados.timeForaId).get();

  const nomeCasa = timeCasaDoc.exists ? timeCasaDoc.data().nome : "Time A";
  const nomeFora = timeForaDoc.exists ? timeForaDoc.data().nome : "Time B";

  tituloJogo.textContent = `${nomeCasa} vs ${nomeFora}`;
  inicioJogo.textContent = dados.dataInicio || "-";
  entradaJogo.textContent = `${dados.valorEntrada || 0} créditos`;
}
carregarJogo();

// Chat da torcida
function enviarMensagem() {
  const texto = chatInput.value.trim();
  if (!texto || !jogoId) return;

  db.collection("chats_jogo_demo").add({
    jogoId,
    mensagem: texto,
    tipo: "chat",
    data: new Date()
  });

  chatInput.value = "";
}

function escutarChat() {
  db.collection("chats_jogo_demo")
    .where("jogoId", "==", jogoId)
    .where("tipo", "==", "chat")
    .orderBy("data", "asc")
    .onSnapshot(snapshot => {
      chatMensagens.value = "";
      snapshot.forEach(doc => {
        const msg = doc.data().mensagem;
        chatMensagens.value += msg + "\n";
      });
    });
}
escutarChat();

// Envio de pergunta manual
async function sortearPergunta() {
  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  if (!jogoDoc.exists) return;

  const jogo = jogoDoc.data();
  const timeId = jogo.timeCasaId;

  const perguntas = await db.collection("perguntas")
    .where("timeId", "==", timeId)
    .get();

  if (perguntas.empty) {
    alert("Nenhuma pergunta encontrada para este time.");
    return;
  }

  const todas = perguntas.docs;
  const aleatoria = todas[Math.floor(Math.random() * todas.length)];

  await db.collection("chats_jogo_demo").add({
    jogoId,
    timeId,
    perguntaId: aleatoria.id,
    tipo: "pergunta",
    data: new Date()
  });

  alert("Pergunta enviada com sucesso!");
}

// Redireciona para o ranking ao vivo
function abrirRanking() {
  window.open(`ranking.html?id=${jogoId}`, "_blank");
}
