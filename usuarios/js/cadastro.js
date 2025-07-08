
const urlParams = new URLSearchParams(window.location.search);
const refId = urlParams.get("ref");

async function cadastrarUsuario() {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  const nome = document.getElementById("nome").value.trim();

  if (!email || !senha || !nome) {
    alert("Preencha todos os campos!");
    return;
  }

  try {
    const userCred = await firebase.auth().createUserWithEmailAndPassword(email, senha);
    const uid = userCred.user.uid;

    const usuario = {
      nome,
      email,
      creditos: 30,  // bônus de boas-vindas
      status: "ativo",
      dataCadastro: firebase.firestore.Timestamp.now()
    };

    if (refId) {
      usuario.indicadorId = refId;
    }

    await db.collection("usuarios").doc(uid).set(usuario);
    localStorage.setItem("usuarioId", uid);
    localStorage.setItem("nomeUsuario", nome);

    // Recompensar o indicador com 10 créditos
    if (refId) {
      const indicadorRef = db.collection("usuarios").doc(refId);
      const indicadorDoc = await indicadorRef.get();
      if (indicadorDoc.exists) {
        const creditosAtuais = indicadorDoc.data().creditos || 0;
        await indicadorRef.update({ creditos: creditosAtuais + 10 });

        await adicionarXP(refId, 10);
  await indicadorRef.collection("extrato").add({
          tipo: "entrada",
          valor: 10,
          descricao: "Indicação de novo usuário",
          data: firebase.firestore.Timestamp.now()
        });
      }
    }

    alert("Cadastro realizado com sucesso!");
    window.location.href = "painel.html";

  } catch (e) {
    console.error("Erro no cadastro:", e);
    alert("Erro ao cadastrar: " + e.message);
  }
}
