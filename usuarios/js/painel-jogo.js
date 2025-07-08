// painel-jogo.js

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SUA_AUTH_DOMAIN",
  projectId: "SUA_PROJECT_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let jogoId = new URLSearchParams(window.location.search).get("id");
let usuarioLogado = null;
let jogoDoc = null;
let timeEscolhido = null;
let unsubscribeChatGeral = null;
let unsubscribeChatTime = null;

firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    const doc = await db.collection("usuarios").doc(user.uid).get();
    usuarioLogado = { id: doc.id, ...doc.data() };
    timeEscolhido = usuarioLogado.timeId;
    carregarJogo();
  } else {
    window.location.href = "/usuarios/index.html";
  }
});

async function carregarJogo() {
  const doc = await db.collection("jogos").doc(jogoId).get();
  jogoDoc = doc.data();

  const timeA = await db.collection("times").doc(jogoDoc.timeCasaId).get();
  const timeB = await db.collection("times").doc(jogoDoc.timeForaId).get();
  document.getElementById("timeA").innerText = timeA.data().nome;
  document.getElementById("timeB").innerText = timeB.data().nome;
  document.getElementById("tituloJogo").innerText = `${timeA.data().nome} x ${timeB.data().nome}`;

  atualizarCabecalhoJogo();
  atualizarChat();
  exibirPergunta();
  atualizarRanking();
}

function atualizarCabecalhoJogo() {
  const inicio = jogoDoc.dataInicio.toDate();
  const fim = jogoDoc.dataFim.toDate();
  const agora = new Date();
  const restante = Math.max(0, Math.floor((fim - agora) / 1000));

  document.getElementById("inicioJogo").innerText = inicio.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  document.getElementById("fimJogo").innerText = fim.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  document.getElementById("tempoRestante").innerText = `${Math.floor(restante / 60)}m ${restante % 60}s`;

  setTimeout(atualizarCabecalhoJogo, 1000);
}

function atualizarChat() {
  if (unsubscribeChatGeral) unsubscribeChatGeral();
  if (unsubscribeChatTime) unsubscribeChatTime();

  unsubscribeChatGeral = db.collection("chats_jogo")
    .where("jogoId", "==", jogoId)
    .where("tipo", "==", "geral")
    .orderBy("data", "desc")
    .limit(20)
    .onSnapshot((snapshot) => {
      const chat = document.getElementById("chatGeral");
      chat.innerHTML = "";
      snapshot.forEach((doc) => {
        chat.innerHTML += `<div class='chat-message'><strong>${doc.data().nome}:</strong> ${doc.data().mensagem}</div>`;
      });
    });

  unsubscribeChatTime = db.collection("chats_jogo")
    .where("jogoId", "==", jogoId)
    .where("tipo", "==", timeEscolhido)
    .orderBy("data", "desc")
    .limit(20)
    .onSnapshot((snapshot) => {
      const chat = document.getElementById("chatTime");
      chat.innerHTML = "";
      snapshot.forEach((doc) => {
        chat.innerHTML += `<div class='chat-message'><strong>${doc.data().nome}:</strong> ${doc.data().mensagem}</div>`;
      });
    });
}

document.getElementById("mensagemGeral").addEventListener("keypress", function(e) {
  if (e.key === "Enter") enviarMensagem("geral");
});

document.getElementById("mensagemTime").addEventListener("keypress", function(e) {
  if (e.key === "Enter") enviarMensagem("time");
});

function enviarMensagem(tipo) {
  const input = tipo === "geral" ? document.getElementById("mensagemGeral") : document.getElementById("mensagemTime");
  const msg = input.value.trim();
  if (msg === "") return;

  db.collection("chats_jogo").add({
    jogoId,
    tipo: tipo === "geral" ? "geral" : timeEscolhido,
    nome: usuarioLogado.nome,
    mensagem: msg,
    data: new Date(),
    userId: usuarioLogado.id
  });

  input.value = "";
}

function exibirPergunta() {
  const campoOrdem = timeEscolhido === jogoDoc.timeCasaId ? "ordemPerguntasCasa" : "ordemPerguntasFora";
  const indice = timeEscolhido === jogoDoc.timeCasaId ? jogoDoc.indicePerguntaCasa : jogoDoc.indicePerguntaFora;
  const idPergunta = jogoDoc[campoOrdem][indice];
  if (!idPergunta) return;

  db.collection("perguntas").doc(idPergunta).get().then(doc => {
    const dados = doc.data();
    document.getElementById("textoPergunta").innerText = dados.texto;
    const opcoes = document.getElementById("opcoesRespostas");
    opcoes.innerHTML = "";

    ["A", "B", "C", "D"].forEach(letra => {
      const item = document.createElement("button");
      item.className = "list-group-item list-group-item-action";
      item.innerText = `${letra}) ${dados[letra]}`;
      item.onclick = () => responder(letra, dados);
      opcoes.appendChild(item);
    });
  });
}

function responder(letra, dadosPergunta) {
  const correta = dadosPergunta.correta;
  const resultado = document.getElementById("mensagemResultado");
  const acertou = letra === correta;

  resultado.innerHTML = acertou ? "<span class='text-success'>✅ Resposta correta!</span>" : "<span class='text-danger'>❌ Resposta errada!</span>";

  db.collection("respostas").add({
    jogoId,
    userId: usuarioLogado.id,
    timeId: timeEscolhido,
    perguntaId: dadosPergunta.id,
    correta: acertou,
    pontos: acertou ? dadosPergunta.pontuacao : 0,
    data: new Date()
  });
}

function atualizarRanking() {
  db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .orderBy("pontos", "desc")
    .onSnapshot(snapshot => {
      const ranking = {};
      snapshot.forEach(doc => {
        const { userId, pontos } = doc.data();
        if (!ranking[userId]) ranking[userId] = 0;
        ranking[userId] += pontos;
      });

      const usuariosOrdenados = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const divRanking = document.getElementById("ranking");
      divRanking.innerHTML = "<h6>Ranking dos Torcedores</h6><ol>" + usuariosOrdenados.map(([id, pontos]) => `<li>${id} - ${pontos} pts</li>`).join('') + "</ol>";
    });
}
