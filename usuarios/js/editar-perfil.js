document.addEventListener("DOMContentLoaded", function () {
  const auth = firebase.auth();
  const db = firebase.firestore();

  auth.onAuthStateChanged(function (user) {
    if (user) {
      const uid = user.uid;
      const ref = db.collection("usuarios").doc(uid);
      ref.get().then((doc) => {
        if (doc.exists) {
          const data = doc.data();
          document.getElementById("nome").value = data.nome || "";
          document.getElementById("celular").value = data.celular || "";
          document.getElementById("cidade").value = data.cidade || "";
          document.getElementById("estado").value = data.estado || "";
          document.getElementById("pais").value = data.pais || "";
          document.getElementById("timeId").value = data.timeId || "";
        }
      });

      document.getElementById("salvarBtn").addEventListener("click", () => {
        ref.update({
          nome: document.getElementById("nome").value,
          celular: document.getElementById("celular").value,
          cidade: document.getElementById("cidade").value,
          estado: document.getElementById("estado").value,
          pais: document.getElementById("pais").value,
          timeId: document.getElementById("timeId").value
        }).then(() => {
          alert("Dados salvos com sucesso!");
        });
      });
    }
  });
});
