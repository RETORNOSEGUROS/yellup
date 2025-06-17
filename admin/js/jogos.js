async function carregarTimes() {
    const timesRef = await db.collection("times").orderBy("nome").get();
    const selects = [document.getElementById("timeCasa"), document.getElementById("timeVisitante")];
    selects.forEach(select => {
        select.innerHTML = '<option value="">Selecione o Time</option>';
    });

    timesRef.forEach(doc => {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.data().nome;
        selects.forEach(select => select.appendChild(opt.cloneNode(true)));
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

    const jogoData = {
        timeCasaId,
        timeForaId,
        dataInicio,
        dataFim,
        valorEntrada,
        status,
        patrocinadores
    };

    await db.collection("jogos").add(jogoData);
    alert("Jogo salvo com sucesso!");
    listarJogos();
}

async function listarJogos() {
    const lista = document.getElementById("listaJogos");
    lista.innerHTML = "";

    const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();

    const agora = new Date();

    for (const doc of snapshot.docs) {
        const jogo = doc.data();

        const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
        const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

        const timeCasaNome = timeCasaDoc.exists ? timeCasaDoc.data().nome : "-";
        const timeForaNome = timeForaDoc.exists ? timeForaDoc.data().nome : "-";

        const dataInicio = jogo.dataInicio.toDate();

        let statusCalculado = jogo.status;
        if (dataInicio <= agora && jogo.dataFim.toDate() >= agora) {
            statusCalculado = "ao_vivo";
        } else if (jogo.dataFim.toDate() < agora) {
            statusCalculado = "finalizado";
        }

        const row = `
            <tr>
                <td>${timeCasaNome}</td>
                <td>${timeForaNome}</td>
                <td>${dataInicio.toLocaleString()}</td>
                <td>${jogo.valorEntrada} créditos</td>
                <td>${statusCalculado}</td>
                <td><button onclick="editarJogo('${doc.id}')">Editar</button></td>
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
        <input type="number" class="patrocinador-valor" placeholder="Valor (R$)">
        <input type="text" class="patrocinador-site" placeholder="Site">
        <input type="text" class="patrocinador-logo" placeholder="Logo (URL ou base64)">
    `;
    container.appendChild(item);
}

async function editarJogo(id) {
    const doc = await db.collection("jogos").doc(id).get();
    const jogo = doc.data();

    document.getElementById("timeCasa").value = jogo.timeCasaId;
    document.getElementById("timeVisitante").value = jogo.timeForaId;
    document.getElementById("dataInicio").value = jogo.dataInicio.toDate().toISOString().slice(0, 16);
    document.getElementById("dataFim").value = jogo.dataFim.toDate().toISOString().slice(0, 16);
    document.getElementById("valorEntrada").value = jogo.valorEntrada;
    document.getElementById("status").value = jogo.status;

    document.getElementById("patrocinadoresContainer").innerHTML = "";

    jogo.patrocinadores?.forEach(p => {
        const item = document.createElement("div");
        item.classList.add("patrocinador-item");
        item.innerHTML = `
            <input type="text" class="patrocinador-nome" value="${p.nome}">
            <input type="number" class="patrocinador-valor" value="${p.valor}">
            <input type="text" class="patrocinador-site" value="${p.site}">
            <input type="text" class="patrocinador-logo" value="${p.logo}">
        `;
        document.getElementById("patrocinadoresContainer").appendChild(item);
    });

    // Atualizar botão para "Atualizar"
    document.getElementById("salvarJogo").onclick = async function () {
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

        await db.collection("jogos").doc(id).update({
            timeCasaId,
            timeForaId,
            dataInicio,
            dataFim,
            valorEntrada,
            status,
            patrocinadores
        });

        alert("Jogo atualizado com sucesso!");
        listarJogos();
    }
}

window.onload = () => {
    carregarTimes();
    listarJogos();
    document.getElementById("btnAdicionarPatrocinador").onclick = adicionarPatrocinador;
    document.getElementById("salvarJogo").onclick = salvarJogo;
};
