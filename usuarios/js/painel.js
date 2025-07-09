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
if (timeRef.exists) {
  const timeData = timeRef.data();
  document.getElementById("timeCoracao").innerText = timeData.nome;

  // Aplica cores no CSS dinâmico do painel
  document.documentElement.style.setProperty('--cor-primaria', timeData.corPrimaria || '#004aad');
  document.documentElement.style.setProperty('--cor-secundaria', timeData.corSecundaria || '#007bff');
  document.documentElement.style.setProperty('--cor-terciaria', timeData.corTerciaria || '#d9ecff');
} else {
  document.getElementById("timeCoracao").innerText = "Desconhecido";
}

    } catch (e) {
      document.getElementById("timeCoracao").innerText = "Erro";
    }
  } else {
    document.getElementById("timeCoracao").innerText = "---";
  }

  // Link de indicação
  const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;
  document.getElementById("linkConvite").value = link;

  // Carrega jogos do dia
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

  const user = auth.currentUser;
  const userDoc = await db.collection("usuarios").doc(user.uid).get();
  const dados = userDoc.data();
  const torcidas = dados.torcidas || {};

  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const jogoId = doc.id;

    const timeCasa = await db.collection("times").doc(jogo.timeCasaId).get();
    const timeFora = await db.collection("times").doc(jogo.timeForaId).get();

    const nomeCasa = timeCasa.exists ? timeCasa.data().nome : "Time A";
    const nomeFora = timeFora.exists ? timeFora.data().nome : "Time B";
    const status = jogo.status || "indefinido";
    const horario = jogo.dataInicio.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const card = document.createElement("div");
    card.className = "col";

    let html = `
      <div class="card h-100 p-3">
        <h5>${nomeCasa} x ${nomeFora}</h5>
        <p>Horário: <strong>${horario}</strong></p>
        <p>Status: <strong>${status}</strong></p>
    `;

    const torcidaId = torcidas[jogoId];
    if (torcidaId) {
      const timeTorcidaDoc = await db.collection("times").doc(torcidaId).get();
      const nomeTorcida = timeTorcidaDoc.exists ? timeTorcidaDoc.data().nome : "Time escolhido";
      html += `<p class="text-success">Você está torcendo para: <strong>${nomeTorcida}</strong></p>
               <a href="painel-jogo.html?id=${jogoId}" class="btn btn-outline-success">Acessar Partida</a>`;
    } else {
      html += `
        <button class="btn btn-success mb-2" onclick="torcer('${jogoId}', '${jogo.timeCasaId}')">Torcer pelo ${nomeCasa}</button>
        <button class="btn btn-primary" onclick="torcer('${jogoId}', '${jogo.timeForaId}')">Torcer pelo ${nomeFora}</button>
      `;
    }

    html += `</div>`;
    card.innerHTML = html;
    container.appendChild(card);
  }
}

async function torcer(jogoId, timeEscolhidoId) {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = db.collection("usuarios").doc(user.uid);
  const doc = await userRef.get();
  const dados = doc.data();

  if (dados.torcidas && dados.torcidas[jogoId]) {
    alert("Você já escolheu seu time para este jogo.");
    return;
  }

  if ((dados.creditos || 0) < 1) {
    alert("Você não tem créditos suficientes para torcer.");
    return;
  }

  await userRef.update({
    creditos: (dados.creditos || 0) - 1,
    [`torcidas.${jogoId}`]: timeEscolhidoId
  });

  window.location.href = `painel-jogo.html?id=${jogoId}`;
}
