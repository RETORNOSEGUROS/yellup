const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8",
  measurementId: "G-SYZ16X31KQ"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nick = document.getElementById("usuarioUnico").value.trim();
    const senha = document.getElementById("senha").value;

    try {
      const query = await firebase.firestore().collection("usuarios").where("usuarioUnico", "==", nick).limit(1).get();
      if (query.empty) {
        alert("Usuário não encontrado.");
        return;
      }

      const email = query.docs[0].data().email;
      await auth.signInWithEmailAndPassword(email, senha);
      window.location.href = "painel.html";
    } catch (err) {
      console.error(err);
      alert("Erro ao fazer login: " + err.message);
    }
  });
});
