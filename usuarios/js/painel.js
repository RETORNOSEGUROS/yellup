document.addEventListener("DOMContentLoaded", async function () {
  const auth = firebase.auth();
  const db = firebase.firestore();

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const userId = user.uid;
      const userRef = db.collection("usuarios").doc(userId);
      const doc = await userRef.get();
      if (doc.exists) {
        const data = doc.data();
        document.getElementById("nomeUsuario").innerText = data.nome || "Usuário";
        document.getElementById("timeUsuario").innerText = data.timeId || "";
        document.getElementById("creditosUsuario").innerText = data.creditos || 0;
        document.getElementById("pontuacaoUsuario").innerText = data.pontuacaoAcumulada || 0;
        gerarLinkIndicacao(userId);
      }
    } else {
      alert("Usuário não identificado. Faça login novamente.");
      window.location.href = "index.html";
    }
  });

  function gerarLinkIndicacao(userId) {
    const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${userId}`;
    document.getElementById("linkIndicacao").value = link;
    document.getElementById("copiarLinkBtn").addEventListener("click", function () {
      navigator.clipboard.writeText(link).then(() => {
        alert("Link copiado!");
      });
    });
  }
});
