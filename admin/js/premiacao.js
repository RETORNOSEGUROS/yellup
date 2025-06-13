// premiacao.js atualizado

const db = firebase.firestore();

async function gerarRanking() {
    const tabela = document.getElementById("tabelaResultados");
    tabela.innerHTML = "";

    const dataInicio = document.getElementById("dataInicio").value;
    const dataFim = document.getElementById("dataFim").value;
    const limiteRanking = parseInt(document.getElementById("limiteRanking").value);

    // Busca dados de usuários (exemplo simples de pontuação geral)
    const snapshot = await db.collection("usuarios")
        .orderBy("pontuacao", "desc")
        .limit(limiteRanking)
        .get();

    let posicao = 1;
    snapshot.forEach(doc => {
        const dados = doc.data();
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${posicao}</td>
            <td>${dados.nome}</td>
            <td>${dados.pontuacao ?? 0}</td>
            <td><input type="number" value="0"></td>
            <td><button>Pagar</button></td>
        `;
        tabela.appendChild(linha);
        posicao++;
    });
}
