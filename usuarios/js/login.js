
document.getElementById("loginForm").addEventListener("submit", async function(e) {
  e.preventDefault();

  const usuarioUnico = document.getElementById("usuarioUnico").value.trim();
  const senha = document.getElementById("senha").value.trim();

  if (!usuarioUnico || !senha) {
    return alert("Preencha todos os campos.");
  }

  try {
    const doc = await db.collection("usuarios").doc(usuarioUnico).get();
    if (!doc.exists) {
      return alert("Usuário não encontrado.");
    }

    const userData = doc.data();
    const email = userData.email;

    await firebase.auth().signInWithEmailAndPassword(email, senha);

    // Salva o usuarioId (document ID) para o painel
    localStorage.setItem("usuarioId", usuarioUnico);
    window.location.href = "painel.html";
  } catch (error) {
    alert("Erro no login: " + error.message);
  }
});
