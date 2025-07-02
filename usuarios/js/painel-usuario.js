// Configuração do Firebase (substituir pelos dados reais do projeto)
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_DOMINIO.firebaseapp.com",
  projectId: "SEU_PROJETO_ID",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Lógica de login
function login() {
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;
  auth.signInWithEmailAndPassword(email, senha)
    .then(() => alert("Login efetuado!"))
    .catch(error => alert("Erro: " + error.message));
}

// Lógica de cadastro
function registrar() {
  const nome = document.getElementById("nome").value;
  const email = document.getElementById("novoEmail").value;
  const senha = document.getElementById("novaSenha").value;

  auth.createUserWithEmailAndPassword(email, senha)
    .then(cred => {
      return db.collection("usuarios").doc(cred.user.uid).set({
        nome: nome,
        email: email,
        creditos: 0,
        status: "ativo",
        timeId: "",
        usuarioUnico: cred.user.uid
      });
    })
    .then(() => alert("Cadastro realizado com sucesso!"))
    .catch(error => alert("Erro: " + error.message));
}

// Alternar entre login e cadastro
function mostrarCadastro() {
  document.getElementById("login-container").style.display = "none";
  document.getElementById("cadastro-container").style.display = "block";
}
function mostrarLogin() {
  document.getElementById("login-container").style.display = "block";
  document.getElementById("cadastro-container").style.display = "none";
}
