document.addEventListener('DOMContentLoaded', async () => {
  const db = firebase.firestore();
  const urlParams = new URLSearchParams(window.location.search);
  const jogoId = urlParams.get('id');

  if (!jogoId) {
    alert("ID do jogo não fornecido.");
    return;
  }

  try {
    const doc = await db.collection("jogos").doc(jogoId).get();
    if (!doc.exists) {
      alert("Jogo não encontrado no banco de dados.");
      return;
    }

    const jogo = doc.data();

    // Busca nomes dos times
    const [timeCasaDoc, timeForaDoc] = await Promise.all([
      db.collection("times").doc(jogo.timeCasaId).get(),
      db.collection("times").doc(jogo.timeForaId).get()
    ]);

    const nomeCasa = timeCasaDoc.exists ? timeCasaDoc.data().nome : "Time A";
    const nomeFora = timeForaDoc.exists ? timeForaDoc.data().nome : "Time B";
    document.getElementById('tituloJogo').innerText = `${nomeCasa} vs ${nomeFora}`;

    // Formata datas
    const inicio = jogo.dataInicio?.toDate?.().toLocaleString("pt-BR") || "-";
    document.getElementById('infoInicio').innerText = inicio;

    // Formata entrada
    const entrada = jogo.valorEntrada ? `${jogo.valorEntrada} crédito(s)` : "-";
    document.getElementById('infoEntrada').innerText = entrada;

  } catch (error) {
    console.error("Erro ao carregar dados do jogo:", error);
    alert("Erro ao carregar dados.");
  }
});

function enviarMensagem() {
  alert('Chat ainda não implementado.');
}

function sortearPergunta() {
  alert('Sorteio de pergunta ainda não implementado.');
}
