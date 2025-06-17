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

    const patrocinadores = [];
    document.querySelectorAll(".patrocinador-item").forEach(item => {
        patrocinadores.push({
            nome: item.querySelector(".patrocinador-nome").value,
            valor: parseInt(item.querySelector(".patrocinador-valor").value),
            site: item.querySelector(".patrocinador-site").value,
            logo: item.querySelector(".patrocinador-logo").value
        });
    });

    await db.collection("jogos").add({
        timeCasaId,
        timeForaId,
        dataInicio: firebase.firestore.Timestamp.fromDate(dataInicio),
        dataFim: firebase.firestore.Timestamp.fromDate(dataFim),
        valorEntrada,
        status,
        patrocinadores
    });

    alert("Jogo salvo com sucesso!");
    listarJogos();
}

function definirStatus(dataInicio, dataFim) {
    const agora = new Date();
    if (agora < dataInicio) return "agendado";
    if (agora >= dataInicio && agora <= dataFim) return "ao_vivo";
    return "finalizado";
}

function formatarData(timestamp) {
    const data = timestamp.toDate();
    return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function listarJogos() {
    const lista = document.getElementById("listaJogos");
    lista.innerHTML = "";
    const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();

    for (const doc of snapshot.docs) {
        const jogo = doc.data();

        // Atualiza status automaticamente
        const statusAtualizado = definirStatus(jogo.dataInicio.toDate(), jogo.dataFim.toDate());
        if (jogo.status !== statusAtualizado) {
            await db.collection("jogos").doc(doc.id).update({ status: statusAtualizado });
        }

        const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
        const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

        const timeCasaNome = timeCasaDoc.exists ? timeCasaDoc.data().nome : "-";
        const timeForaNome = timeForaDoc.exists ? timeForaDoc.data().nome : "-";
        const dataInicioFormat = formatarData(jogo.dataInicio);
        const entrada = jogo.valorEntrada + " créditos";

        const row = `
            <tr>
                <td>${timeCasaNome}</td>
                <td>${timeForaNome}</td>
                <td>${dataInicioFormat}</td>
                <td>${entrada}</td>
                <td>${statusAtualizado}</td>
            </tr>
        `;
        lista.innerHTML += row;
    }
}

function adicionarPatrocinador() {
    const container = document.getElementById("patrocinadoresContainer");
    const item = document.createElement("div");
    item.classList.add("patrocinador-item");
    item.innerHTML = `
        <input type="text" class="patrocinador-nome" placeholder="Nome">
        <input type="number" class="patrocinador-valor" placeholder="Valor">
        <input type="text" class="patrocinador-site" placeholder="Site">
        <input type="text" class="patrocinador-logo" placeholder="Logo (URL ou base64)">
    `;
    container.appendChild(item);
}

window.onload = () => {
    carregarTimes();
    listarJogos();
    document.getElementById("btnAdicionarPatrocinador").onclick = adicionarPatrocinador;
    document.getElementById("salvarJogo").onclick = salvarJogo;
};
