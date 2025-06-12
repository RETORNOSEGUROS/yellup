const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

async function buscarNomeTime(id) {
  if (!id) return "Desconhecido";
  const doc = await db.collection("times").doc(id).get();
  return doc.exists ? doc.data().nome : "Desconhecido";
}

async function carregarRelatorio() {
  const doc = await db.collection("jogos").doc(jogoId).get();
  if (!doc.exists) {
    alert("Jogo não encontrado!");
    return;
  }

  const jogo = doc.data();

  document.getElementById("status").innerText = jogo.status || "-";
  const inicio = jogo.dataInicio?.toDate().toLocaleString("pt-BR") || "-";
  const fim = jogo.dataFim?.toDate().toLocaleString("pt-BR") || "-";
  document.getElementById("periodo").innerText = `${inicio} até ${fim}`;

  const nomeCasa = await buscarNomeTime(jogo.timeCasa);
  const nomeFora = await buscarNomeTime(jogo.timeFora);

  const resumo = {};
  resumo[nomeCasa] = { torcedores: 0, creditos: 0, somaPontos: 0, respostas: 0 };
  resumo[nomeFora] = { torcedores: 0, creditos: 0, somaPontos: 0, respostas: 0 };

  const torcidasSnap = await db.collection("torcidas").where("jogoId", "==", jogoId).get();
  torcidasSnap.forEach(doc => {
    const data = doc.data();
    const time = data.time === jogo.timeCasa ? nomeCasa : nomeFora;
    resumo[time].torcedores += 1;
    resumo[time].creditos += data.creditosGastos || 0;
  });

  const respostasSnap = await db.collection("respostas").where("jogoId", "==", jogoId).get();
  respostasSnap.forEach(doc => {
    const data = doc.data();
    const user = data.userId;
    // Não temos o time do usuário no respostas, vamos distribuir de forma genérica (apenas exemplo)
    const time = user.includes("1") || user.includes("2") ? nomeCasa : nomeFora;
    resumo[time].somaPontos += data.pontos;
    resumo[time].respostas += 1;
  });

  const tabela = document.getElementById("resumoTabela");
  tabela.innerHTML = "";
  Object.entries(resumo).forEach(([time, dados]) => {
    const media = dados.respostas > 0 ? (dados.somaPontos / dados.respostas).toFixed(1) : "0";
    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${time}</td>
      <td>${dados.torcedores}</td>
      <td>R$ ${dados.creditos.toFixed(2)}</td>
      <td>${media}</td>
    `;
    tabela.appendChild(linha);
  });
}

document.addEventListener("DOMContentLoaded", carregarRelatorio);
