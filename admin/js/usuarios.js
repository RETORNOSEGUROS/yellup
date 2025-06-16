const db = firebase.firestore();

async function carregarTimes() {
    const timesRef = await db.collection("times").orderBy("nome").get();
    const select = document.getElementById("timeId");
    select.innerHTML = '<option value="">Selecione o Time</option>';
    timesRef.forEach(doc => {
        let item = doc.data();
        let opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = item.nome;
        select.appendChild(opt);
    });
}

function gerarDados() {
    return {
        nome: document.getElementById("nome").value,
        dataNascimento: document.getElementById("dataNascimento").value,
        cidade: document.getElementById("cidade").value,
        estado: document.getElementById("estado").value,
        pais: document.getElementById("pais").value,
        email: document.getElementById("email").value,
        celular: document.getElementById("celular").value,
        usuario: document.getElementById("usuarioUnico").value.toLowerCase(),
        timeId: document.getElementById("timeId").value,
        creditos: parseInt(document.getElementById("creditos").value) || 0,
        status: document.getElementById("status").value,
        creditosBloqueados: 0,
        indicadoPor: "",
        fotoPerfil: "",
        papel: "usuario",
        totalAcessos: 0,
        ultimoLogin: firebase.firestore.FieldValue.serverTimestamp(),
        dataCadastro: firebase.firestore.FieldValue.serverTimestamp()
    };
}

async function salvarUsuario() {
    const usuarioUnico = document.getElementById("usuarioUnico").value.trim().toLowerCase();
    if (!usuarioUnico) return alert("Preencha o campo de usuário!");
    const ref = db.collection("usuarios").doc(usuarioUnico);
    const snap = await ref.get();

    if (!snap.exists) {
        await ref.set(gerarDados());
    } else {
        const dadosExistente = gerarDados();
        delete dadosExistente.dataCadastro;  // não sobrescreve dataCadastro na edição
        await ref.update(dadosExistente);
    }
    alert("Usuário salvo com sucesso.");
    carregarUsuarios();
}

async function carregarUsuarios() {
    const filtro = document.getElementById("filtro").value.toLowerCase();
    const lista = document.getElementById("listaUsuarios");
    lista.innerHTML = "";

    const usuariosSnap = await db.collection("usuarios").get();
    for (let doc of usuariosSnap.docs) {
        const user = doc.data();
        if (filtro && !user.nome.toLowerCase().includes(filtro)) continue;

        let timeNome = "-";
        if (user.timeId) {
            const timeSnap = await db.collection("times").doc(user.timeId).get();
            if (timeSnap.exists) timeNome = timeSnap.data().nome;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${user.nome}</td>
            <td>${user.usuario}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>`;
        lista.appendChild(tr);
    }
}

async function editarUsuario(id) {
    const ref = await db.collection("usuarios").doc(id).get();
    const data = ref.data();

    document.getElementById("nome").value = data.nome;
    document.getElementById("dataNascimento").value = data.dataNascimento || "";
    document.getElementById("cidade").value = data.cidade || "";
    document.getElementById("estado").value = data.estado || "";
    document.getElementById("pais").value = data.pais || "";
    document.getElementById("email").value = data.email || "";
    document.getElementById("celular").value = data.celular || "";
    document.getElementById("usuarioUnico").value = data.usuario;
    document.getElementById("timeId").value = data.timeId || "";
    document.getElementById("creditos").value = data.creditos || 0;
    document.getElementById("status").value = data.status || "ativo";
}

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
};
