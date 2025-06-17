async function carregarTimes() {
    const selectCasa = document.getElementById("timeCasaId");
    const selectFora = document.getElementById("timeForaId");

    selectCasa.innerHTML = selectFora.innerHTML = `<option value="">Selecione o Time</option>`;

    const snapshot = await db.collection("times").orderBy("nome").get();
    snapshot.forEach(doc => {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.data().nome;
        selectCasa.appendChild(opt.cloneNode(true));
        selectFora.appendChild(opt);
    });
}

function adicionarPatrocinador() {
    const container = document.getElementById("patrocinadores");
    const div = document.createElement("div");
    div.className = "patrocinador-item";
    div.innerHTML = `
        <input placeholder="Nome" class="nome">
        <input placeholder="Valor" type="number" class="valor">
        <input placeholder="Site" class="site">
        <input placeholder="Logo (URL)" class="logo">
        <button onclick="this.parentElement.remove()">Remover</button>
    `;
    container.appendChild(div);
}

async function salvarJogo() {
    const timeCasaId = document.getElementById("timeCasaId").value;
    const timeForaId = document.getElementById("timeForaId").value;
    const dataInicio = document.getElementById("dataInicio").value;
    const dataFim = document.getElementById("dataFim").value;

    if (!timeCasaId || !timeForaId) return alert("Selecione os dois times.");
    if (timeCasaId === timeForaId) return alert("Os times não podem ser iguais.");
    if (!dataInicio || !dataFim) return alert("Preencha as datas.");
    if (new Date(dataFim) < new Date(dataInicio)) return alert("Data fim não pode ser antes da data início.");

    const patrocinadores = [];
    document.querySelectorAll(".patrocinador-item").forEach(item => {
        patrocinadores.push({
            nome: item.querySelector(".nome").value,
            valor: parseFloat(item.querySelector(".valor").value) || 0,
            site: item.querySelector(".site").value,
            logo: item.querySelector(".logo").value
        });
    });

    const dados = {
        timeCasaId, timeForaId,
        dataInicio: firebase.firestore.Timestamp.fromDate(new Date(dataInicio)),
        dataFim: firebase.firestore.Timestamp.fromDate(new Date(dataFim)),
        status: document.getElementById("status").value,
        valorEntrada: parseInt(document.getElementById("valorEntrada").value),
        patrocinadores
    };

    await db.collection("jogos").add(dados);
    alert("Jogo cadastrado com sucesso!");
    carregarJogos();
}

async function carregarJogos() {
    const lista = document.getElementById("listaJogos");
    lista.innerHTML = "";

    const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();

    for (const doc of snapshot.docs) {
        const jogo = doc.data();

        const timeCasa = await buscarNomeTime(jogo.timeCasaId);
        const timeFora = await buscarNomeTime(jogo.timeForaId);
        const inicio = jogo.dataInicio.toDate().toLocaleString();

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${timeCasa}</td>
            <td>${timeFora}</td>
            <td>${inicio}</td>
            <td>${jogo.valorEntrada}</td>
            <td>${jogo.status}</td>
            <td><button onclick="removerJogo('${doc.id}')">Excluir</button></td>
        `;
        lista.appendChild(tr);
    }
}

async function buscarNomeTime(id) {
    if (!id) return "-";
    const doc = await db.collection("times").doc(id).get();
    return doc.exists ? doc.data().nome : "-";
}

async function removerJogo(id) {
    if (confirm("Deseja excluir este jogo?")) {
        await db.collection("jogos").doc(id).delete();
        carregarJogos();
    }
}

window.onload = () => {
    carregarTimes();
    carregarJogos();
}
