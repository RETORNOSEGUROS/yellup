
async function carregarConquistas(usuarioId) {
  const container = document.getElementById("vitrineConquistas");
  container.innerHTML = "<p>Carregando conquistas...</p>";

  try {
    const snap = await db.collection("usuarios").doc(usuarioId)
      .collection("conquistas").orderBy("data", "desc").get();

    if (snap.empty) {
      container.innerHTML = "<p>Você ainda não conquistou nenhum troféu.</p>";
      return;
    }

    container.innerHTML = "";
    snap.forEach(doc => {
      const c = doc.data();
      const dataStr = c.data.toDate().toLocaleDateString("pt-BR");
      const div = document.createElement("div");
      div.style = "border:1px solid #ccc; border-radius:8px; padding:10px; width:200px; background:#fff;";
      div.innerHTML = `
        <h4 style="margin:0 0 5px;">🏆 ${c.tipo}</h4>
        <p style="font-size:14px;">${c.descricao}</p>
        <p style="font-size:12px; color:gray;">${dataStr}</p>
      `;
      container.appendChild(div);
    });

  } catch (e) {
    console.error("Erro ao carregar conquistas:", e);
    container.innerHTML = "<p>Erro ao buscar conquistas.</p>";
  }
}
