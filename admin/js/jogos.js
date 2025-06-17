const db = firebase.firestore();

async function carregarTimes() {
    const timesSnap = await db.collection("times").orderBy("nome").get();
    const timeCasaSelect = document.getElementById("timeCasa");
    const timeVisitanteSelect = document.getElementById("timeVisitante");

    timeCasaSelect.innerHTML = `<option value="">Selecione</option>`;
    timeVisitanteSelect.innerHTML = `<option value="">Selecione</option>`;

    timesSnap.forEach(doc => {
        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = doc.data().nome;
        timeCasaSelect.appendChild(option.cloneNode(true));
        timeVisitanteSelect.appendChild(option.cloneNode(true));
    });
}

async function salvarJogo() {
    const timeCasaId = document.getElementById("timeCasa").value;
    const timeForaId = document.getElementById("timeVisitante").value;
    const dataInicio = new Date(document.getElementById("dataInicio").value);
    const dataFim = new Date(document.getElementById("dataFim").value);
    const entradaCreditos = parseInt(document.getElementById("entradaCreditos").value);
    const status = document.getElementById("status").value;

    const jogo = {
        timeCasaId,
        timeForaId,
        dataInicio: firebase.firestore.Timestamp.fromDate(dataInicio),
        dataFim: firebase.firestore.Timestamp.fromDate(dataFim),
        entradaCreditos,
        status
    };

    await db.collection("jogos").add(jogo);
    carregarJogos();
}

async function carregarJogos() {
    const jogosSnap = await db.collection("jogos").orderBy("dataInicio", "desc").get();
    const tbody = document.querySelector("#tabelaJogos tbody");
    tbody.innerHTML = "";

    for (const doc of jogosSnap.docs) {
        const jogo = doc.data();

        const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
        const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

        const timeCasaNome = timeCasaDoc.exists ? timeCasaDoc.data().nome : "-";
        const timeForaNome = timeForaDoc.exists ? timeForaDoc.data().nome : "-";

        const dataInicioFormatada = jogo.dataInicio.toDate().toLocaleString("pt-BR");

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${timeCasaNome}</td>
            <td>${timeForaNome}</td>
            <td>${dataInicioFormatada}</td>
            <td>${jogo.entradaCreditos || 0} créditos</td>
            <td>${jogo.status}</td>
        `;
        tbody.appendChild(tr);
    }
}

window.onload = () => {
    carregarTimes();
    carregarJogos();
}
