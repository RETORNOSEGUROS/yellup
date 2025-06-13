const db = firebase.firestore();
const auth = firebase.auth();

window.onload = async () => {
    await carregarTimes();
    listarUsuarios();
};

async function carregarTimes() {
    const timesSnap = await db.collection("times").orderBy("nome").get();
    const timeSelect = document.getElementById("timeSelect");
    timeSelect.innerHTML = `<option value="">Selecione</option>`;
    timesSnap.forEach(doc => {
        const data = doc.data();
        timeSelect.innerHTML += `<option value="${doc.id}">${data.nome}</option>`;
    });
}

async function salvarUsuario() {
    const id = document.getElementById("idUsuario").value;
    const usuario = document.getElementById("usuario").value;

    if (!id) {
        const duplicado = await db.collection("usuarios").where("usuario", "==", usuario).get();
        if (!duplicado.empty) {
            alert("Usuário já existe.");
            return;
        }
    }

    const dados = {
        nome: document.getElementById("nome").value,
        dataNascimento: document.getElementById("dataNascimento").value,
        cidade: document.getElementById("cidade").value,
        estado: document.getElementById("estado").value,
        pais: document.getElementById("pais").value,
        email: document.getElementById("email").value,
        celular: document.getElementById("celular").value,
        usuario: usuario,
        timeId: document.getElementById("timeSelect").value,
        creditos: parseInt(document.getElementById("creditos").value),
        status: document.getElementById("status").value,
        dataCadastro: new Date()
    };

    if (id) {
        await db.collection("usuarios").doc(id).update(dados);
    } else {
        await db.collection("usuarios").add(dados);
    }
    
    alert("Salvo com sucesso!");
    limparForm();
    listarUsuarios();
}

function limparForm() {
    document.querySelectorAll("input, select").forEach(el => el.value = "");
}

async function listarUsuarios() {
    const filtro = document.getElementById("filtroNome").value.toLowerCase();
    let snap = await db.collection("usuarios").orderBy("nome").get();

    const tabela = document.getElementById("tabelaUsuarios");
    tabela.innerHTML = "";

    snap.forEach(doc => {
        const data = doc.data();
        if (data.nome.toLowerCase().includes(filtro)) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${data.nome}</td>
                <td>${data.usuario}</td>
                <td>${data.timeId}</td>
                <td>${data.status}</td>
                <td>${data.creditos}</td>
                <td>
                    <button onclick="editarUsuario('${doc.id}')">Editar</button>
                    <button onclick="resetSenha('${data.email}')">Reset Senha</button>
                </td>
            `;
            tabela.appendChild(tr);
        }
    });
}

async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    const data = doc.data();
    document.getElementById("idUsuario").value = id;
    document.getElementById("nome").value = data.nome;
    document.getElementById("dataNascimento").value = data.dataNascimento;
    document.getElementById("cidade").value = data.cidade;
    document.getElementById("estado").value = data.estado;
    document.getElementById("pais").value = data.pais;
    document.getElementById("email").value = data.email;
    document.getElementById("celular").value = data.celular;
    document.getElementById("usuario").value = data.usuario;
    document.getElementById("timeSelect").value = data.timeId;
    document.getElementById("creditos").value = data.creditos;
    document.getElementById("status").value = data.status;
}

async function resetSenha(email) {
    if (confirm(`Deseja enviar email de reset para ${email}?`)) {
        await auth.sendPasswordResetEmail(email);
        alert("E-mail de redefinição enviado!");
    }
}
