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
    const dataInicio = document.getElementById("dataInicio").value;
    const dataFim = document.getElementById("dataFim").value;
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

    const docId = `${dataInicio}`;
    await db.collection("jogos").doc(docId).set({
        timeCasaId, timeForaId, dataInicio, dataFim, valorEntrada, status, patrocinadores
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

        let timeCasaNome = "-";
        let timeForaNome = "-";

        if (jogo.timeCasaId) {
            const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
            timeCasaNome = timeCasaDoc.exists ? timeCasaDoc.data().nome : "-";
        }

        if (jogo.timeForaId) {
            const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();
            timeForaNome = timeForaDoc.exists ? timeForaDoc.data().nome : "-";
        }

        const row = `
            <tr>
                <td>${timeCasaNome}</td>
                <td>${timeForaNome}</td>
                <td>${jogo.dataInicio}</td>
                <td>${jogo.valorEntrada} créditos</td>
                <td>${jogo.status}</td>
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
        <input class="patrocinador-nome" placeholder="Nome">
        <input class="patrocinador-valor" type="number" placeholder="Valor">
        <input class="patrocinador-site" placeholder="Site">
        <input class="patrocinador-logo" placeholder="Logo (base64 ou url)">
    `;
    container.appendChild(item);
}

window.onload = () => {
    carregarTimes();
    listarJogos();
    document.getElementById("salvarJogo").onclick = salvarJogo;
    document.getElementById("btnAdicionarPatrocinador").onclick = adicionarPatrocinador;
}
