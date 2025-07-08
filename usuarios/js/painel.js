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
});

function copiarLink() {
  const input = document.getElementById("linkConvite");
  input.select();
  document.execCommand("copy");
  alert("Link copiado!");
}
