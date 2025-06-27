// admin/js/painel-jogo.js

const db = firebase.firestore();
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let timeCasaId = "";
let timeForaId = "";

// Dados do jogo
async function carregarJogo() {
  const docRef = db.collection("jogos").doc(jogoId);
  const snap = await docRef.get();
  if (!snap.exists) return;
  const jogo = snap.data();

  timeCasaId = jogo.timeCasaId;
  timeForaId = jogo.timeForaId;

  const timeCasaSnap = await db.collection("times").doc(timeCasaId).get();
  const timeForaSnap = await db.collection("times").doc(timeForaId).get();

  const nomeCasa = timeCasaSnap.exists ? timeCasaSnap.data().nome : "Time A";
  const nomeFora = timeForaSnap.exists ? timeForaSnap.data().nome : "Time B";

  document.getElementById("tituloJogo").textContent = `${nomeCasa} vs ${nomeFora}`;
  document.getElementById("nomeTimeCasa").textContent = nomeCasa;
  document.getElementById("nomeTimeFora").textContent = nomeFora;

  document.getElementById("infoInicio").textContent = jogo.dataInicio?.toDate().toLocaleString("pt-BR") || "-";
  document.getElementById("infoEntrada").textContent = jogo.valorEntrada ? `${jogo.valorEntrada} crédito(s)` : "-";

  escutarChats();
}

function escutarChats() {
  escutarChat("geral", `chats_jogo/${jogoId}/geral`, "chatGeral");
  escutarChat("casa", `chats_jogo/${jogoId}/casa`, "chatCasa");
  escutarChat("fora", `chats_jogo/${jogoId}/fora`, "chatFora");
}

function escutarChat(tipo, caminho, divId) {
  db.collection(caminho).orderBy("criadoEm").onSnapshot(snapshot => {
    const div = document.getElementById(divId);
    div.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      const el = document.createElement("div");
      el.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
      div.appendChild(el);
    });
  });
}

function enviarMensagem(tipo) {
  const inputId = tipo === "geral" ? "msgGeral" : tipo === "casa" ? "msgCasa" : "msgFora";
  const input = document.getElementById(inputId);
  const texto = input.value.trim();
  if (!texto) return;

  const caminho = tipo === "geral"
    ? `chats_jogo/${jogoId}/geral`
    : tipo === "casa"
    ? `chats_jogo/${jogoId}/casa`
    : `chats_jogo/${jogoId}/fora`;

  db.collection(caminho).add({
    texto,
    admin: true,
    criadoEm: new Date()
  });

  input.value = "";
}

function sortearEnviarPergunta() {
  alert("Envio de pergunta ainda será implementado.");
}

carregarJogo();
