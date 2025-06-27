// painel-jogo.js
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let timeCasaId = "";
let timeForaId = "";

// Carrega dados do jogo e times
async function carregarJogo() {
  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  if (!jogoDoc.exists) return;

  const jogo = jogoDoc.data();
  timeCasaId = jogo.timeCasaId;
  timeForaId = jogo.timeForaId;

  const timeCasaSnap = await db.collection("times").doc(timeCasaId).get();
  const timeForaSnap = await db.collection("times").doc(timeForaId).get();

  const nomeCasa = timeCasaSnap.exists ? timeCasaSnap.data().nome : "Time A";
  const nomeFora = timeForaSnap.exists ? timeForaSnap.data().nome : "Time B";

  document.getElementById("titulo-jogo").textContent = `${nomeCasa} vs ${nomeFora}`;
  document.getElementById("inicio-jogo").textContent = jogo.dataInicio?.toDate().toLocaleString("pt-BR") || "-";
  document.getElementById("entrada-jogo").textContent = jogo.valorEntrada ? `${jogo.valorEntrada} crédito(s)` : "-";

  escutarChats(nomeCasa, nomeFora);
}

// Envia mensagens para os chats corretos
function enviarMensagem(tipo) {
  const input = document.getElementById(`input${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);
  const texto = input.value.trim();
  if (!texto) return;

  const caminho = tipo === "geral" ? `chats_jogo/${jogoId}/geral`
    : tipo === "timeA" ? `chats_jogo/${jogoId}/casa`
    : `chats_jogo/${jogoId}/fora`;

  db.collection(caminho).add({
    texto,
    admin: true,
    criadoEm: new Date()
  });

  input.value = "";
}

// Escuta os 3 chats em tempo real
function escutarChats(nomeCasa, nomeFora) {
  escutarChat(`chats_jogo/${jogoId}/geral`, "chatGeral");
  escutarChat(`chats_jogo/${jogoId}/casa`, "chatTimeA", nomeCasa);
  escutarChat(`chats_jogo/${jogoId}/fora`, "chatTimeB", nomeFora);
}

function escutarChat(caminho, divId, nome = "Torcida") {
  db.collection(caminho).orderBy("criadoEm").onSnapshot(snapshot => {
    const div = document.getElementById(divId);
    div.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      const linha = document.createElement("div");
      linha.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
      div.appendChild(linha);
    });
  });
}

function sortearPergunta() {
  alert("Função de sorteio ainda será implementada.");
}

carregarJogo();
