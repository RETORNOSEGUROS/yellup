let docEmEdicao = null;

// Carrega times para o select
async function carregarTimes() {
    const select = document.getElementById("timeId");
    select.innerHTML = `<option value="">Selecione o Time</option>`;
    const snapshot = await db.collection("times").orderBy("nome").get();
    snapshot.forEach(doc => {
        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = doc.data().nome;
        select.appendChild(option);
    });
}

// Salvar usuário com validação de duplicidade
async function salvarUsuario() {
    const dados = coletarDadosFormulario();

    if (!dados.usuarioUnico) {
        alert("Preencha o campo de usuário!");
        return;
    }

    // Verifica duplicidade
    const usuariosRef = db.collection("usuarios");
    const query = await usuariosRef.where("usuarioUnico", "==", dados.usuarioUnico).get();

    if (!docEmEdicao && !query.empty) {
        alert("Usuário já cadastrado. Escolha outro.");
        return;
    }

    if (docEmEdicao) {
        await usuariosRef.doc(docEmEdicao).update(dados);
        alert("Usuário atualizado com sucesso.");
    } else {
        await usuariosRef.add(dados);
        alert("Usuário cadastrado com sucesso.");
    }

    limparFormulario();
    carregarUsuarios();
}

function coletarDadosFormulario() {
    return {
        nome: document.getElementById("nome").value,
        dataNascimento: document.getElementById("dataNascimento").value,
        cidade: document.getElementById("cidade").value,
        estado: document.getElementById("estado").value,
        pais: document.getElementById("pais").value,
        email: document.getElementById("email").value,
        celular: document.getElementById("celular").value,
        usuarioUnico: document.getElementById("usuarioUnico").value.trim().toLowerCase(),
        timeId: document.getElementById("timeId").value,
        creditos: parseInt(document.getElementById("creditos").value) || 0,
        indicadoPor: document.getElementById("indicadoPor").value.trim(),
        status: document.getElementById("status").value
    };
}

async function carregarUsuarios() {
    const filtro = document.getElementById("filtro").value.toLowerCase();
    const lista = document.getElementById("listaUsuarios");
    lista.innerHTML = "";

    const snapshot = await db.collection("usuarios").get();
    for (const doc of snapshot.docs) {
        const user = doc.data();
        if (filtro && !user.nome.toLowerCase().includes(filtro)) continue;

        let timeNome = '-';
        if (user.timeId) {
            const timeDoc = await db.collection("times").doc(user.timeId).get();
            if (timeDoc.exists) timeNome = timeDoc.data().nome;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${user.nome}</td>
            <td>${user.usuarioUnico}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td>${user.indicadoPor || '-'}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        `;
        lista.appendChild(tr);
    }
}

async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    const data = doc.data();

    document.getElementById("documentId").value = id;
    docEmEdicao = id;

    document.getElementById("nome").value = data.nome || "";
    document.getElementById("dataNascimento").value = data.dataNascimento || "";
    document.getElementById("cidade").value = data.cidade || "";
    document.getElementById("estado").value = data.estado || "";
    document.getElementById("pais").value = data.pais || "Brasil";
    document.getElementById("email").value = data.email || "";
    document.getElementById("celular").value = data.celular || "";
    document.getElementById("usuarioUnico").value = data.usuarioUnico || "";
    document.getElementById("timeId").value = data.timeId || "";
    document.getElementById("creditos").value = data.creditos || 0;
    document.getElementById("indicadoPor").value = data.indicadoPor || "";
    document.getElementById("status").value = data.status || "ativo";
}

function limparFormulario() {
    document.getElementById("documentId").value = "";
    docEmEdicao = null;
    document.querySelectorAll("input, select").forEach(input => {
        if (input.type === "number") input.value = 0;
        else if (input.tagName === "SELECT") input.value = "";
        else input.value = "";
    });
    document.getElementById("pais").value = "Brasil";
}

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
}
