const db = firebase.firestore();

async function gerarRanking() {
    const dataInicio = document.getElementById("dataInicio").value;
    const dataFim = document.getElementById("dataFim").value;
    const tipoPremiacao = document.getElementById("tipoPremiacao").value;
    const limiteRanking = parseInt(document.getElementById("limiteRanking").value);

    if (!dataInicio || !dataFim) {
        alert("Informe o período.");
        return;
    }

    let usuarios = await db.collection("usuarios").get();
    let lista = [];

    usuarios.forEach(doc => {
        const data = doc.data();
        lista.push({
            id: doc.id,
            nome: data.nome || "(sem nome)",
            timeId: data.timeId || '',
            pontuacao: data.pontuacao || 0
        });
    });

    if (tipoPremiacao === 'time') {
        // Aqui poderia aplicar filtros futuros de time
    }

    lista.sort((a, b) => b.pontuacao - a.pontuacao);
    lista = lista.slice(0, limiteRanking);

    exibirRanking(lista);
}

function exibirRanking(lista) {
    const tbody = document.getElementById("rankingTableBody");
    tbody.innerHTML = '';

    lista.forEach((user, index) => {
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${index + 1}</td>
            <td>${user.nome}</td>
            <td>${user.pontuacao}</td>
            <td><input type="number" value="0" id="credito-${user.id}" /></td>
            <td><button onclick="pagar('${user.id}')">Pagar</button></td>
        `;
        tbody.appendChild(linha);
    });
}

async function pagar(userId) {
    const input = document.getElementById(`credito-${userId}`);
    const valor = parseFloat(input.value);

    if (valor <= 0 || isNaN(valor)) {
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
