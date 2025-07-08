function login() {
  const usuarioUnico = document.getElementById('usuarioUnico').value.trim().toLowerCase();
  const senha = document.getElementById('senha').value;
  const mensagemErro = document.getElementById('mensagem-erro');

  if (!usuarioUnico || !senha) {
    mensagemErro.innerText = "Preencha todos os campos.";
    return;
  }

  db.collection("usuarios").where("usuarioUnico", "==", usuarioUnico).get()
    .then(snapshot => {
      if (snapshot.empty) {
        mensagemErro.innerText = "Usuário não encontrado.";
        return;
      }

      const dados = snapshot.docs[0].data();
      const email = dados.email;

      auth.signInWithEmailAndPassword(email, senha)
        .then(() => {
          window.location.href = "painel.html";
        })
        .catch(error => {
          let msg = "Erro ao entrar.";
          if (error.code === 'auth/wrong-password') msg = "Senha incorreta.";
          mensagemErro.innerText = msg;
        });
    })
    .catch(() => mensagemErro.innerText = "Erro ao buscar usuário.");
}
