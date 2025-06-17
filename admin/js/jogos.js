const db = firebase.firestore();

async function carregarTimes() {
    const timesRef = await db.collection("times").orderBy("nome").get();
    const selects = [document.getElementById("timeCasa"), document.getElementById("timeVisitante")];
    selects.forEach(select => {
        select.innerHTML = '<option value="">Selecione o Time</option>';
        timesRef.forEach(doc => {
            const opt = document.createElement("option");
            opt.value = doc.id;
            opt.textContent = doc.data().nome;
            select.appendChild(opt);
        });
    });
}

async function salvarJogo() {
    const timeCasaId = document.getElementById("timeCasa").value;
    const timeForaId = document.getElementById("timeVisitante").value;
    const dataInicio = new Date(document.getElementById("dataInicio").value);
    const dataFim = new Date(document.getElementById("dataFim").value);
    const valorEntrada = parseInt(document.getElementById("valorEntrada").value);
    const status = document.getElementById("status").value;

    await db.collection("jogos").add({
        timeCasaId, timeForaId, dataInicio, dataFim, valorEntrada, status
    });

    alert("Jogo salvo com sucesso!");
    listarJogos();
}

async function listarJogos() {
    const lista = document.getElementById("listaJogos");
    lista.innerHTML = "";
    const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();

    for (const doc of snapshot.docs) {
        const jogo = doc.data();

        const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
        const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

        const timeCasaNome = timeCasaDoc.exists ? timeCasaDoc.data().nome : "-";
        const timeForaNome = timeForaDoc.exists ? timeForaDoc.data().nome : "-";

        const dataInicioFormat = jogo.dataInicio.toDate().toLocaleString();

        const row = `<tr>
            <td>${timeCasaNome}</td>
            <td>${timeForaNome}</td>
            <td>${dataInicioFormat}</td>
            <td>${jogo.valorEntrada} créditos</td>
            <td>${jogo.status}</td>
        </tr>`;
        lista.innerHTML += row;
    }
}

window.onload = () => {
    carregarTimes();
    listarJogos();
    document.getElementById("salvarJogo").onclick = salvarJogo;
};
