
async function carregarIndicacoes(usuarioId) {
  const p = document.getElementById("totalIndicacoes");
  const lista = document.getElementById("listaIndicados");

  try {
    const snap = await db.collection("usuarios")
      .where("indicadorId", "==", usuarioId).get();

    const total = snap.size;
    p.textContent = `👥 Você já indicou ${total} usuário${total === 1 ? "" : "s"} para a plataforma.`;

    lista.innerHTML = "";
    snap.forEach(doc => {
      const li = document.createElement("li");
      li.textContent = doc.data().nome || "Sem nome";
      lista.appendChild(li);
    });

  } catch (e) {
    console.error("Erro ao buscar indicações:", e);
    p.textContent = "Erro ao carregar dados de indicação.";
    lista.innerHTML = "";
  }
}
