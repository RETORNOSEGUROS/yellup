const db = firebase.firestore();
let jogoSelecionado = null;

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

function adicionarPatrocinador() {
    const container = document.getElementById("patrocinadoresContainer");
    const div = document.createElement("div");
    div.className = "patrocinador-item";
    div.innerHTML = `
        <input placeholder="Nome" class="patrocinador-nome">
        <input placeholder="Valor (ex: 1000)" class="patrocinador-valor">
        <input placeholder="Site (opcional)" class="patrocinador-site">
        <input placeholder="Logo (URL base64)" class="patrocinador-logo">
    `;
    container.appendChild(div);
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

    const jogoData = {
        timeCasaId, timeForaId, dataInicio, dataFim, valorEntrada, status, patrocinadores
    };

    if (jogoSelecionado) {
        await db.collection("jogos").doc(jogoSelecionado).update(jogoData);
        jogoSelecionado = null;
    } else {
        await db.collection("jogos").add(jogoData);
    }

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
        const entrada = jogo.valorEntrada + " créditos";

        const row = `
            <tr>
                <td>${timeCasaNome}</td>
                <td>${timeForaNome}</td>
                <td>${dataInicioFormat}</td>
                <td>${entrada}</td>
                <td>${jogo.status}</td>
                <td>
                    <button class="btn-acao" onclick="editarJogo('${doc.id}')">Editar</button>
                    <button class="btn-acao btn-finalizar" onclick="encerrarJogo('${doc.id}')">Encerrar</button>
                </td>
            </tr>`;
        lista.innerHTML += row;
    }
}

async function editarJogo(id) {
    const doc = await db.collection("jogos").doc(id).get();
    const jogo = doc.data();

    document.getElementById("timeCasa").value = jogo.timeCasaId;
    document.getElementById("timeVisitante").value = jogo.timeForaId;
    document.getElementById("dataInicio").value = jogo.dataInicio.toDate().toISOString().slice(0,16);
    document.getElementById("dataFim").value = jogo.dataFim.toDate().toISOString().slice(0,16);
    document.getElementById("valorEntrada").value = jogo.valorEntrada;
    document.getElementById("status").value = jogo.status;

    document.getElementById("patrocinadoresContainer").innerHTML = "";
    jogo.patrocinadores?.forEach(p => {
        const div = document.createElement("div");
        div.className = "patrocinador-item";
        div.innerHTML = `
            <input placeholder="Nome" class="patrocinador-nome" value="${p.nome}">
            <input placeholder="Valor" class="patrocinador-valor" value="${p.valor}">
            <input placeholder="Site" class="patrocinador-site" value="${p.site}">
            <input placeholder="Logo" class="patrocinador-logo" value="${p.logo}">
        `;
        document.getElementById("patrocinadoresContainer").appendChild(div);
    });

    jogoSelecionado = id;
}

async function encerrarJogo(id) {
    await db.collection("jogos").doc(id).update({ status: "finalizado" });
    listarJogos();
}

window.onload = () => {
    carregarTimes();
    listarJogos();
    document.getElementById("btnAdicionarPatrocinador").onclick = adicionarPatrocinador;
    document.getElementById("salvarJogo").onclick = salvarJogo;
}
