const db = firebase.firestore();
const docRef = db.collection("config").doc("geral");

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarConfiguracoes();
  }
});

function carregarConfiguracoes() {
  docRef.get().then(doc => {
    if (doc.exists) {
      const data = doc.data();
      document.getElementById('percentualPremio').value = data.percentualPremio ?? '';
      document.getElementById('valorMinimoAposta').value = data.valorMinimoAposta ?? '';
      document.getElementById('limiteCredito').value = data.limiteCredito ?? '';
      document.getElementById('regras').value = data.regras ?? '';
    }
  });
}

function salvarConfiguracoes() {
  const config = {
    percentualPremio: parseFloat(document.getElementById('percentualPremio').value),
    valorMinimoAposta: parseFloat(document.getElementById('valorMinimoAposta').value),
    limiteCredito: parseFloat(document.getElementById('limiteCredito').value),
    regras: document.getElementById('regras').value.trim()
  };

  docRef.set(config).then(() => {
    alert("Configurações salvas com sucesso!");
  });
}
