document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("btnGerar").addEventListener("click", gerarRanking);
});

async function gerarRanking() {
    const db = firebase.firestore();

    const dataInicio = document.getElementById("dataInicio").value;
    const dataFim = document.getElementById("dataFim").value;
    const tipoPremiacao = document.getElementById("tipoPremiacao").value;
    const limiteRanking = parseInt(document.getElementById("limiteRanking").value);

    if (!dataInicio || !dataFim) {
        alert("Informe o período.");
        return;
    }

    let usuariosSnapshot = await db.collection("usuarios").get();
    let usuarios = [];

    usuariosSnapshot.forEach(doc => {
        const data = doc.data();
        usuarios.push({
            id: doc.id,
            nome: data.nome || "(sem nome)",
            timeId: data.timeId || "",
            pontuacao: data.pontuacao || 0,
            creditos: data.creditos || 0
        });
    });

    // Ordena por pontuação decrescente
    usuarios.sort((a, b) => b.pontuacao - a.pontuacao);

    // Aplica o limite de ranking
    const topUsuarios = usuarios.slice(0, limiteRanking);

    exibirRanking(topUsuarios);
}

function exibirRanking(lista) {
    const tbody = document.getElementById("rankingTableBody");
    tbody.innerHTML = "";

    lista.forEach((user, index) => {
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${index + 1}</td>
            <td>${user.nome}</td>
            <td>${user.pontuacao}</td>
            <td><input type="number" id="credito-${user.id}" value="0" style="width:80px;"></td>
            <td><button onclick="pagar('${user.id}')">Pagar</button></td>
        `;
        tbody.appendChild(linha);
    });
}

async function pagar(userId) {
    const db = firebase.firestore();
    const input = document.getElementById(`credito-${userId}`);
    const valor = parseFloat(input.value);

    if (isNaN(valor) || valor <= 0) {
        alert("Informe um valor válido para pagar.");
        return;
    }

    const userRef = db.collection("usuarios").doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.data();

    await userRef.update({
        creditos: (userData.creditos || 0) + valor
    });

    alert("Créditos pagos com sucesso!");
}
