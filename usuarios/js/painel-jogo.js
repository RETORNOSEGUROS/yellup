
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let uid = null;
let timeTorcida = null;
let jogo = null;
let perguntaAtual = null;
let respostaEnviada = false;

auth.onAuthStateChanged(async (user) => {
  if (!user) return (window.location.href = "index.html");
  uid = user.uid;

  const userDoc = await db.collection("usuarios").doc(uid).get();
  const userData = userDoc.data();
  timeTorcida = userData.torcidas?.[jogoId];

  if (!timeTorcida) return alert("Você não escolheu um time para torcer.");
  document.getElementById("linkIndicacao").value = `${window.location.origin}/usuarios/cadastro.html?indicadorId=${uid}`;

  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  jogo = jogoDoc.data();

  const timeAData = (await db.collection("times").doc(jogo.timeCasaId).get()).data();
  const timeBData = (await db.collection("times").doc(jogo.timeForaId).get()).data();

  document.getElementById("tituloJogo").innerText = `${timeAData.nome} x ${timeBData.nome}`;
  document.getElementById("timeA").innerText = timeAData.nome;
  document.getElementById("timeB").innerText = timeBData.nome;
  document.getElementById("inicioJogo").innerText = formatarData(jogo.dataInicio.toDate());
  document.getElementById("fimJogo").innerText = formatarData(jogo.dataFim.toDate());
  atualizarTempoRestante(jogo.dataFim.toDate());
  setInterval(() => atualizarTempoRestante(jogo.dataFim.toDate()), 1000);

  escutarPerguntaLiberada();
  escutarChat();
  escutarPontuacaoETorcida();
});

function escutarPerguntaLiberada() {
  db.collection("jogos").doc(jogoId).collection("perguntas_enviadas")
    .orderBy("timestamp", "desc").limit(1)
    .onSnapshot(async (snapshot) => {
      if (snapshot.empty) return;
      const doc = snapshot.docs[0];
      const perguntaId = doc.data().id;
      const perguntaDoc = await db.collection("perguntas").doc(perguntaId).get();
      perguntaAtual = perguntaDoc.data();
      mostrarPergunta(perguntaAtual, doc.data().duracao || 10);
    });
}

function mostrarPergunta(pergunta, duracao) {
  respostaEnviada = false;
  document.getElementById("textoPergunta").innerText = pergunta.texto;
  document.getElementById("opcoesRespostas").innerHTML = "";
  document.getElementById("mensagemResultado").innerText = "";

  for (const letra of ["A", "B", "C", "D"]) {
    const el = document.createElement("button");
    el.className = "list-group-item list-group-item-action";
    el.innerText = `${letra}) ${pergunta[letra]}`;
    el.onclick = () => responder(letra);
    document.getElementById("opcoesRespostas").appendChild(el);
  }

  const barra = document.getElementById("barra");
  barra.style.animation = "none";
  barra.offsetHeight; // reset
  barra.style.animation = `barraTempo ${duracao}s linear forwards`;

  setTimeout(() => {
    if (!respostaEnviada) {
      document.getElementById("mensagemResultado").innerText = "⏰ Tempo esgotado!";
    }
  }, duracao * 1000);
}

async function responder(letra) {
  if (respostaEnviada) return;
  respostaEnviada = true;

  const correta = perguntaAtual.correta;
  const pontuacao = perguntaAtual.pontuacao || 1;
  const acertou = letra === correta;

  document.getElementById("mensagemResultado").innerText = acertou ? "✅ Resposta correta!" : `❌ Errado. Correta: ${correta}) ${perguntaAtual[correta]}`;

  await db.collection("respostas").add({
    jogoId, uid,
    perguntaId: perguntaAtual.id,
    acertou,
    pontuacao: acertou ? pontuacao : 0,
    timeId: timeTorcida,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp()
  });

  if (acertou) {
    await db.collection("usuarios").doc(uid).update({
      [`pontuacoes.${jogoId}`]: firebase.firestore.FieldValue.increment(pontuacao),
      [`xp`]: firebase.firestore.FieldValue.increment(pontuacao)
    });
  }

  await db.collection("usuarios").doc(uid).update({
    creditos: firebase.firestore.FieldValue.increment(-1)
  });
}

