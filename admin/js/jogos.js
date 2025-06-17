let jogoEditandoId = null;

async function carregarTimes() {
    const timesRef = await db.collection("times").orderBy("nome").get();
    const selects = [document.getElementById("timeCasa"), document.getElementById("timeVisitante")];
    selects.forEach(select => {
        select.innerHTML = '<option value="">Selecione o Time</option>';
        timesRef.forEach(doc => {
            const data = doc.data();
            const opt = document.createElement("option");
            opt.value = doc.id;
            opt.textContent = data.nome + ' - ' + (data.pais || '');
            select.appendChild(opt);
        });
    });
}

function formatarData(timestamp) {
    if (typeof timestamp?.toDate === "function") {
        return timestamp.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    }
    if (typeof timestamp === "string") {
        return new Date(timestamp).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    }
    return "-";
}

function definirStatus(dataInicio, dataFim) {
    const agora = new Date();
    if (agora < dataInicio) return "agendado";
    if (agora >= dataInicio && agora <= dataFim) return "ao_vivo";
    return "finalizado";
}

async function listarJogos() {
    const lista = document.getElementById("listaJogos");
    lista.innerHTML = "";
    const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();

    for (const doc of snapshot.docs) {
        const jogo = doc.data();

        const dataInicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio);
        const dataFim = jogo.dataFim?.toDate?.() || new Date(jogo.dataFim);

        const statusAtualizado = definirStatus(dataInicio, dataFim);
        if (jogo.status !== statusAtualizado) {
            await db.collection("jogos").doc(doc.id).update({ status: statusAtualizado });
        }

        const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
        const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

        const timeCasa = timeCasaDoc.exists ? timeCasaDoc.data() : {};
        const timeFora = timeForaDoc.exists ? timeForaDoc.data() : {};

        const timeCasaNome = `${timeCasa.nome || '-'} - ${timeCasa.pais || ''}`;
        const timeForaNome = `${timeFora.nome || '-'} - ${timeFora.pais || ''}`;

        const coresCasa = `
            <span style="display:inline-block;width:18px;height:18px;border-radius:50%;
                background:linear-gradient(to bottom,
                ${timeCasa.primaria || '#000'} 0%,
                ${timeCasa.primaria || '#000'} 33%,
                ${timeCasa.secundaria || '#000'} 33%,
                ${timeCasa.secundaria || '#000'} 66%,
                ${timeCasa.terciaria || '#000'} 66%,
                ${timeCasa.terciaria || '#000'} 100%)">
            </span>`;

        const coresFora = `
            <span style="display:inline-block;width:18px;height:18px;border-radius:50%;
                background:linear-gradient(to bottom,
                ${timeFora.primaria || '#000'} 0%,
                ${timeFora.primaria || '#000'} 33%,
                ${timeFora.secundaria || '#000'} 33%,
                ${timeFora.secundaria || '#000'} 66%,
                ${timeFora.terciaria || '#000'} 66%,
                ${timeFora.terciaria || '#000'} 100%)">
            </span>`;

        const row = `
            <tr>
                <td>${coresCasa} ${timeCasaNome}</td>
                <td>${coresFora} ${timeForaNome}</td>
                <td>${formatarData(jogo.dataInicio)}</td>
                <td>${formatarData(jogo.dataFim)}</td>
                <td>${jogo.valorEntrada || 0} créditos</td>
                <td>${statusAtualizado}</td>
                <td><button onclick="editarJogo('${doc.id}')">Editar</button></td>
            </tr>
        `;
        lista.innerHTML += row;
    }
}

async function salvarJogo() {
    const timeCasaId = document.getElementById("timeCasa").value;
    const timeForaId = document.getElementById("timeVisitante").value;
    const dataInicioInput = document.getElementById("dataInicio").value;
    const dataFimInput = document.getElementById("dataFim").value;

    const dataInicio = firebase.firestore.Timestamp.fromDate(new Date(dataInicioInput));
    const dataFim = firebase.firestore.Timestamp.fromDate(new Date(dataFimInput));

    const valorEntrada = parseInt(document.getElementById("valorEntrada").value) || 0;
    const status = document.getElementById("status").value;

    const patrocinadores = [];
    document.querySelectorAll(".patrocinador-item").forEach(item => {
        patrocinadores.push({
            nome: item.querySelector(".patrocinador-nome").value || "",
            valor: parseInt(item.querySelector(".patrocinador-valor").value) || 0,
            site: item.querySelector(".patrocinador-site").value || "",
            logo: item.querySelector(".patrocinador-logo").value || ""
        });
    });

    const jogoData = {
        timeCasaId, timeForaId, dataInicio, dataFim, valorEntrada, status, patrocinadores
    };

    if (jogoEditandoId) {
        await db.collection("jogos").doc(jogoEditandoId).update(jogoData);
        alert("Jogo atualizado com sucesso!");
        jogoEditandoId = null;
        document.getElementById("salvarJogo").textContent = "Salvar Jogo";
    } else {
        await db.collection("jogos").add(jogoData);
        alert("Jogo salvo com sucesso!");
    }

    listarJogos();
}

async function editarJogo(jogoId) {
    const doc = await db.collection("jogos").doc(jogoId).get();
    if (!doc.exists) return alert("Jogo não encontrado!");

    const jogo = doc.data();
    jogoEditandoId = jogoId;

    document.getElementById("timeCasa").value = jogo.timeCasaId;
    document.getElementById("timeVisitante").value = jogo.timeForaId;

    const inicio = jogo.dataInicio.toDate().toISOString().slice(0, 16);
    const fim = jogo.dataFim.toDate().toISOString().slice(0, 16);

    document.getElementById("dataInicio").value = inicio;
    document.getElementById("dataFim").value = fim;
    document.getElementById("valorEntrada").value = jogo.valorEntrada;
    document.getElementById("status").value = jogo.status;

    document.getElementById("patrocinadoresContainer").innerHTML = "";
    (jogo.patrocinadores || []).forEach(p => {
        const item = document.createElement("div");
        item.classList.add("patrocinador-item");
        item.innerHTML = `
            <input type="text" class="patrocinador-nome" placeholder="Nome" value="${p.nome}">
            <input type="number" class="patrocinador-valor" placeholder="Valor" value="${p.valor}">
            <input type="text" class="patrocinador-site" placeholder="Site" value="${p.site}">
            <input type="text" class="patrocinador-logo" placeholder="Logo (URL ou base64)" value="${p.logo}">
        `;
        document.getElementById("patrocinadoresContainer").appendChild(item);
    });

    document.getElementById("salvarJogo").textContent = "Atualizar Jogo";
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
