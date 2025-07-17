const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
let uid = null;
let timeTorcida = null;
let respostaEnviada = false;
let perguntaAtual = null;
let jogo = null;
let temporizadorResposta = null;

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return (window.location.href = "/usuarios/index.html");
  uid = user.uid;

  const userDoc = await db.collection("usuarios").doc(uid).get();
  const dados = userDoc.data();
  const nome = dados.usuario || "Torcedor";
  const creditos = dados.creditos ?? 0;
  timeTorcida = dados.torcidas?.[jogoId];
  if (!timeTorcida) return alert("Você não escolheu um time para torcer.");

  document.getElementById("infoUsuario").innerText = `👤 ${nome} | 💳 Créditos: ${creditos}`;

  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  jogo = jogoDoc.data();

  const timeA = await db.collection("times").doc(jogo.timeCasaId).get();
  const timeB = await db.collection("times").doc(jogo.timeForaId).get();

  const dadosA = timeA.data();
  const dadosB = timeB.data();

  const nomeA = dadosA.nome;
  const nomeB = dadosB.nome;

  // Cores completas (3 tons)
  const corA1 = dadosA.primaria || "#28a745";
  const corA2 = dadosA.secundaria || corA1;
  const corA3 = dadosA.terciaria || corA1;
  const corB1 = dadosB.primaria || "#dc3545";
  const corB2 = dadosB.secundaria || corB1;
  const corB3 = dadosB.terciaria || corB1;

  // Aplica nomes
  document.getElementById("tituloJogo").innerText = `${nomeA} x ${nomeB}`;
  document.getElementById("timeA").innerText = nomeA;
  document.getElementById("timeB").innerText = nomeB;

  // Aplica gradiente nos nomes
  document.getElementById("timeA").style.background = `linear-gradient(45deg, ${corA1}, ${corA2}, ${corA3})`;
  document.getElementById("timeB").style.background = `linear-gradient(45deg, ${corB1}, ${corB2}, ${corB3})`;

  // Variáveis CSS para barras
  document.documentElement.style.setProperty("--corA1", corA1);
  document.documentElement.style.setProperty("--corB1", corB1);
  document.documentElement.style.setProperty("--corA2", corA2);
  document.documentElement.style.setProperty("--corB2", corB2);

  document.getElementById("inicioJogo").innerText = formatarData(jogo.dataInicio.toDate());
  document.getElementById("fimJogo").innerText = formatarData(jogo.dataFim.toDate());

  atualizarTempoRestante(jogo.dataFim.toDate());
  setInterval(() => atualizarTempoRestante(jogo.dataFim.toDate()), 1000);

  calcularTorcida();
  calcularPontuacao();
  iniciarChat();
  montarRanking();
});

function formatarData(data) {
  return data.toLocaleString("pt-BR", { hour: '2-digit', minute: '2-digit' });
}

function atualizarTempoRestante(fim) {
  const agora = new Date();
  const diff = Math.max(0, fim - agora);
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  document.getElementById("tempoRestante").innerText = `${min}m ${sec}s`;
}

async function calcularTorcida() {
  const usuarios = await db.collection("usuarios").get();
  let a = 0, b = 0;
  usuarios.forEach(doc => {
    const t = doc.data().torcidas?.[jogoId];
    if (t === jogo.timeCasaId) a++;
    if (t === jogo.timeForaId) b++;
  });
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 0;
  const pb = total ? 100 - pa : 0;
  document.getElementById("torcidaA").innerText = a;
  document.getElementById("torcidaB").innerText = b;
  document.getElementById("porcentagemA").innerText = `${pa}%`;
  document.getElementById("porcentagemB").innerText = `${pb}%`;

  document.getElementById("barraTorcidaA").style.width = `${pa}%`;
  document.getElementById("barraTorcidaB").style.width = `${pb}%`;
}

