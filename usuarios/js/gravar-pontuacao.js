
// Função para gravar pontuação ao final do jogo ou pergunta
async function gravarPontuacao(pontos, jogoNome) {
  const user = firebase.auth().currentUser;
  if (!user) return console.warn("Usuário não autenticado.");

  const uid = user.uid;
  const agora = new Date();
  const partida = { jogo: jogoNome, pontos: pontos, data: agora };

  const ref = firebase.firestore()
    .collection("usuarios")
    .doc(uid)
    .collection("desempenho")
    .doc("dados");

  try {
    const doc = await ref.get();
    if (!doc.exists) {
      await ref.set({
        pontuacaoTotal: pontos,
        partidas: [partida]
      });
    } else {
      await ref.update({
        pontuacaoTotal: firebase.firestore.FieldValue.increment(pontos),
        partidas: firebase.firestore.FieldValue.arrayUnion(partida)
      });
    }
    console.log("Pontuação registrada com sucesso.");
  } catch (e) {
    console.error("Erro ao salvar pontuação:", e);
  }
}
