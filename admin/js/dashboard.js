const db = firebase.firestore();

async function carregarResumo() {
  // Total de usuários
  const usuarios = await db.collection("usuarios").get();
  document.getElementById("cardUsuarios").innerText = `Usuários: ${usuarios.size}`;

  // Total de jogos
  const jogos = await db.collection("jogos").get();
  document.getElementById("cardJogos").innerText = `Jogos: ${jogos.size}`;

  // Créditos totais registrados
  const creditosSnap = await db.collection("creditos").get();
  let totalCreditos = 0;
  creditosSnap.forEach(doc => {
    totalCreditos += doc.data().valorCredito || 0;
  });
  document.getElementById("cardCreditos").innerText = `Créditos: ${totalCreditos}`;

  // Jogos ao vivo
  const aoVivoSnap = await db.collection("jogos").where("status", "==", "ao_vivo").get();
  document.getElementById("cardAoVivo").innerText = `Jogos ao vivo: ${aoVivoSnap.size}`;
}

carregarResumo();
