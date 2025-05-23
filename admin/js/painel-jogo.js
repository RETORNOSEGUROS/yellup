const db = firebase.firestore();

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    iniciarPainel();
  }
});

function iniciarPainel() {
  const params = new URLSearchParams(window.location.search);
  const jogoId = params.get("id");
  if (!jogoId) {
    alert("ID do jogo não informado.");
    return;
  }

  carregarDadosDoJogo(jogoId);
  carregarRanking(jogoId);
  carregarChat(jogoId);
  contarTorcida(jogoId);
  carregarPatrocinador(jogoId);
}

function carregarDadosDoJogo(id) {
  db.collection("jogos").doc(id).get().then(doc => {
    const jogo = doc.data();
    if (!jogo) return;

    carregarNomeDoTime(jogo.timeCasa, "timeCasa");
    carregarNomeDoTime(jogo.timeFora, "timeFora");
  });
}

function carregarNomeDoTime(id, elementoId) {
  db.collection("times").doc(id).get().then(doc => {
    const nome = doc.data()?.nome || "Desconhecido";
    document.getElementById(elementoId).innerText = nome;
  });
}

function carregarRanking(jogoId) {
  db.collection("pontuacoes")
    .where("jogoId", "==", jogoId)
    .orderBy("pontos", "desc")
    .limit(10)
    .onSnapshot(snapshot => {
      const tabela = document.getElementById("rankingUsuarios");
      tabela.innerHTML = "";
      snapshot.forEach(doc => {
        const dados = doc.data();
        const linha = document.createElement("tr");
        linha.innerHTML = `<td>${dados.usuario}</td><td>${dados.pontos}</td>`;
        tabela.appendChild(linha);
      });
    });
}

function carregarChat(jogoId) {
  db.collection("chats")
    .where("jogoId", "==", jogoId)
    .orderBy("data", "desc")
    .limit(20)
    .onSnapshot(snapshot => {
      const chatBox = document.getElementById("mensagens");
      chatBox.innerHTML = "";
      const mensagens = [];
      snapshot.forEach(doc => {
        const msg = doc.data();
        mensagens.unshift(`<p><strong>${msg.usuario}:</strong> ${msg.texto}</p>`);
      });
      chatBox.innerHTML = mensagens.join("");
    });
}

function contarTorcida(jogoId) {
  db.collection("torcidas")
    .where("jogoId", "==", jogoId)
    .onSnapshot(snapshot => {
      let casa = 0;
      let fora = 0;

      snapshot.forEach(doc => {
        const t = doc.data();
        if (t.time === "casa") casa++;
        else if (t.time === "fora") fora++;
      });

      document.getElementById("torcidaCasa").innerText = `Torcida Time Casa: ${casa}`;
      document.getElementById("torcidaFora").innerText = `Torcida Time Visitante: ${fora}`;
    });
}

function carregarPatrocinador(jogoId) {
  db.collection("patrocinadores")
    .where("jogoId", "==", jogoId)
    .limit(1)
    .get()
    .then(snapshot => {
      snapshot.forEach(doc => {
        const patrocinador = doc.data();
        if (patrocinador.logoURL) {
          document.getElementById("logoPatrocinador").src = patrocinador.logoURL;
        }
      });
    });
}
