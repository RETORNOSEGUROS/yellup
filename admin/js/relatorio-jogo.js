const db = firebase.firestore();
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

async function carregarRelatorio() {
  if (!jogoId) {
    alert("ID do jogo não encontrado.");
    return;
  }

  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  if (!jogoDoc.exists) {
    alert("Jogo não encontrado.");
    return;
  }

  const jogo = jogoDoc.data();
  const titulo = `${jogo.timeCasaNome} x ${jogo.timeVisitanteNome}`;
  const status = jogo.status;
  const dataInicio = jogo.dataInicio.toDate().toLocaleString("pt-BR");
  const dataFim = jogo.dataFim.toDate().toLocaleString("pt-BR");

  document.getElementById("tituloPartida").innerText = titulo;
  document.getElementById("statusPartida").innerText = status;
  document.getElementById("periodoPartida").innerText = `${dataInicio} até ${dataFim}`;

  const torcidasSnap = await db.collection("torcidas").where("jogoId", "==", jogoId).get();
  const apostasSnap = await db.collection("apostas").where("jogoId", "==", jogoId).get();

  const resumo = {
    [jogo.timeCasaId]: { nome: jogo.timeCasaNome, torcedores: 0, creditos: 0, pontos: 0 },
    [jogo.timeVisitanteId]: { nome: jogo.timeVisitanteNome, torcedores: 0, creditos: 0, pontos: 0 }
  };

  torcidasSnap.forEach(doc => {
    const t = doc.data();
    if (resumo[t.timeId]) {
      resumo[t.timeId].torcedores += 1;
    }
  });

  apostasSnap.forEach(doc => {
    const a = doc.data();
    if (resumo[a.timeId]) {
      resumo[a.timeId].creditos += a.creditos;
      resumo[a.timeId].pontos += a.pontos;
    }
  });

  const tabela = document.getElementById("tabelaResumo");
  Object.values(resumo).forEach(r => {
    const media = r.torcedores > 0 ? (r.pontos / r.torcedores).toFixed(1) : "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.nome}</td>
      <td>${r.torcedores}</td>
      <td>${r.creditos}</td>
      <td>${media}</td>
    `;
    tabela.appendChild(tr);
  });
}

carregarRelatorio();