function escutarPontuacaoETorcida() {
  db.collection("usuarios").onSnapshot(async (snap) => {
    let ptsA = 0, ptsB = 0, torcA = 0, torcB = 0;
    let ranking = [];

    snap.docs.forEach(doc => {
      const d = doc.data();
      if (!d.torcidas?.[jogoId]) return;

      const pts = d.pontuacoes?.[jogoId] || 0;
      const time = d.torcidas[jogoId];
      if (time === jogo.timeCasaId) {
        torcA++; ptsA += pts;
      } else {
        torcB++; ptsB += pts;
      }

      if (d.nome) ranking.push({ nome: d.nome, pts });
    });

    const totalTorc = torcA + torcB;
    const totalPts = ptsA + ptsB;

    document.getElementById("torcidaA").innerText = torcA;
    document.getElementById("torcidaB").innerText = torcB;
    document.getElementById("porcentagemA").innerText = `${((torcA / totalTorc) * 100 || 0).toFixed(0)}%`;
    document.getElementById("porcentagemB").innerText = `${((torcB / totalTorc) * 100 || 0).toFixed(0)}%`;
    document.getElementById("pontosA").innerText = ptsA;
    document.getElementById("pontosB").innerText = ptsB;
    document.getElementById("porcentagemPontosA").innerText = `${((ptsA / totalPts) * 100 || 0).toFixed(0)}%`;
    document.getElementById("porcentagemPontosB").innerText = `${((ptsB / totalPts) * 100 || 0).toFixed(0)}%`;

    ranking.sort((a, b) => b.pts - a.pts);
    document.getElementById("rankingTorcedores").innerHTML = ranking.slice(0, 10).map(t => `<li class="list-group-item">${t.nome} - ${t.pts} pts</li>`).join("");
  });
}

function atualizarTempoRestante(fim) {
  const agora = new Date();
  const diff = Math.max(0, (fim - agora) / 1000);
  const min = Math.floor(diff / 60);
  const seg = Math.floor(diff % 60);
  document.getElementById("tempoRestante").innerText = `${min}m ${seg}s`;
}

function escutarChat() {
  db.collection("chats_jogo")
    .where("jogoId", "==", jogoId)
    .orderBy("timestamp", "desc").limit(50)
    .onSnapshot((snapshot) => {
      const geral = [];
      const torcida = [];

      snapshot.forEach(doc => {
        const d = doc.data();
        const msg = `<div class="chat-message"><strong>${d.nome || "Anônimo"}:</strong> ${d.mensagem}</div>`;
        if (d.tipo === "geral") geral.push(msg);
        else if (d.timeId === timeTorcida) torcida.push(msg);
      });

      document.getElementById("chatGeral").innerHTML = geral.reverse().join("");
      document.getElementById("chatTime").innerHTML = torcida.reverse().join("");
    });
}

document.getElementById("mensagemGeral").addEventListener("keypress", e => {
  if (e.key === "Enter") enviarMensagem("geral");
});
document.getElementById("mensagemTime").addEventListener("keypress", e => {
  if (e.key === "Enter") enviarMensagem("time");
});

function enviarMensagem(tipo) {
  const input = tipo === "geral" ? "mensagemGeral" : "mensagemTime";
  const mensagem = document.getElementById(input).value.trim();
  if (!mensagem) return;
  db.collection("chats_jogo").add({
    jogoId,
    uid,
    nome: firebase.auth().currentUser.displayName || "Usuário",
    mensagem,
    tipo,
    timeId: timeTorcida,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById(input).value = "";
}

function formatarData(data) {
  return `${data.getHours()}:${String(data.getMinutes()).padStart(2, "0")}`;
}
