// Conexão Firestore já está inicializada pelo firebase-init.js

const db = firebase.firestore();
let edicaoId = null;

window.onload = async () => {
    await carregarTimes();
    listarUsuarios();
};

async function carregarTimes() {
    const timesSelect = document.getElementById("timeId");
    timesSelect.innerHTML = "<option value=''>Selecione</option>";
    const snapshot = await db.collection("times").orderBy("nome").get();
    snapshot.forEach(doc => {
        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = doc.data().nome;
        timesSelect.appendChild(option);
    });
}

async function salvarUsuario() {
    const usuario = {
        nome: document.getElementById("nome").value,
        dataNascimento: document.getElementById("dataNascimento").value,
        cidade: document.getElementById("cidade").value,
        estado: document.getElementById("estado").value,
        pais: document.getElementById("pais").value,
        email: document.getElementById("email").value,
        celular: document.getElementById("celular").value,
        usuarioUnico: document.getElementById("usuarioUnico").value.toLowerCase(),
        timeId: document.getElementById("timeId").value,
        creditos: parseInt(document.getElementById("creditos").value),
        status: document.getElementById("status").value
    };

    if (edicaoId) {
        await db.collection("usuarios").doc(edicaoId).update(usuario);
        edicaoId = null;
    } else {
        const existe = await db.collection("usuarios").where("usuarioUnico", "==", usuario.usuarioUnico).get();
        if (!existe.empty) {
            alert("Usuário já existe");
            return;
        }
        await db.collection("usuarios").add(usuario);
    }
    limparFormulario();
    listarUsuarios();
}

function limparFormulario() {
    document.getElementById("nome").value = "";
    document.getElementById("dataNascimento").value = "";
    document.getElementById("cidade").value = "";
    document.getElementById("estado").value = "";
    document.getElementById("pais").value = "Brasil";
    document.getElementById("email").value = "";
    document.getElementById("celular").value = "";
    document.getElementById("usuarioUnico").value = "";
    document.getElementById("timeId").value = "";
    document.getElementById("creditos").value = 0;
    document.getElementById("status").value = "ativo";
}

async function listarUsuarios() {
    const filtroNome = document.getElementById("filtroNome").value.trim().toLowerCase();
    let query = db.collection("usuarios");
    const snapshot = await query.get();

    const tabela = document.getElementById("usuariosTabela");
    tabela.innerHTML = "";

    for (const doc of snapshot.docs) {
        const user = doc.data();
        if (filtroNome && !user.nome.toLowerCase().includes(filtroNome)) continue;

        const timeDoc = user.timeId ? await db.collection("times").doc(user.timeId).get() : null;
        const timeNome = timeDoc && timeDoc.exists ? timeDoc.data().nome : "-";

        const linha = `<tr>
            <td>${user.nome}</td>
            <td>${user.usuarioUnico}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        </tr>`;
        tabela.innerHTML += linha;
    }
}

async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    if (!doc.exists) return alert("Usuário não encontrado!");

    const u = doc.data();
    edicaoId = id;

    document.getElementById("nome").value = u.nome;
    document.getElementById("dataNascimento").value = u.dataNascimento;
    document.getElementById("cidade").value = u.cidade;
    document.getElementById("estado").value = u.estado;
    document.getElementById("pais").value = u.pais;
    document.getElementById("email").value = u.email;
    document.getElementById("celular").value = u.celular;
    document.getElementById("usuarioUnico").value = u.usuarioUnico;
    document.getElementById("timeId").value = u.timeId;
    document.getElementById("creditos").value = u.creditos;
    document.getElementById("status").value = u.status;
}
