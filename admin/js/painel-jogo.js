const db = firebase.firestore();
let jogoId;
let dadosJogo = {};
let times = {};
let patrocinadores = [];
let patrocinadorIndex = 0;

firebase.auth().onAuthStateChanged(user => {
  if (!user) return window.location.href = "/admin/login.html";
  const params = new URLSearchParams(window.location.search);
  jogoId = params.get("id");
  if (!jogoId) return alert("ID do jogo não encontrado na URL.");
  carregarTimes().then(() => carregarJogo());
});

async function carregarTimes() {
  const snap = await db.collection("times").get();
  snap.forEach(doc => times[doc.id] = doc.data().nome);
}

function carregarJogo() {
  db.collection("jogos").doc(jogoId).onSnapshot(doc => {
    dadosJogo = doc.data();
    document.getElementById("nomeTimeCasa").textContent = times[dadosJogo.timeCasa] || "Casa";
    document.getElementById("nomeTimeFora").textContent = times[dadosJogo.timeFora] || "Fora";
    carregarTorcida();
    carregarRanking();
    carregarPatrocinadores();
    carregarChats();
  });
}

function carregarTorcida() {
  db.collection("torcidas").where("jogoId", "==", jogoId).onSnapshot(snapshot => {
    let torcidaCasa = 0, torcidaFora = 0;
    snapshot.forEach(doc => {
      const t = doc.data();
      if (t.timeId === dadosJogo.timeCasa) torcidaCasa++;
      if (t.timeId === dadosJogo.timeFora) torcidaFora++;
    });
    const total = torcidaCasa + torcidaFora;
    const percCasa = total ? ((torcidaCasa / total) * 100).toFixed(1) : 0;
    const percFora = total ? ((torcidaFora / total) * 100).toFixed(1) : 0;

    document.getElementById("torcidaCasa").textContent = `Torcida Time Casa: ${torcidaCasa}`;
    document.getElementById("torcidaFora").textContent = `Torcida Time Visitante: ${torcidaFora}`;
    document.getElementById("percentual").textContent = `Percentuais: Casa ${percCasa}% | Visitante ${percFora}%`;
  });
}

function carregarRanking() {
  db.collection("usuarios").orderBy("pontos", "desc").onSnapshot(snapshot => {
    const tabela = document.getElementById("tabelaRanking");
    tabela.innerHTML = "";
    snapshot.forEach(doc => {
      const u = doc.data();
      if (u.timeId === dadosJogo.timeCasa || u.timeId === dadosJogo.timeFora) {
        const linha = document.createElement("tr");
        linha.innerHTML = `<td>${u.nome}</td><td>${u.pontos}</td>`;
        tabela.appendChild(linha);
      }
    });
  });
}

function carregarPatrocinadores() {
  db.collection("patrocinadores").where("jogoId", "==", jogoId).get().then(snapshot => {
    patrocinadores = [];
    snapshot.forEach(doc => patrocinadores.push(doc.data().logoURL));
    if (patrocinadores.length > 0) trocarLogo();
  });
}

function trocarLogo() {
  const logo = document.getElementById("logoPatrocinador");
  if (patrocinadores.length === 0) return;
  logo.src = patrocinadores[patrocinadorIndex];
  patrocinadorIndex = (patrocinadorIndex + 1) % patrocinadores.length;
  setTimeout(trocarLogo, 5000); // muda a cada 5 segundos
}

function carregarChats() {
  ["geral", "casa", "fora"].forEach(tipo => {
    db.collection("chats_jogo_demo")
      .where("jogoId", "==", jogoId)
      .where("tipo", "==", tipo)
      .orderBy("data", "desc")
      .limit(20)
      .onSnapshot(snapshot => {
        const box = document.getElementById("chat" + tipo.charAt(0).toUpperCase() + tipo.slice(1));
        box.innerHTML = "";
        snapshot.forEach(doc => {
          const m = doc.data();
          const p = document.createElement("p");
          p.textContent = `${m.autor || "Admin"}: ${m.mensagem}`;
          box.appendChild(p);
        });
      });
  });
}

function enviarMensagem(tipo) {
  const campo = document.getElementById("mensagem" + tipo.charAt(0).toUpperCase() + tipo.slice(1));
  const texto = campo.value.trim();
  if (!texto) return;
  db.collection("chats_jogo_demo").add({
    jogoId,
    tipo,
    autor: "Admin",
    mensagem: texto,
    data: new Date()
  });
  campo.value = "";
}
