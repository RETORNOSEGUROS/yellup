function login() {
  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value.trim();
  const mensagemErro = document.getElementById('mensagem-erro');

  if (!email || !senha) {
    mensagemErro.innerText = "Preencha todos os campos.";
    return;
  }

  auth.signInWithEmailAndPassword(email, senha)
    .then((userCredential) => {
      window.location.href = 'painel.html';
    })
    .catch((error) => {
      let msg = "Erro ao fazer login.";
      if (error.code === 'auth/user-not-found') msg = 'Usuário não encontrado.';
      if (error.code === 'auth/wrong-password') msg = 'Senha incorreta.';
      if (error.code === 'auth/invalid-email') msg = 'E-mail inválido.';
      mensagemErro.innerText = msg;
    });
}
