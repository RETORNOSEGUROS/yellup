
document.getElementById("cadastroForm").addEventListener("submit", async function(e) {
  e.preventDefault();

  const usuarioUnico = document.getElementById("usuarioUnico").value.trim();
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value.trim();
  const nome = document.getElementById("nome").value.trim();
  const celular = document.getElementById("celular").value.trim();
  const cidade = document.getElementById("cidade").value.trim();
  const estado = document.getElementById("estado").value.trim();
  const pais = document.getElementById("pais").value.trim();
  const timeId = document.getElementById("timeId").value;

  if (!usuarioUnico || !email || !senha || !nome || !cidade || !estado || !pais || !timeId) {
    return alert("Preencha todos os campos.");
  }

  const docRef = db.collection("usuarios").doc(usuarioUnico);
  const doc = await docRef.get();
  if (doc.exists) {
    return alert("Usuário já existente. Escolha outro nome de usuário.");
  }

  try {
    await firebase.auth().createUserWithEmailAndPassword(email, senha);

    const dados = {
      usuarioUnico,
      email,
      nome,
      celular,
      cidade,
      estado,
      pais,
      timeId,
      creditos: 50,
      status: "ativo",
      dataCadastro: firebase.firestore.Timestamp.now()
    };

    await docRef.set(dados);
    alert("Cadastro realizado com sucesso!");
    window.location.href = "index.html";
  } catch (err) {
    alert("Erro no cadastro: " + err.message);
  }
});
