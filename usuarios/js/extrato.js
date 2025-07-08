
async function carregarExtrato(usuarioId) {
  const tbody = document.querySelector("#tabelaExtrato tbody");
  tbody.innerHTML = "<tr><td colspan='3'>Carregando...</td></tr>";

  try {
    const snap = await db.collection("usuarios").doc(usuarioId)
      .collection("extrato").orderBy("data", "desc").limit(30).get();

    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='3'>Nenhuma movimentação encontrada.</td></tr>";
      return;
    }

    tbody.innerHTML = "";

    snap.forEach(doc => {
      const d = doc.data();
      const valor = d.tipo === "entrada" ? `+${d.valor}` : `-${d.valor}`;
      const cor = d.tipo === "entrada" ? "green" : "red";
      const dataStr = d.data.toDate().toLocaleDateString("pt-BR");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="padding:8px; border:1px solid #ccc;">${dataStr}</td>
        <td style="padding:8px; border:1px solid #ccc;">${d.descricao}</td>
        <td style="padding:8px; border:1px solid #ccc; color:${cor};"><strong>${valor}</strong></td>
      `;
      tbody.appendChild(tr);
    });

  } catch (e) {
    console.error("Erro ao carregar extrato:", e);
    tbody.innerHTML = "<tr><td colspan='3'>Erro ao carregar dados.</td></tr>";
  }
}
