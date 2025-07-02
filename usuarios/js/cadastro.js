
document.getElementById("cadastroForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  const nome = document.getElementById("nome").value;
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;
  const usuarioUnico = email.split('@')[0];

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    await db.collection("usuarios").doc(usuarioUnico).set({
      nome: nome,
      email: email,
      usuario: usuarioUnico,
      usuarioUnico: usuarioUnico,
      status: "ativo",
      creditos: 0,
      timeId: "",
      pais: "",
      estado: "",
      cidade: "",
      celular: "",
      dataCadastro: new Date()
    });
    alert("Conta criada com sucesso!");
    window.location.href = "index.html";
  } catch (error) {
    alert("Erro: " + error.message);
  }
});
