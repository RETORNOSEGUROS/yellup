
firebase.auth().onAuthStateChanged(function(user) {
  if (user) {
    const userId = user.uid;
    db.collection("usuarios").doc(userId).get().then(function(doc) {
      if (doc.exists) {
        const data = doc.data();
        document.getElementById("nomeUsuario").textContent = data.nome || "Usuário";
        document.getElementById("timeCoracao").textContent = data.timeId || "---";
        document.getElementById("pontuacao").textContent = data.pontuacao || 0;
        document.getElementById("creditos").textContent = data.creditos || 0;

        const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${userId}`;
        document.getElementById("linkIndicacao").value = link;

        document.getElementById("btnCopiarLink").addEventListener("click", function() {
          const input = document.getElementById("linkIndicacao");
          input.select();
          document.execCommand("copy");
        });
      }
    });
  } else {
    alert("Usuário não identificado. Faça login novamente.");
    window.location.href = "index.html";
  }
});
