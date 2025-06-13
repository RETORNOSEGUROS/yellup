const db = firebase.firestore();

async function gerarRanking() {
  const inicioInput = document.getElementById("dataInicio").value;
  const fimInput = document.getElementById("dataFim").value;
  const modoPremiacao = document.getElementById("modoPremiacao").value;
  const limiteRanking = parseInt(document.getElementById("limiteRanking").value);

  if (!inicioInput || !fimInput) {
    alert("Informe as datas para gerar o ranking.");
    return;
  }

  const inicio = new Date(inicioInput + "T00:00:00");
  const fim = new Date(fimInput + "T23:59:59");

  let ranking = [];

  if (modoPremiacao === "geral") {
    ranking = await gerarRankingGeral(inicio, fim);
  } else if (modoPremiacao === "timeDocoracao") {
    ranking = await gerarRankingTimeDoCoracao(inicio, fim);
  } else if (modoPremiacao === "finalizadosGeral") {
    ranking = await gerarRankingFinalizadosGeral(inicio, fim);
  } else if (modoPremiacao === "finalizadosTime") {
    ranking = await gerarRankingFinalizadosTime(inicio, fim);
  }

  ranking.sort((a, b) => b.pontos - a.pontos);
  ranking = ranking.slice(0, limiteRanking);

  exibirRanking(ranking);
}

async function gerarRankingGeral(inicio, fim) {
  const respostasSnap = await db.collection("respostas")
    .where("data", ">=", inicio)
    .where("data", "<=", fim)
    .get();

  const pontuacao = {};
  respostasSnap.forEach(doc => {
    const r = doc.data();
    if (!pontuacao[r.userId]) pontuacao[r.userId] = 0;
    pontuacao[r.userId] += r.pontos || 1;
  });

  const ranking = [];
  for (const userId in pontuacao) {
    const userDoc = await db.collection("usuarios").doc(userId).get();
    ranking.push({
      userId,
      nome: userDoc.exists ? userDoc.data().nome : userId,
      pontos: pontuacao[userId]
    });
  }
  return ranking;
}

async function gerarRankingTimeDoCoracao(inicio, fim) {
  const geral = await gerarRankingGeral(inicio, fim);
  const ranking = [];
  for (const item of geral) {
    const userDoc = await db.collection("usuarios").doc(item.userId).get();
    if (userDoc.exists && userDoc.data().timeId) {
      ranking.push({ ...item, timeId: userDoc.data().timeId });
    }
  }
  return ranking;
}

async function gerarRankingFinalizadosGeral(inicio, fim) {
  const jogosSnap = await db.collection("jogos")
    .where("dataInicio", ">=", inicio)
    .where("dataInicio", "<=", fim)
    .where("status", "==", "finalizado")
    .get();

  const jogosIds = jogosSnap.docs.map(doc => doc.id);
  const torcidasSnap = await db.collection("torcidas")
    .where("jogoId", "in", jogosIds)
    .get();

  const pontuacao = {};
  torcidasSnap.forEach(doc => {
    const t = doc.data();
    if (!pontuacao[t.userId]) pontuacao[t.userId] = 0;
    pontuacao[t.userId] += t.creditos || 0;
  });

  const ranking = [];
  for (const userId in pontuacao) {
    const userDoc = await db.collection("usuarios").doc(userId).get();
    ranking.push({
      userId,
      nome: userDoc.exists ? userDoc.data().nome : userId,
      pontos: pontuacao[userId]
    });
  }
  return ranking;
}

async function gerarRankingFinalizadosTime(inicio, fim) {
  const geral = await gerarRankingFinalizadosGeral(inicio, fim);
  const ranking = [];
  for (const item of geral) {
    const userDoc = await db.collection("usuarios").doc(item.userId).get();
    if (userDoc.exists && userDoc.data().timeId) {
      ranking.push({ ...item, timeId: userDoc.data().timeId });
    }
  }
  return ranking;
}

function exibirRanking(ranking) {
  const tabela = document.getElementById("tabelaRanking");
  tabela.innerHTML = "";

  ranking.forEach((item, index) => {
    const tr = document.createElement("tr");

    const posTd = document.createElement("td");
    posTd.textContent = index + 1;
    tr.appendChild(posTd);

    const nomeTd = document.createElement("td");
    nomeTd.textContent = item.nome;
    tr.appendChild(nomeTd);

    const pontosTd = document.createElement("td");
    pontosTd.textContent = item.pontos;
    tr.appendChild(pontosTd);

    const creditosInput = document.createElement("input");
    creditosInput.type = "number";
    creditosInput.value = 0;
    creditosInput.style.width = "80px";

    const creditosTd = document.createElement("td");
    creditosTd.appendChild(creditosInput);
    tr.appendChild(creditosTd);

    const pagarBtn = document.createElement("button");
    pagarBtn.textContent = "Pagar";
    pagarBtn.onclick = () => pagar(item.userId, parseInt(creditosInput.value));
    const acaoTd = document.createElement("td");
    acaoTd.appendChild(pagarBtn);
    tr.appendChild(acaoTd);

    tabela.appendChild(tr);
  });
}

async function pagar(userId, creditos) {
  if (creditos <= 0) {
    alert("Valor inválido.");
    return;
  }

  const userRef = db.collection("usuarios").doc(userId);
  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    const saldoAtual = userDoc.data().creditos || 0;
    t.update(userRef, { creditos: saldoAtual + creditos });
  });

  await db.collection("transacoes").add({
    userId, creditos, data: new Date(), tipo: "premiacao"
  });

  alert("Créditos pagos!");
}