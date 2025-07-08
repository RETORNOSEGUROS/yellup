
const params = new URLSearchParams(window.location.search);
const jogoId = params.get("id");
const usuarioId = localStorage.getItem("usuarioId");

if (!jogoId || !usuarioId) {
  alert("Erro: Jogo ou usuário não identificado.");
}

async function carregarPainelJogo() {
  try {
    const userDoc = await db.collection("usuarios").doc(usuarioId).get();
    const user = userDoc.data();
    document.getElementById("nomeUsuario").textContent = user?.nome || "Usuário";

    const jogoDoc = await db.collection("jogos").doc(jogoId).get();
    if (!jogoDoc.exists) return alert("Jogo não encontrado.");
    const jogo = jogoDoc.data();

    const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
    const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

    const nomeA = timeCasaDoc.exists ? timeCasaDoc.data().nome : "Time A";
    const nomeB = timeForaDoc.exists ? timeForaDoc.data().nome : "Time B";

    document.getElementById("tituloJogo").textContent = `${nomeA} x ${nomeB}`;
    document.getElementById("btnTimeA").textContent = `Torcer por ${nomeA}`;
    document.getElementById("btnTimeB").textContent = `Torcer por ${nomeB}`;

    document.getElementById("btnTimeA").onclick = () => escolherTorcida(jogoId, jogo.timeCasaId, nomeA, jogo.creditoTorcida);
    document.getElementById("btnTimeB").onclick = () => escolherTorcida(jogoId, jogo.timeForaId, nomeB, jogo.creditoTorcida);

    // Verificar se usuário já torce
    const torcidaDoc = await db.collection("torcidas").doc(jogoId)
      .collection("torcedores").doc(usuarioId).get();

    if (torcidaDoc.exists) {
      const timeId = torcidaDoc.data().timeId;
      const timeEscolhido = (timeId === jogo.timeCasaId) ? nomeA : nomeB;
      document.getElementById("torcidaStatus").innerHTML = `Você está torcendo por <strong>${timeEscolhido}</strong>`;
    } else {
      document.getElementById("torcidaStatus").textContent = "Escolha seu time para participar:";
      document.getElementById("botoesTorcida").style.display = "block";
    }

  } catch (e) {
    console.error("Erro ao carregar painel:", e);
    alert("Erro ao carregar painel do jogo.");
  }
}

async function escolherTorcida(jogoId, timeId, nomeTime, custo) {
  try {
    const userRef = db.collection("usuarios").doc(usuarioId);
    const userDoc = await userRef.get();
    const creditos = userDoc.data().creditos || 0;

    if (creditos < custo) {
      alert("Créditos insuficientes para torcer neste jogo.");
      return;
    }

    await userRef.update({ creditos: creditos - custo });
  await adicionarXP(usuarioId, 3);
  await db.collection("usuarios").doc(usuarioId).collection("extrato").add({
    tipo: "saida",
    valor: custo,
    descricao: "Torcida no jogo",
    data: firebase.firestore.Timestamp.now()
  });

    await db.collection("torcidas").doc(jogoId)
      .collection("torcedores").doc(usuarioId).set({
        timeId: timeId,
        data: firebase.firestore.Timestamp.now()
      });

    alert(`Você está torcendo por ${nomeTime}!`);
    window.location.reload();
  } catch (e) {
    alert("Erro ao registrar sua torcida.");
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", carregarPainelJogo);
