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

  // Carregar nome do time do coração
  if (dados.timeId) {
    try {
      const timeRef = db.collection("times").doc(dados.timeId);
      const timeSnap = await timeRef.get();
      if (timeSnap.exists) {
        const timeData = timeSnap.data();
        const nomeTime = timeData.nome || "(sem nome cadastrado)";
        document.getElementById("timeCoracao").innerText = nomeTime;
      } else {
        document.getElementById("timeCoracao").innerText = "Time não encontrado";
      }
    } catch (e) {
      console.error("Erro ao buscar time:", e);
      document.getElementById("timeCoracao").innerText = "Erro ao carregar";
    }
  } else {
    document.getElementById("timeCoracao").innerText = "---";
  }

  // Link de convite
  const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;
  document.getElementById("linkConvite").value = link;
});

function copiarLink() {
  const input = document.getElementById("linkConvite");
  input.select();
  document.execCommand("copy");
  alert("Link copiado!");
}
