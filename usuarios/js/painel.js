auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const uid = user.uid;
  const doc = await db.collection("usuarios").doc(uid).get();

  if (!doc.exists) {
    alert("Usuário não encontrado.");
    return;
  }

  const dados = doc.data();

  document.getElementById("nomeUsuario").innerText = dados.nome || "Usuário";
  document.getElementById("creditos").innerText = dados.creditos || 0;
  document.getElementById("pontuacao").innerText = dados.pontuacao || 0;

  // Carrega nome do time do coração
  if (dados.timeId) {
    try {
      const timeRef = await db.collection("times").doc(dados.timeId).get();
      const timeNome = timeRef.exists ? timeRef.data().nome : "Desconhecido";
      document.getElementById("timeCoracao").innerText = timeNome;
    } catch (e) {
      document.getElementById("timeCoracao").innerText = "Erro";
    }
  } else {
    document.getElementById("timeCoracao").innerText = "---";
  }

  // Link de indicação
  const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;
  document.getElementById("linkConvite").value = link;

  // Chamar jogos do dia
  carregarJogosDoDia();
});

function copiarLink() {
  const input = document.getElementById("linkConvite");
  input.select();
  document.execCommand("copy");
  alert("Link copiado!");
}

async function carregarJogosDoDia() {
  const container = document.getElementById("jogosLista");
  container.innerHTML = "<p>Carregando jogos...</p>";

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const amanha = new Date();
  amanha.setHours(23, 59, 59, 999);

  const snapshot = await db.collection("jogos")
    .where("dataInicio", ">=", hoje)
    .where("dataInicio", "<=", amanha)
    .get();

  if (snapshot.empty) {
    container.innerHTML = "<p>Nenhum jogo marcado para hoje.</p>";
    return;
  }

  container.innerHTML = "";

  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const jogoId = doc.id;

    const timeCasa = await db.collection("times").doc(jogo.timeCasaId).get();
    const timeFora = await db.collection("times").doc(jogo.timeForaId).get();

    const nomeCasa = timeCasa.exists ? timeCasa.data().nome : "Time A";
    const nomeFora = timeFora.exists ? timeFora.data().nome : "Time B";
    const status = jogo.status || "indefinido";

    const card = document.createElement("div");
    card.className = "col";

    card.innerHTML = `
      <div class="card h-100 p-3">
        <h5>${nomeCasa} x ${nomeFora}</h5>
        <p>Status: <strong>${status}</strong></p>
        <button class="btn btn-success mb-2" onclick="torcer('${jogoId}', '${jogo.timeCasaId}')">Torcer pelo ${nomeCasa}</button>
        <button class="btn btn-primary" onclick="torcer('${jogoId}', '${jogo.timeForaId}')">Torcer pelo ${nomeFora}</button>
      </div>
    `;

    container.appendChild(card);
  }
}

async function torcer(jogoId, timeEscolhidoId) {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = db.collection("usuarios").doc(user.uid);
  const doc = await userRef.get();
  const dados = doc.data();

  if ((dados.creditos || 0) < 1) {
    alert("Você não tem créditos suficientes para torcer.");
    return;
  }

  // Desconta 1 crédito e salva o time escolhido
  await userRef.update({
    creditos: (dados.creditos || 0) - 1,
    [`torcidas.${jogoId}`]: timeEscolhidoId
  });

  window.location.href = `painel-jogo.html?id=${jogoId}`;
}
