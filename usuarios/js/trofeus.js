
async function verificarTrofeus(usuarioId) {
  const userRef = db.collection("usuarios").doc(usuarioId);
  const userDoc = await userRef.get();
  const dados = userDoc.data();

  const conquistasRef = userRef.collection("conquistas");
  const conquistasSnap = await conquistasRef.get();
  const jaTem = {};
  conquistasSnap.forEach(doc => jaTem[doc.data().tipo] = true);

  const respostasSnap = await db.collection("respostas")
    .where("usuarioId", "==", usuarioId).get();
  const totalResp = respostasSnap.size;
  const corretas = respostasSnap.docs.filter(d => d.data().resposta === d.data().correta).length;

  const jogosSnap = await db.collection("torcidas").get();
  let jogosParticipados = 0;
  for (const jogo of jogosSnap.docs) {
    const sub = await db.collection("torcidas").doc(jogo.id).collection("torcedores")
      .where("usuarioId", "==", usuarioId).get();
    if (!sub.empty) jogosParticipados++;
  }

  const creditos = dados.creditos || 0;
  const nivel = dados.nivel || 1;

  const trofeus = [];

  if (totalResp >= 10 && !jaTem["Estreante Blindado"]) {
    trofeus.push({ tipo: "Estreante Blindado", descricao: "Respondeu 10 perguntas" });
  }

  if (corretas >= 25 && !jaTem["Acertei em Cheio"]) {
    trofeus.push({ tipo: "Acertei em Cheio", descricao: "Acertou 25 perguntas" });
  }

  if (creditos >= 100 && !jaTem["Magnata da Arena"]) {
    trofeus.push({ tipo: "Magnata da Arena", descricao: "Acumulou 100 créditos" });
  }

  if (nivel >= 5 && !jaTem["Veterano Yellup"]) {
    trofeus.push({ tipo: "Veterano Yellup", descricao: "Alcançou nível 5" });
  }

  if (jogosParticipados >= 5 && !jaTem["Fiel da Torcida"]) {
    trofeus.push({ tipo: "Fiel da Torcida", descricao: "Participou de 5 jogos" });
  }

  for (const t of trofeus) {
    await conquistasRef.add({
      ...t,
      data: firebase.firestore.Timestamp.now()
    });
  }
}
