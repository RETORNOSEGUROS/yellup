function login() {
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;
  const mensagemErro = document.getElementById('mensagem-erro');

  if (!email || !senha) {
    mensagemErro.innerText = 'Preencha todos os campos.';
    return;
  }

  auth.signInWithEmailAndPassword(email, senha)
    .then((userCredential) => {
      const user = userCredential.user;
      window.location.href = 'painel.html';
    })
    .catch((error) => {
      let msg = 'Erro ao entrar.';
      if (error.code === 'auth/user-not-found') msg = 'Usuário não encontrado.';
      if (error.code === 'auth/wrong-password') msg = 'Senha incorreta.';
      if (error.code === 'auth/invalid-email') msg = 'E-mail inválido.';
      mensagemErro.innerText = msg;
    });
}
