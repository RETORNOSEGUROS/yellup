async function gerarRanking() {
  const dataInicio = document.getElementById("dataInicio").value;
  const dataFim = document.getElementById("dataFim").value;
  const modo = document.getElementById("modoPremiacao").value;
  const limite = parseInt(document.getElementById("limiteRanking").value);

  if (!dataInicio || !dataFim) {
    alert("Selecione o período.");
    return;
  }

  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  fim.setHours(23, 59, 59, 999);

  let ranking = {};

  if (modo === "geral") {
    ranking = await calcularGeral(inicio, fim);
  } else if (modo === "timeDocoracao") {
    ranking = await calcularTimeDoCoracao(inicio, fim);
  } else if (modo === "finalizadosGeral") {
    ranking = await calcularFinalizadosGeral(inicio, fim);
  } else if (modo === "finalizadosTime") {
    ranking = await calcularFinalizadosPorTime(inicio, fim);
  }

  exibirRanking(ranking, limite);
}

async function calcularGeral(inicio, fim) {
  const dados = {};
  const snap = await db.collection("respostas").where("data", ">=", inicio).where("data", "<=", fim).get();
  snap.forEach(doc => {
    const { userId, pontos } = doc.data();
    if (!dados[userId]) dados[userId] = 0;
    dados[userId] += pontos;
  });
  return dados;
}

async function calcularTimeDoCoracao(inicio, fim) {
  const dados = {};
  const usuariosSnap = await db.collection("usuarios").get();
  const usuarios = {};
  usuariosSnap.forEach(doc => usuarios[doc.id] = doc.data().timeId);

  const snap = await db.collection("respostas").where("data", ">=", inicio).where("data", "<=", fim).get();
  snap.forEach(doc => {
    const { userId, pontos } = doc.data();
    if (usuarios[userId]) {
      if (!dados[userId]) dados[userId] = 0;
      dados[userId] += pontos;
    }
  });
  return dados;
}

async function calcularFinalizadosGeral(inicio, fim) {
  const dados = {};
  const jogosSnap = await db.collection("jogos")
    .where("dataInicio", ">=", inicio)
    .where("dataInicio", "<=", fim)
    .where("status", "==", "finalizado")
    .get();

  const jogosIds = jogosSnap.docs.map(doc => doc.id);
  if (jogosIds.length === 0) return dados;

  const snap = await db.collection("respostas").where("jogoId", "in", jogosIds).get();
  snap.forEach(doc => {
    const { userId, pontos } = doc.data();
    if (!dados[userId]) dados[userId] = 0;
    dados[userId] += pontos;
  });
  return dados;
}

async function calcularFinalizadosPorTime(inicio, fim) {
  const dados = {};
  const jogosSnap = await db.collection("jogos")
    .where("dataInicio", ">=", inicio)
    .where("dataInicio", "<=", fim)
    .where("status", "==", "finalizado")
    .get();

  const jogosIds = jogosSnap.docs.map(doc => doc.id);
  if (jogosIds.length === 0) return dados;

  const torcidasSnap = await db.collection("torcidas")
    .where("jogoId", "in", jogosIds)
    .get();

  torcidasSnap.forEach(doc => {
    const { userId } = doc.data();
    if (!dados[userId]) dados[userId] = 1;
    else dados[userId] += 1;
  });
  return dados;
}

function exibirRanking(ranking, limite) {
  const tabela = document.getElementById("tabelaRanking");
  tabela.innerHTML = "";

  const lista = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, limite);

  lista.forEach(([user, pontos], idx) => {
    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${idx + 1}</td>
      <td>${user}</td>
      <td>${pontos}</td>
      <td><input type="number" id="credito_${user}" value="0" min="0"></td>
      <td><button onclick="pagar('${user}', ${idx + 1})">Pagar</button></td>
    `;
    tabela.appendChild(linha);
  });
}

async function pagar(userId, posicao) {
  const valor = parseFloat(document.getElementById(`credito_${userId}`).value);
  if (valor <= 0) {
    alert("Informe o valor a pagar!");
    return;
  }

  // Atualiza o saldo no usuário
  const userRef = db.collection("usuarios").doc(userId);
  await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw "Usuário não encontrado!";
    const saldoAtual = userDoc.data().creditos || 0;
    transaction.update(userRef, { creditos: saldoAtual + valor });
  });

  // Registra a transação de pagamento
  await db.collection("transacoes").add({
    userId: userId,
    valor: valor,
    dataPagamento: new Date(),
    motivo: "Premiação manual painel",
    referencia: "manual-admin"
  });

  alert("Pagamento realizado para " + userId + " com " + valor + " créditos.");
}
