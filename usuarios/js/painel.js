auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html"; // redireciona para login se não estiver logado
    return;
  }

  const uid = user.uid;
  const doc = await db.collection("usuarios").doc(uid).get();

  if (!doc.exists) {
    alert("Usuário não encontrado.");
    return;
  }

  const dados = doc.data();

  document.getElementById("boasVindas").innerText = `Bem-vindo, ${dados.nome}!`;
  document.getElementById("creditos").innerText = dados.creditos || 0;

  // Carrega nome do time do coração a partir do timeId
  if (dados.timeId) {
    try {
      const timeDoc = await db.collection("times").doc(dados.timeId).get();
      if (timeDoc.exists) {
        const time = timeDoc.data();
        document.getElementById("timeCoracao").innerText = time.nome || "Time não encontrado";
      } else {
        document.getElementById("timeCoracao").innerText = "Time não encontrado";
      }
    } catch (erro) {
      console.error("Erro ao buscar time:", erro);
      document.getElementById("timeCoracao").innerText = "Erro ao carregar";
    }
  }

  // Link de indicação
  const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;
  document.getElementById("linkIndicacao").value = link;
});

// Copiar link de indicação
function copiarLink() {
  const input = document.getElementById("linkIndicacao");
  input.select();
  document.execCommand("copy");
  alert("Link copiado!");
}
