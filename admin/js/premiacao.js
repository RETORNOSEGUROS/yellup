// premiacao.js
// Motor de cálculo e busca da premiação

function gerarRanking() {
    const dataInicio = new Date(document.getElementById("dataInicio").value);
    const dataFim = new Date(document.getElementById("dataFim").value);
    const tipo = document.getElementById("tipoPremiacao").value;
    const limite = parseInt(document.getElementById("limiteRanking").value);

    let colecao = "usuarios";

    db.collection(colecao)
      .orderBy("pontuacao", "desc")
      .limit(limite)
      .get()
      .then(snapshot => {
          const tbody = document.querySelector("#tabelaRanking tbody");
          tbody.innerHTML = "";

          let posicao = 1;
          snapshot.forEach(doc => {
              const user = doc.data();
              const tr = document.createElement("tr");

              const pontuacao = user.pontuacao || 0;
              const creditosCalculados = calcularPremiacao(posicao, pontuacao);

              tr.innerHTML = `
                  <td>${posicao}</td>
                  <td>${user.nome}</td>
                  <td>${pontuacao}</td>
                  <td><input type="number" value="${creditosCalculados}" id="valor_${doc.id}"></td>
                  <td><button onclick="pagarPremio('${doc.id}')">Pagar</button></td>
              `;

              tbody.appendChild(tr);
              posicao++;
          });
      });
}

function calcularPremiacao(posicao, pontuacao) {
    // Lógica inicial de premiação: (exemplo simples: 10 créditos por posição)
    return 10 * (51 - posicao);
}
