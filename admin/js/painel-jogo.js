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
      if (msg.tipo === "pergunta") {
        linha.innerHTML = `<i>Pergunta enviada: ${msg.perguntaId}</i>`;
      } else {
        linha.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
      }
      div.appendChild(linha);
    });
  });
}

// Função debug para buscar perguntas por timeId
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

// Sorteia pergunta e envia para os dois times
function sortearEnviarPergunta(time) {
    const idTime = time === 'A' ? jogo.timeCasa.id : jogo.timeVisitante.id;
    const nomeTime = time === 'A' ? jogo.timeCasa.nome : jogo.timeVisitante.nome;

    console.log("🔍 Buscando perguntas para timeId:", idTime);

    db.collection("perguntas")
        .where("timeId", "==", idTime)
        .get()
        .then(snapshot => {
            const perguntas = [];
            snapshot.forEach(doc => {
                perguntas.push({ id: doc.id, ...doc.data() });
            });

            if (perguntas.length === 0) {
                alert(`Nenhuma pergunta encontrada para o time: ${nomeTime}`);
                return;
            }

            const perguntaSorteada = perguntas[Math.floor(Math.random() * perguntas.length)];
            console.log("✅ Pergunta encontrada:", perguntaSorteada.pergunta);

            const perguntaData = {
                ...perguntaSorteada,
                enviadaEm: firebase.firestore.FieldValue.serverTimestamp(),
                jogoId: jogoId,
                enviadaPorAdmin: true
            };

            db.collection("perguntasEnviadas").add(perguntaData);
        })
        .catch(error => {
            console.error("Erro ao buscar perguntas:", error);
            alert("Erro ao buscar perguntas.");
        });
}


carregarJogo();
