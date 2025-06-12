const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

async function buscarNomeTime(id) {
  if (!id) return "Desconhecido";
  const doc = await db.collection("times").doc(id).get();
  return doc.exists ? doc.data().nome : "Desconhecido";
}

async function carregarPainel() {
  const doc = await db.collection("jogos").doc(jogoId).get();
  if (!doc.exists) {
    alert("Jogo não encontrado!");
    return;
  }

  const jogo = doc.data();

  document.getElementById("nomeTimeCasa").innerText = await buscarNomeTime(jogo.timeCasa);
  document.getElementById("nomeTimeVisitante").innerText = await buscarNomeTime(jogo.timeFora);

  atualizarTorcida(jogo.timeCasa, jogo.timeFora);
  atualizarRanking();
  atualizarChat();
}

function atualizarTorcida(timeCasaId, timeVisitanteId) {
  db.collection("torcidas").where("jogoId", "==", jogoId)
    .onSnapshot(snapshot => {
      let casa = 0, visitante = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.time === timeCasaId) casa++;
        if (data.time === timeVisitanteId) visitante++;
      });
      document.getElementById("torcidaCasa").innerText = casa;
      document.getElementById("torcidaVisitante").innerText = visitante;
    });
}

function atualizarRanking() {
  db.collection("respostas").where("jogoId", "==", jogoId)
    .onSnapshot(snapshot => {
      const ranking = {};
      snapshot.forEach(doc => {
        const { userId, pontos } = doc.data();
        if (!ranking[userId]) ranking[userId] = 0;
        ranking[userId] += pontos;
      });

      const tabela = document.getElementById("tabelaRanking");
      tabela.innerHTML = "";
      Object.entries(ranking)
        .sort((a, b) => b[1] - a[1])
        .forEach(([user, pts]) => {
          const linha = document.createElement("tr");
          linha.innerHTML = `<td>${user}</td><td>${pts}</td>`;
          tabela.appendChild(linha);
        });
    });
}

function atualizarChat() {
  db.collection("chats_jogo_demo").where("jogoId", "==", jogoId)
    .orderBy("data")
    .onSnapshot(snapshot => {
      const chatBox = document.getElementById("chat");
      chatBox.innerHTML = "";
      snapshot.forEach(doc => {
        const { user, mensagem, data } = doc.data();
        const p = document.createElement("p");
        p.innerText = `${user}: ${mensagem}`;
        chatBox.appendChild(p);
      });
      chatBox.scrollTop = chatBox.scrollHeight;
    });
}

document.addEventListener("DOMContentLoaded", carregarPainel);
