const db = firebase.firestore();

async function carregarTimes() {
    const timesRef = await db.collection("times").orderBy("nome").get();
    const selectCasa = document.getElementById("timeCasa");
    const selectVisitante = document.getElementById("timeVisitante");
    timesRef.forEach(doc => {
        let option = document.createElement("option");
        option.value = doc.id;
        option.textContent = doc.data().nome;
        selectCasa.appendChild(option.cloneNode(true));
        selectVisitante.appendChild(option.cloneNode(true));
    });
}

function adicionarPatrocinador() {
    const container = document.getElementById("patrocinadores");
    const div = document.createElement("div");
    div.innerHTML = `
        <input placeholder="Nome" class="pat-nome">
        <input placeholder="Valor" type="number" class="pat-valor">
        <input placeholder="Logo URL" class="pat-logo">
        <input placeholder="Site" class="pat-site">
        <hr>
    `;
    container.appendChild(div);
}

async function salvarJogo() {
    const jogo = {
        timeCasaId: document.getElementById("timeCasa").value,
        timeForaId: document.getElementById("timeVisitante").value,
        dataInicio: document.getElementById("dataInicio").value,
        dataFim: document.getElementById("dataFim").value,
        valorEntrada: parseInt(document.getElementById("valorEntrada").value),
        status: document.getElementById("status").value,
        patrocinadores: []
    };

    document.querySelectorAll("#patrocinadores div").forEach(div => {
        const pat = {
            nome: div.querySelector(".pat-nome").value,
            valor: parseInt(div.querySelector(".pat-valor").value),
            logo: div.querySelector(".pat-logo").value,
            site: div.querySelector(".pat-site").value
        };
        jogo.patrocinadores.push(pat);
    });

    await db.collection("jogos").add(jogo);
    alert("Jogo salvo com sucesso!");
    listarJogos();
}

async function listarJogos() {
    const lista = document.getElementById("listaJogos");
    lista.innerHTML = "";
    const jogosSnap = await db.collection("jogos").get();
    for (const doc of jogosSnap.docs) {
        const data = doc.data();

        const timeCasa = await db.collection("times").doc(data.timeCasaId).get();
        const timeFora = await db.collection("times").doc(data.timeForaId).get();

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${timeCasa.exists ? timeCasa.data().nome : "-"}</td>
            <td>${timeFora.exists ? timeFora.data().nome : "-"}</td>
            <td>${data.dataInicio}</td>
            <td>${data.valorEntrada} créditos</td>
            <td>${data.status}</td>
        `;
        lista.appendChild(tr);
    }
}

window.onload = () => {
    carregarTimes();
    listarJogos();
}
