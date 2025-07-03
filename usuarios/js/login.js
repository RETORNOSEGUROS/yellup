
document.getElementById("loginForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  const usuarioUnico = document.getElementById("usuarioUnico").value;
  const senha = document.getElementById("senha").value;

  try {
    const snap = await firebase.firestore().collection("usuarios")
      .where("usuarioUnico", "==", usuarioUnico)
      .limit(1)
      .get();

    if (snap.empty) return alert("Usuário não encontrado");

    const userData = snap.docs[0].data();
    const email = userData.email;

    await firebase.auth().signInWithEmailAndPassword(email, senha);
    alert("Login realizado com sucesso!");
    window.location.href = "/usuarios/painel.html";
  } catch (error) {
    alert("Erro: " + error.message);
  }
});