async function responderPergunta() {
  const respondidasSnap = await db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("userId", "==", uid)
    .get();
  const respondidasIds = respondidasSnap.docs.map(doc => doc.data().perguntaId);

  const snap = await db.collection("perguntas").where("timeId", "==", timeTorcida).get();
  const todas = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const filtradas = todas.filter(p => !respondidasIds.includes(p.id));
  if (filtradas.length === 0) return alert("Você já respondeu todas as perguntas.");

  const pergunta = filtradas[Math.floor(Math.random() * filtradas.length)];
  mostrarPergunta(pergunta);
}

function mostrarPergunta(p) {
  perguntaAtual = p;
  respostaEnviada = false;
  document.getElementById("textoPergunta").innerText = p.pergunta || p.texto || "Pergunta não encontrada";
  document.getElementById("opcoesRespostas").innerHTML = "";
  document.getElementById("mensagemResultado").innerText = "";

  const alternativas = p.alternativas || {};
  ["A", "B", "C", "D"].forEach(letra => {
    const textoAlt = alternativas[letra] || "Indefinido";
    const btn = document.createElement("button");
    btn.className = "list-group-item list-group-item-action";
    btn.innerText = textoAlt;
    btn.onclick = () => responder(letra, p.correta, p.pontuacao || 1, p.id);
    document.getElementById("opcoesRespostas").appendChild(btn);
  });

  iniciarContador();
}

function iniciarContador() {
  const barra = document.getElementById("barra");
  barra.style.display = "block";
  barra.style.animation = "none";
  barra.offsetHeight; // força reflow
  barra.style.animation = "barraTempo 9s linear forwards";

  temporizadorResposta = setTimeout(() => {
    if (!respostaEnviada) {
      document.getElementById("mensagemResultado").innerText = "⏱️ Tempo esgotado!";
      desabilitarOpcoes();
      pararContador();
    }
  }, 9000);
}

function pararContador() {
  if (temporizadorResposta) clearTimeout(temporizadorResposta);
  temporizadorResposta = null;
  const barra = document.getElementById("barra");
  barra.style.animation = "none";
  barra.offsetHeight;
  barra.style.display = "none";
}

function desabilitarOpcoes() {
  document.querySelectorAll("#opcoesRespostas button").forEach(btn => btn.disabled = true);
}

async function responder(letra, correta, pontos, perguntaId) {
  if (respostaEnviada) return;
  respostaEnviada = true;
  pararContador();
  const acertou = letra === correta;
  document.getElementById("mensagemResultado").innerText = acertou
    ? "✅ Resposta correta!"
    : `❌ Errado. Correta: ${correta}`;

  await db.collection("respostas").add({
    jogoId,
    perguntaId,
    userId: uid,
    timeId: timeTorcida,
    resposta: letra,
    correta,
    acertou,
    pontuacao: acertou ? pontos : 0,
    timestamp: new Date()
  });

  if (acertou) {
    await db.collection("usuarios").doc(uid).update({
      [`pontuacoes.${jogoId}`]: firebase.firestore.FieldValue.increment(pontos),
      xp: firebase.firestore.FieldValue.increment(pontos)
    });
  }

  await db.collection("usuarios").doc(uid).update({
    creditos: firebase.firestore.FieldValue.increment(-1)
  });

  // Atualizar créditos em tempo real
  const infoUsuario = document.getElementById("infoUsuario");
  const regex = /💳 Créditos: (\d+)/;
  const atual = parseInt(infoUsuario.innerText.match(regex)?.[1] || "0", 10);
  infoUsuario.innerText = infoUsuario.innerText.replace(regex, `💳 Créditos: ${atual - 1}`);

  calcularPontuacao();
  montarRanking();
  desabilitarOpcoes();
}

