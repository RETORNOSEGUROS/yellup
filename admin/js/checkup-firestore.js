console.log("Iniciando teste de conexão com Firestore...");

const db = firebase.firestore();

// Teste de leitura básica na coleção de 'usuarios'
db.collection("usuarios").limit(5).get()
  .then(snapshot => {
    if (snapshot.empty) {
      console.log("Conexão OK, mas nenhum dado encontrado na coleção 'usuarios'.");
      alert("✅ Conexão OK com Firestore. Nenhum usuário encontrado (coleção vazia ou sem dados).");
    } else {
      console.log("Conexão OK e dados encontrados:");
      snapshot.forEach(doc => console.log(doc.id, doc.data()));
      alert("✅ Conexão OK com Firestore. Dados encontrados (veja o console para detalhes).");
    }
  })
  .catch(error => {
    console.error("Erro na leitura Firestore:", error);
    alert("❌ ERRO: Não foi possível conectar no Firestore. Veja o console para detalhes.");
  });