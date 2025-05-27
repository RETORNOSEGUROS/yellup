const db = firebase.firestore();
let dadosRanking = [];

async function carregarRanking() {
  const rankingBody = document.getElementById("rankingBody");
  rankingBody.innerHTML = "";
  dadosRanking = [];

  try {
    const snapshot = await db.collection("usuarios").orderBy("pontuacao", "desc").get();
    snapshot.forEach(doc => {
      const data = doc.data();
      dadosRanking.push({
        nome: data.nome || "Sem nome",
        pontos: data.pontuacao || 0,
        creditos: data.creditos || 0,
        time: data.timeCoracao || "Não definido"
      });
    });

    exibirRanking(dadosRanking);
  } catch (error) {
    console.error("Erro ao carregar ranking:", error);
    rankingBody.innerHTML = `<tr><td colspan="5">Erro ao carregar ranking.</td></tr>`;
  }
}

function exibirRanking(lista) {
  const rankingBody = document.getElementById("rankingBody");
  rankingBody.innerHTML = "";
  lista.forEach((user, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${user.nome}</td>
      <td>${user.pontos}</td>
      <td>${user.creditos}</td>
      <td>${user.time}</td>
    `;
    rankingBody.appendChild(tr);
  });
}

function filtrarRanking() {
  const termo = document.getElementById("filtroNome").value.toLowerCase();
  const filtrados = dadosRanking.filter(u => u.nome.toLowerCase().includes(termo));
  exibirRanking(filtrados);
}

carregarRanking();