async function calcularPontuacao() {
  const respostas = await db.collection("respostas").where("jogoId", "==", jogoId).get();
  let a = 0, b = 0;
  respostas.forEach(doc => {
    const r = doc.data();
    if (!r.acertou) return;
    if (r.timeId === jogo.timeCasaId) a += r.pontuacao || 1;
    if (r.timeId === jogo.timeForaId) b += r.pontuacao || 1;
  });
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 0;
  const pb = total ? 100 - pa : 0;
  document.getElementById("pontosA").innerText = a;
  document.getElementById("pontosB").innerText = b;
  document.getElementById("porcentagemPontosA").innerText = `${pa}%`;
  document.getElementById("porcentagemPontosB").innerText = `${pb}%`;

  document.getElementById("barraPontosA").style.width = `${pa}%`;
  document.getElementById("barraPontosB").style.width = `${pb}%`;
}

function iniciarChat() {
  db.collection("chat")
    .where("jogoId", "==", jogoId)
    .orderBy("timestamp")
    .onSnapshot(snapshot => {
      const chatGeral = document.getElementById("chatGeral");
      const chatTime = document.getElementById("chatTime");
      chatGeral.innerHTML = "";
      chatTime.innerHTML = "";

      snapshot.forEach(async doc => {
        const msg = doc.data();
        const user = await db.collection("usuarios").doc(msg.userId).get();
        const nome = user.exists ? user.data().usuario : "Torcedor";
        const avatar = user.exists && user.data().avatarUrl
          ? user.data().avatarUrl
          : "https://i.imgur.com/DefaultAvatar.png";

        const el = `
          <div class='chat-message'>
            <img src="${avatar}" alt="avatar">
            <strong>${nome}:</strong> ${msg.texto}
          </div>
        `;
        if (msg.tipo === "geral") chatGeral.innerHTML += el;
        if (msg.tipo === "time" && msg.timeId === timeTorcida) chatTime.innerHTML += el;
      });

      
// Scroll controlado – só desce se estiver no final
setTimeout(() => {
  chatGeral.scrollTop = chatGeral.scrollHeight;
  chatTime.scrollTop = chatTime.scrollHeight;
}, 100);

    });

  document.getElementById("mensagemGeral").addEventListener("keydown", e => {
    if (e.key === "Enter") enviarMensagem("geral");
  });
  document.getElementById("mensagemTime").addEventListener("keydown", e => {
    if (e.key === "Enter") enviarMensagem("time");
  });
}

function enviarMensagem(tipo) {
  const input = document.getElementById(tipo === "geral" ? "mensagemGeral" : "mensagemTime");
  const texto = input.value.trim();
  if (!texto) return;
  if (texto.length > 300) return alert('Limite de 300 caracteres.');
  input.value = "";

  db.collection("usuarios").doc(uid).get().then(doc => {
    const nome = doc.data().usuario || "Torcedor";
    db.collection("chat").add({
      jogoId,
      timeId: timeTorcida,
      tipo,
      userId: uid,
      nome,
      texto,
      timestamp: new Date()
    });
  });
}

function montarRanking() {
  db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("acertou", "==", true)
    .get()
    .then(async snap => {
      const ranking = {};
      snap.forEach(doc => {
        const r = doc.data();
        if (!ranking[r.userId]) ranking[r.userId] = 0;
        ranking[r.userId] += r.pontuacao || 1;
      });
      const lista = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const container = document.getElementById("rankingPontuacao");
      container.innerHTML = "";
      for (const [userId, pontos] of lista) {
        const user = await db.collection("usuarios").doc(userId).get();
        const nome = user.exists ? user.data().usuario : "Torcedor";
        const avatar = user.exists && user.data().avatarUrl
          ? user.data().avatarUrl
          : "https://i.imgur.com/DefaultAvatar.png";
        container.innerHTML += `
          <li class='list-group-item d-flex align-items-center gap-2'>
            <img src='${avatar}' class='avatar-ranking'>
            <span>${nome} - ${pontos} pts</span>
          </li>`;
      }
    });
}
