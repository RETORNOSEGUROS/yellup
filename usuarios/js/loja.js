
async function carregarLoja(usuarioId) {
  const container = document.getElementById("itensLoja");
  container.innerHTML = "<p>Carregando itens...</p>";

  try {
    const userDoc = await db.collection("usuarios").doc(usuarioId).get();
    const creditos = userDoc.data().creditos || 0;

    const snap = await db.collection("loja").get();
    if (snap.empty) {
      container.innerHTML = "<p>Nenhum item disponível na loja.</p>";
      return;
    }

    container.innerHTML = "";

    snap.forEach(doc => {
      const item = doc.data();
      const div = document.createElement("div");
      div.style = "border:1px solid #ccc; padding:10px; width:200px; border-radius:8px; background:#fff;";

      div.innerHTML = `
        <h4 style="margin:0 0 5px 0;">${item.nome}</h4>
        <p style="font-size:14px;">${item.descricao}</p>
        ${item.imagemUrl ? `<img src="${item.imagemUrl}" style="width:100%;border-radius:6px;">` : ""}
        <p style="font-weight:bold;">💰 ${item.valor} créditos</p>
        <button onclick="comprarItem('${doc.id}', ${item.valor}, '${item.nome}', '${item.descricao}')" ${
          creditos < item.valor ? "disabled" : ""
        }>Trocar</button>
      `;

      container.appendChild(div);
    });

  } catch (e) {
    console.error("Erro ao carregar loja:", e);
    container.innerHTML = "<p>Erro ao carregar itens.</p>";
  }
}

async function comprarItem(itemId, valor, nome, descricao) {
  const usuarioId = localStorage.getItem("usuarioId");
  const userRef = db.collection("usuarios").doc(usuarioId);
  const userDoc = await userRef.get();
  const creditos = userDoc.data().creditos || 0;

  if (creditos < valor) {
    alert("Créditos insuficientes.");
    return;
  }

  await userRef.update({ creditos: creditos - valor });

  await adicionarXP(usuarioId, 7);
  await userRef.collection("extrato").add({
    tipo: "saida",
    valor: valor,
    descricao: `Compra: ${nome}`,
    data: firebase.firestore.Timestamp.now()
  });

  await userRef.collection("recompensas").doc(itemId).set({
    nome,
    descricao,
    data: firebase.firestore.Timestamp.now()
  });

  alert(`Você comprou: ${nome}`);
  carregarLoja(usuarioId);
}
