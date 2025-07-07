
async function carregarPainel() {
  const usuarioId = localStorage.getItem("usuarioId");
  if (!usuarioId) return alert("Usuário não identificado. Faça login novamente.");

  const doc = await db.collection("usuarios").doc(usuarioId).get();
  if (!doc.exists) return alert("Usuário não encontrado.");

  const user = doc.data();

  document.getElementById("nomeUsuario").textContent = "Bem-vindo, " + (user.nome || "usuário") + "!";
  document.getElementById("creditosUsuario").textContent = user.creditos || 0;
  document.getElementById("pontuacaoAcumulada").textContent = user.pontuacao || 0;
  document.getElementById("avatar").src = user.avatarUrl || "https://www.gravatar.com/avatar/?d=mp";

  if (user.timeId) {
    const timeDoc = await db.collection("times").doc(user.timeId).get();
    if (timeDoc.exists) {
      const time = timeDoc.data();
      document.getElementById("timeUsuario").textContent = "Time do Coração: " + time.nome;
    }
  }

  const baseUrl = window.location.origin + "/usuarios/cadastro.html?indicador=" + user.usuarioUnico;
  const linkInput = document.getElementById("linkIndicacao");
  if (linkInput) linkInput.value = baseUrl;

  // Troféus
  const trofeus = user.trofeus || [];
  const listaTrofeus = document.getElementById("trofeusUsuario");
  listaTrofeus.innerHTML = "";
  if (trofeus.length > 0) {
    trofeus.forEach(t => {
      const li = document.createElement("li");
      li.textContent = t;
      listaTrofeus.appendChild(li);
    });
  } else {
    listaTrofeus.innerHTML = "<li>Nenhum troféu ainda.</li>";
  }

  // Histórico de partidas
  const partidasSnap = await db.collection("usuarios").doc(usuarioId).collection("pontuacoes").orderBy("data", "desc").limit(5).get();
  const listaHistorico = document.getElementById("historicoPartidas");
  listaHistorico.innerHTML = "";
  if (!partidasSnap.empty) {
    partidasSnap.forEach(doc => {
      const p = doc.data();
      const li = document.createElement("li");
      li.textContent = (p.jogo || "Partida") + " - " + (p.pontos || 0) + " pontos";
      listaHistorico.appendChild(li);
    });
  } else {
    listaHistorico.innerHTML = "<li>Nenhuma partida registrada.</li>";
  }
}

function copiarLink() {
  const input = document.getElementById("linkIndicacao");
  input.select();
  input.setSelectionRange(0, 99999);
  document.execCommand("copy");
  alert("Link copiado!");
}

document.addEventListener("DOMContentLoaded", carregarPainel);
