
firebase.auth().onAuthStateChanged(async function(user) {
  if (user) {
    const email = user.email;
    const snapshot = await db.collection("usuarios").where("email", "==", email).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const usuarioId = doc.id;
      localStorage.setItem("usuarioId", usuarioId);
      window.location.href = "painel.html";
    } else {
      alert("Usuário não encontrado no banco de dados.");
      firebase.auth().signOut();
    }
  }
});

document.getElementById("loginBtn").addEventListener("click", function() {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value.trim();

  if (!email || !senha) return alert("Preencha e-mail e senha.");

  firebase.auth().signInWithEmailAndPassword(email, senha)
    .catch(function(error) {
      alert("Erro no login: " + error.message);
    });
});
