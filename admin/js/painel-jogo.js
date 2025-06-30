const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let timeCasaId = "";
let timeForaId = "";

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

function escutarChats(nomeCasa, nomeFora) {
  escutarChat(`chats_jogo/${jogoId}/geral`, "chatGeral");
  escutarChat(`chats_jogo/${jogoId}/casa`, "chatTimeA", nomeCasa);
  escutarChat(`chats_jogo/${jogoId}/fora`, "chatTimeB", nomeFora);
}

function escutarChat(caminho, divId, nome = "Torcida") {
  db.collection(caminho).orderBy("criadoEm").onSnapshot(async (snapshot) => {
    const div = document.getElementById(divId);
    div.innerHTML = "";
    for (const doc of snapshot.docs) {
      const msg = doc.data();
      const linha = document.createElement("div");
      if (msg.tipo === "pergunta" && msg.perguntaId) {
        try {
          const perguntaSnap = await db.collection("perguntas").doc(msg.perguntaId).get();
          const textoPergunta = perguntaSnap.exists ? perguntaSnap.data().pergunta : "(pergunta não encontrada)";
          linha.innerHTML = `<i>[PERGUNTA] ${textoPergunta}</i>`;
        } catch {
          linha.innerHTML = `<i>[PERGUNTA] ID: ${msg.perguntaId}</i>`;
        }
      } else {
        linha.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
      }
      div.appendChild(linha);
    }
  });
}

async function buscarPerguntasPorTimeId(timeId) {
  try {
    const snapshot = await db.collection("perguntas").where("timeId", "==", timeId).get();
    if (snapshot.empty) return [];
    const perguntas = [];
    snapshot.forEach(doc => {
      perguntas.push({ id: doc.id, ...doc.data() });
    });
    return perguntas;
  } catch (error) {
    console.error("Erro ao buscar perguntas:", error);
    return [];
  }
}

async function sortearPerguntaTimeA() {
  const perguntas = await buscarPerguntasPorTimeId(timeCasaId);
  if (perguntas.length === 0) return alert("Time A não possui perguntas.");

  const perguntaSorteada = perguntas[Math.floor(Math.random() * perguntas.length)];
  await db.collection(`chats_jogo/${jogoId}/casa`).add({
    tipo: "pergunta",
    perguntaId: perguntaSorteada.id,
    dataEnvio: new Date()
  });
  alert("Pergunta enviada para o Time A!");
}

async function sortearPerguntaTimeB() {
  const perguntas = await buscarPerguntasPorTimeId(timeForaId);
  if (perguntas.length === 0) return alert("Time B não possui perguntas.");

  const perguntaSorteada = perguntas[Math.floor(Math.random() * perguntas.length)];
  await db.collection(`chats_jogo/${jogoId}/fora`).add({
    tipo: "pergunta",
    perguntaId: perguntaSorteada.id,
    dataEnvio: new Date()
  });
  alert("Pergunta enviada para o Time B!");
}

carregarJogo();
