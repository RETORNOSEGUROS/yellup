const db = firebase.firestore();
let simulacao = [];

async function carregarPremiacao() {
  const tabela = document.getElementById("tabelaPremios");
  tabela.innerHTML = "";

  // Buscar top 5 usuários por pontuação
  const usuariosSnap = await db.collection("usuarios").orderBy("pontuacao", "desc").limit(5).get();
  const usuarios = [];
  usuariosSnap.forEach(doc => {
    const data = doc.data();
    usuarios.push({
      id: doc.id,
      nome: data.nome || "Sem nome",
      pontos: data.pontuacao || 0
    });
  });

  // Calcular total de créditos movimentados no período
  const transacoesSnap = await db.collection("transacoes").get();
  let totalCreditos = 0;
  transacoesSnap.forEach(doc => {
    const valor = doc.data().valor || 0;
    if (valor < 0) totalCreditos += Math.abs(valor);
  });

  const premioTotal = Math.floor(totalCreditos * 0.10);
  document.getElementById("totalCreditos").innerText = `R$ ${totalCreditos.toFixed(2)}`;
  document.getElementById("valorPremio").innerText = `R$ ${premioTotal.toFixed(2)}`;

  const percentuais = [0.4, 0.25, 0.15, 0.10, 0.10];

  simulacao = usuarios.map((u, i) => ({
    ...u,
    premio: Math.floor(premioTotal * percentuais[i])
  }));

  simulacao.forEach((u, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}º</td>
      <td>${u.nome}</td>
      <td>${u.pontos}</td>
      <td>${u.premio}</td>
    `;
    tabela.appendChild(tr);
  });
}

async function confirmarPremiacao() {
  const batch = db.batch();
  const now = firebase.firestore.Timestamp.fromDate(new Date());

  simulacao.forEach(u => {
    const ref = db.collection("transacoes").doc();
    batch.set(ref, {
      nome: u.nome,
      valor: u.premio,
      tipo: "premio_ranking",
      data: now
    });
  });

  await batch.commit();
  alert("Premiação registrada com sucesso!");
  location.reload();
}

carregarPremiacao();
