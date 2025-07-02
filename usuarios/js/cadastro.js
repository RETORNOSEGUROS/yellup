document.addEventListener("DOMContentLoaded", async () => {
  const db = firebase.firestore();

  // Carregar times no dropdown
  const timeSelect = document.getElementById("timeId");
  const timesSnap = await db.collection("times").orderBy("nome").get();
  timesSnap.forEach(doc => {
    const option = document.createElement("option");
    option.value = doc.id;
    option.textContent = doc.data().nome;
    timeSelect.appendChild(option);
  });

  // Cadastrar usuário
  document.getElementById("cadastroForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const nome = document.getElementById("nome").value.trim();
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;
    const celular = document.getElementById("celular").value.trim();
    const cidade = document.getElementById("cidade").value.trim();
    const estado = document.getElementById("estado").value.trim();
    const pais = document.getElementById("pais").value.trim();
    const timeId = document.getElementById("timeId").value;

    if (!nome || !email || !senha || !timeId) return alert("Preencha todos os campos obrigatórios.");

    try {
      const cred = await firebase.auth().createUserWithEmailAndPassword(email, senha);
      const uid = cred.user.uid;
      const agora = new Date();

      await db.collection("usuarios").doc(uid).set({
        nome, email, celular, cidade, estado, pais,
        timeId,
        status: "ativo",
        dataCadastro: agora,
        creditos: 0,
        usuario: email.split("@")[0],
        usuarioUnico: uid
      });

      alert("Usuário cadastrado com sucesso!");
      window.location.href = "/usuarios/index.html";
    } catch (err) {
      console.error(err);
      alert("Erro ao cadastrar: " + err.message);
    }
  });
});
