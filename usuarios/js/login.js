
document.getElementById("loginForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;
  auth.signInWithEmailAndPassword(email, senha)
    .then(() => alert("Login bem-sucedido!"))
    .catch(error => alert("Erro: " + error.message));
});
