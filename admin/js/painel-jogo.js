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
  escutarChat(`chats_jogo/${jogoId}/casa`, "chatTimeA");
  escutarChat(`chats_jogo/${jogoId}/fora`, "chatTimeB");
}

function escutarChat(caminho, divId) {
  db.collection(caminho).orderBy("criadoEm").onSnapshot(snapshot => {
    const div = document.getElementById(divId);
    div.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();
      if (msg.tipo === "pergunta" && msg.perguntaId && msg.alternativas) {
        exibirPerguntaNoChat(divId, msg);
      } else {
        const linha = document.createElement("div");
        linha.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
        div.appendChild(linha);
      }
    });
  });
}

async function buscarPerguntasPorTimeId(timeId) {
  const snapshot = await db.collection("perguntas").where("timeId", "==", timeId).get();
  const perguntas = [];
  snapshot.forEach(doc => perguntas.push({ id: doc.id, ...doc.data() }));
  return perguntas;
}

async function sortearPerguntaTime(lado) {
  const timeId = lado === "casa" ? timeCasaId : timeForaId;
  const chatRef = `chats_jogo/${jogoId}/${lado}`;
  const divId = lado === "casa" ? "chatTimeA" : "chatTimeB";

  const perguntas = await buscarPerguntasPorTimeId(timeId);
  if (perguntas.length === 0) {
    alert("Esse time não possui perguntas cadastradas.");
    return;
  }

  const pergunta = perguntas[Math.floor(Math.random() * perguntas.length)];

  await db.collection(chatRef).add({
    tipo: "pergunta",
    perguntaId: pergunta.id,
    texto: pergunta.pergunta,
    alternativas: pergunta.alternativas,
    correta: pergunta.correta,
    criadoEm: new Date()
  });

  exibirPerguntaNoChat(divId, pergunta, true);
}

function exibirPerguntaNoChat(divId, pergunta, animar = false) {
  const div = document.getElementById(divId);
  const bloco = document.createElement("div");
  bloco.className = "pergunta-bloco";

  const perguntaEl = document.createElement("p");
  perguntaEl.innerHTML = `<b>❓ ${pergunta.pergunta || pergunta.texto}</b>`;
  bloco.appendChild(perguntaEl);

  const lista = document.createElement("ul");
  pergunta.alternativas.forEach((alt, i) => {
    const item = document.createElement("li");
    item.textContent = `${String.fromCharCode(65 + i)}) ${alt}`;
    item.style.marginBottom = "5px";
    lista.appendChild(item);
  });
  bloco.appendChild(lista);
  div.appendChild(bloco);

  if (animar) {
    let tempo = 7;
    const timer = document.createElement("p");
    timer.textContent = `⏳ ${tempo}s`;
    bloco.appendChild(timer);

    const intervalo = setInterval(() => {
      tempo--;
      timer.textContent = `⏳ ${tempo}s`;

      if (tempo <= 0) {
        clearInterval(intervalo);
        bloco.innerHTML = `<b>❓ ${pergunta.pergunta || pergunta.texto}</b><br><br>`;
        pergunta.alternativas.forEach((alt, i) => {
          const item = document.createElement("div");
          item.style.color = (i === pergunta.correta ? "gray" : "#ccc");
          item.innerHTML = `${String.fromCharCode(65 + i)}) ${alt}`;
          bloco.appendChild(item);
        });
      }
    }, 1000);
  }
}

carregarJogo();
