
document.getElementById("cadastroForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const nome = document.getElementById("nome").value;
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;
  const celular = document.getElementById("celular").value;
  const cidade = document.getElementById("cidade").value;
  const estado = document.getElementById("estado").value;
  const pais = document.getElementById("pais").value;
  const dataNascimento = document.getElementById("dataNascimento").value;
  const timeId = document.getElementById("timeId").value;

  firebase.auth().createUserWithEmailAndPassword(email, senha)
    .then((userCredential) => {
      const uid = userCredential.user.uid;
      const agora = new Date();
      return db.collection("usuarios").doc(uid).set({
        nome: nome,
        email: email,
        celular: celular,
        cidade: cidade,
        estado: estado,
        pais: pais,
        dataNascimento: dataNascimento,
        timeId: timeId,
        dataCadastro: agora,
        status: "ativo",
        creditos: 0,
        indicadoPor: "-",
        usuario: email.split("@")[0],
        usuarioUnico: email.split("@")[0]
      });
    })
    .then(() => {
      alert("Usuário criado com sucesso!");
      window.location.href = "index.html";
    })
    .catch((error) => {
      alert("Erro: " + error.message);
    });
});
