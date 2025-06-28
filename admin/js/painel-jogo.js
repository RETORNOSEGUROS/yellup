// painel-jogo.js atualizado para usar timeId ao buscar perguntas
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

function enviarMensagem(tipo) {
  const input = document.getElementById(`input${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);
  const texto = input.value.trim();
  if (!texto) return;

  const caminho = tipo === "geral"
    ? `chats_jogo/${jogoId}/geral`
    : tipo === "timeA"
    ? `chats_jogo/${jogoId}/casa`
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
  db.collection(caminho).orderBy("criadoEm").onSnapshot(snapshot => {
    const div = document.getElementById(divId);
    div.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      const linha = document.createElement("div");
      if (msg.tipo === "pergunta") {
        linha.innerHTML = `<i>Pergunta enviada: ${msg.perguntaId}</i>`;
      } else {
        linha.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
      }
      div.appendChild(linha);
    });
  });
}

async function buscarPerguntasPorTimeId(timeId) {
  try {
    console.log("🔍 Buscando perguntas para timeId:", timeId);
    const snapshot = await db.collection("perguntas").where("timeId", "==", timeId).get();
    if (snapshot.empty) {
      console.warn(`⚠️ Nenhuma pergunta encontrada para timeId: ${timeId}`);
      return [];
    }
    const perguntas = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log("✅ Pergunta encontrada:", data.pergunta);
      perguntas.push({ id: doc.id, ...data });
    });
    return perguntas;
  } catch (error) {
    console.error("❌ Erro ao buscar perguntas:", error);
    return [];
  }
}

async function sortearPergunta() {
  try {
    const perguntasCasa = await buscarPerguntasPorTimeId(timeCasaId);
    const perguntasFora = await buscarPerguntasPorTimeId(timeForaId);

    if (perguntasCasa.length === 0 || perguntasFora.length === 0) {
      alert("Uma das torcidas não possui perguntas cadastradas.");
      return;
    }

    const aleatoriaCasa = perguntasCasa[Math.floor(Math.random() * perguntasCasa.length)];
    const aleatoriaFora = perguntasFora[Math.floor(Math.random() * perguntasFora.length)];

    await db.collection(`chats_jogo/${jogoId}/casa`).add({
      tipo: "pergunta",
      perguntaId: aleatoriaCasa.id,
      dataEnvio: new Date()
    });

    await db.collection(`chats_jogo/${jogoId}/fora`).add({
      tipo: "pergunta",
      perguntaId: aleatoriaFora.id,
      dataEnvio: new Date()
    });

    alert("Perguntas enviadas com sucesso!");
  } catch (e) {
    console.error("Erro ao sortear perguntas:", e);
    alert("Erro ao sortear perguntas.");
  }
}

carregarJogo();
