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

    document.getElementById('tituloJogo').innerText = `${jogo.timeCasa} vs ${jogo.timeFora}`;
    document.getElementById('infoInicio').innerText = jogo.dataInicio || '-';
    document.getElementById('infoEntrada').innerText = jogo.valorEntrada ? `${jogo.valorEntrada} crédito(s)` : '-';
  } catch (error) {
    console.error("Erro ao buscar dados do jogo:", error);
    alert("Erro ao carregar dados do jogo.");
  }
});

function enviarMensagem() {
  alert('Chat ainda não implementado.');
}

function sortearPergunta() {
  alert('Sorteio de pergunta ainda não implementado.');
}
