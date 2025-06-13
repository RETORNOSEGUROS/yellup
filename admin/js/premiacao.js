async function gerarRanking() {
    const dataInicio = document.getElementById("dataInicio").value;
    const dataFim = document.getElementById("dataFim").value;
    const limiteRanking = parseInt(document.getElementById("limiteRanking").value) || 50;

    if (!dataInicio || !dataFim) {
        alert("Informe o período.");
        return;
    }

    const usuarios = await db.collection("usuarios").get();
    let lista = [];

    usuarios.forEach(doc => {
        const data = doc.data();
        lista.push({
            id: doc.id,
            nome: data.nome || "(sem nome)",
            timeId: data.timeId || "",
            pontuacao: data.pontuacao || 0,
            creditos: data.creditos || 0
        });
    });

    lista.sort((a, b) => b.pontuacao - a.pontuacao);
    lista = lista.slice(0, limiteRanking);
    exibirRanking(lista);
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
            <td><input type="number" id="credito-${user.id}" value="0"></td>
            <td><button onclick="pagar('${user.id}')">Pagar</button></td>
        `;
        tbody.appendChild(linha);
    });
}

async function pagar(userId) {
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
