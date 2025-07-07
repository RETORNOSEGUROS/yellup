document.getElementById("loginForm").addEventListener("submit", async function(e) {
  e.preventDefault();

  const usuarioUnico = document.getElementById("usuarioUnico").value.trim();
  const senha = document.getElementById("senha").value.trim();

  if (!usuarioUnico || !senha) {
    return alert("Preencha todos os campos.");
  }

  try {
    const querySnapshot = await db.collection("usuarios")
      .where("usuarioUnico", "==", usuarioUnico)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      return alert("Usuário não encontrado.");
    }

    const doc = querySnapshot.docs[0];
    const email = doc.data().email;

    await firebase.auth().signInWithEmailAndPassword(email, senha);

    localStorage.setItem("usuarioId", doc.id); // <- ID real do documento aleatório
    window.location.href = "painel.html";
  } catch (error) {
    alert("Erro no login: " + error.message);
  }
});
