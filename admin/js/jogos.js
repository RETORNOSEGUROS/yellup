async function carregarTimes() {
    const timesSnap = await db.collection("times").orderBy("nome").get();
    const timeCasaSelect = document.getElementById("timeCasa");
    const timeVisitanteSelect = document.getElementById("timeVisitante");

    timeCasaSelect.innerHTML = `<option value="">Selecione</option>`;
    timeVisitanteSelect.innerHTML = `<option value="">Selecione</option>`;

    timesSnap.forEach(doc => {
        const option = document.createElement("option");
        option.value = doc.data().nome;
        option.textContent = doc.data().nome;
        timeCasaSelect.appendChild(option);
        timeVisitanteSelect.appendChild(option.cloneNode(true));
    });
}

async function salvarJogo() {
    const jogo = {
        timeCasa: document.getElementById("timeCasa").value,
        timeFora: document.getElementById("timeVisitante").value,
        dataInicio: firebase.firestore.Timestamp.fromDate(new Date(document.getElementById("dataInicio").value)),
        dataFim: firebase.firestore.Timestamp.fromDate(new Date(document.getElementById("dataFim").value)),
        entradaCreditos: parseInt(document.getElementById("entradaCreditos").value),
        status: document.getElementById("status").value
    };
    await db.collection("jogos").add(jogo);
    carregarJogos();
}

async function carregarJogos() {
    const jogosSnap = await db.collection("jogos").orderBy("dataInicio", "desc").get();
    const tbody = document.querySelector("#tabelaJogos tbody");
    tbody.innerHTML = "";

    jogosSnap.forEach(doc => {
        const jogo = doc.data();
        const tr = document.createElement("tr");
        const inicio = jogo.dataInicio.toDate().toLocaleString('pt-BR');

        tr.innerHTML = `
            <td>${jogo.timeCasa || "-"}</td>
            <td>${jogo.timeFora || "-"}</td>
            <td>${inicio}</td>
            <td>${jogo.entradaCreditos || 0} créditos</td>
            <td class="status-${jogo.status}">${jogo.status}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.onload = () => {
    carregarTimes();
    carregarJogos();
}
