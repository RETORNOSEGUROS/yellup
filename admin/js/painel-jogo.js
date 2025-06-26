// painel-jogo.js
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let chartTorcida, chartPontuacao, indexPlaca = 0, placas = [];

async function buscarTimes(timeCasaId, timeForaId) {
  const casaDoc = await db.collection("times").doc(timeCasaId).get();
  const foraDoc = await db.collection("times").doc(timeForaId).get();
  return { casa: casaDoc.data(), fora: foraDoc.data() };
}

async function carregarPainel() {
  const doc = await db.collection("jogos").doc(jogoId).get();
  if (!doc.exists) return alert("Jogo não encontrado!");

  const jogo = doc.data();
  const times = await buscarTimes(jogo.timeCasaId, jogo.timeForaId);
  const inicio = jogo.dataInicio.toDate().toLocaleString("pt-BR");

  document.getElementById("infoCasa").innerText = `${times.casa.nome} - ${times.casa.pais}`;
  document.getElementById("infoFora").innerText = `${times.fora.nome} - ${times.fora.pais}`;
  document.getElementById("infoHorario").innerText = inicio;

  placas = jogo.patrocinadores || [];
  iniciarPlacas();

  iniciarGraficos(times);
  escutarTorcida(jogo.timeCasaId, jogo.timeForaId);
  escutarRanking();
  escutarChats();
  escutarPerguntas();
}

function iniciarPlacas() {
  if (!placas.length) return;
  const div = document.getElementById("placasPatrocinio");
  setInterval(() => {
    const p = placas[indexPlaca % placas.length];
    div.innerHTML = `<a href="${p.site || '#'}" target="_blank"><img src="${p.logo}" alt="patrocinador"></a>`;
    indexPlaca++;
  }, 4000);
}

function iniciarGraficos(times) {
  const ctx1 = document.getElementById("graficoTorcida").getContext("2d");
  chartTorcida = new Chart(ctx1, {
    type: "bar",
    data: {
      labels: [times.casa.nome, times.fora.nome],
      datasets: [{ label: "% Torcedores", data: [0, 0], backgroundColor: ["blue", "red"] }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  const ctx2 = document.getElementById("graficoPontuacao").getContext("2d");
  chartPontuacao = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: [times.casa.nome, times.fora.nome],
      datasets: [{ label: "Pontos", data: [0, 0], backgroundColor: ["blue", "red"] }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

function escutarTorcida(casaId, foraId) {
  db.collection("torcidas").where("jogoId", "==", jogoId)
    .onSnapshot(snapshot => {
      let casa = 0, fora = 0;
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d.time === casaId) casa++;
        if (d.time === foraId) fora++;
      });
      const total = casa + fora || 1;
      chartTorcida.data.datasets[0].data = [casa, fora];
      chartTorcida.update();
    });
}

function escutarRanking() {
  db.collection("respostas").where("jogoId", "==", jogoId)
    .onSnapshot(snapshot => {
      const ranking = {};
      snapshot.forEach(doc => {
        const { userId, pontos } = doc.data();
        ranking[userId] = (ranking[userId] || 0) + pontos;
      });

      const top = Object.entries(ranking).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const tabela = document.querySelector("#tabelaRanking tbody");
      tabela.innerHTML = "";
      top.forEach(([user, pts]) => {
        const linha = document.createElement("tr");
        linha.innerHTML = `<td>${user}</td><td>${pts}</td>`;
        tabela.appendChild(linha);
      });

      // Atualiza grafico de pontuação por time
      Promise.all(top.map(([user]) => db.collection("usuarios").doc(user).get())).then(snapshots => {
        let casa = 0, fora = 0;
        snapshots.forEach(doc => {
          const u = doc.data();
          const pts = ranking[doc.id];
          if (u?.timeId === chartPontuacao.data.labels[0]) casa += pts;
          else if (u?.timeId === chartPontuacao.data.labels[1]) fora += pts;
        });
        chartPontuacao.data.datasets[0].data = [casa, fora];
        chartPontuacao.update();
      });
    });
}

function escutarChats() {
  const chats = ["casa", "fora", "geral"];
  chats.forEach(tipo => {
    db.collection("chats_jogo").where("jogoId", "==", jogoId).where("canal", "==", tipo)
      .orderBy("data")
      .onSnapshot(snapshot => {
        const div = document.getElementById("chat" + tipo.charAt(0).toUpperCase() + tipo.slice(1));
        div.innerHTML = "";
        snapshot.forEach(doc => {
          const { user, mensagem } = doc.data();
          const p = document.createElement("p");
          p.textContent = `${user}: ${mensagem}`;
          div.appendChild(p);
        });
        div.scrollTop = div.scrollHeight;
      });
  });
}

function escutarPerguntas() {
  db.collection("perguntas").where("jogoId", "==", jogoId)
    .orderBy("data", "desc")
    .limit(10)
    .onSnapshot(snapshot => {
      const tabela = document.querySelector("#tabelaPerguntas tbody");
      tabela.innerHTML = "";
      snapshot.forEach(doc => {
        const d = doc.data();
        const linha = document.createElement("tr");
        linha.innerHTML = `<td>${d.texto}</td><td>${d.automatica ? 'Sim' : 'Não'}</td><td>${d.status}</td>`;
        tabela.appendChild(linha);
      });
    });
}

document.addEventListener("DOMContentLoaded", carregarPainel);
