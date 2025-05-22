function loginAdmin() {
  const email = document.getElementById('email').value;
  const senha = document.getElementById('senha').value;

  firebase.auth().signInWithEmailAndPassword(email, senha)
    .then(() => {
      window.location.href = "/admin/dashboard.html";
    })
    .catch((error) => {
      document.getElementById('erro').innerText = "Erro: " + error.message;
    });
}
