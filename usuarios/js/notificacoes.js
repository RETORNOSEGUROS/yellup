
async function carregarNotificacoes(usuarioId) {
  const lista = document.getElementById("listaNotificacoes");
  lista.innerHTML = "Carregando...";

  try {
    const snap = await db.collection("usuarios").doc(usuarioId).collection("notificacoes")
      .orderBy("data", "desc").limit(10).get();

    if (snap.empty) {
      lista.innerHTML = "<li>Nenhuma notificação encontrada.</li>";
      return;
    }

    lista.innerHTML = "";
    snap.forEach(doc => {
      const n = doc.data();
      const li = document.createElement("li");
      const dataStr = n.data?.toDate().toLocaleString("pt-BR") || "";
      li.innerHTML = `📌 <strong>${n.titulo}</strong><br><span style="font-size:12px; color:gray;">${n.corpo} (${dataStr})</span>`;
      lista.appendChild(li);
    });
  } catch (e) {
    console.error("Erro ao carregar notificações:", e);
    lista.innerHTML = "<li>Erro ao carregar notificações.</li>";
  }
}

async function novaNotificacao(usuarioId, titulo, corpo) {
  const ref = db.collection("usuarios").doc(usuarioId).collection("notificacoes");
  await ref.add({
    titulo,
    corpo,
    lida: false,
    data: firebase.firestore.Timestamp.now()
  });
}
