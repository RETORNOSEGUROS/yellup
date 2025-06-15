// usuarios.js

// Conexão com Firestore já vem do firebase-init.js

// Carregar times ao abrir a página
document.addEventListener("DOMContentLoaded", async () => {
    await carregarTimes();
    await carregarUsuarios();
});

async function carregarTimes() {
    const timeSelect = document.getElementById("timeCoracao");
    timeSelect.innerHTML = "<option value=''>Selecione o Time</option>";

    try {
        const timesSnapshot = await db.collection("times").get();
        timesSnapshot.forEach(doc => {
            const time = doc.data();
            const option = document.createElement("option");
            option.value = doc.id;
            option.textContent = time.nome;
            timeSelect.appendChild(option);
        });
    } catch (error) {
        console.error("Erro ao carregar times:", error);
    }
}

async function carregarUsuarios() {
    const tbody = document.getElementById("usuariosTableBody");
    tbody.innerHTML = "";

    const usuariosSnapshot = await db.collection("usuarios").get();
    usuariosSnapshot.forEach(doc => {
        const usuario = doc.data();
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${usuario.nome || "-"}</td>
            <td>${usuario.usuario || "-"}</td>
            <td>${usuario.timeId || "-"}</td>
            <td>${usuario.status || "-"}</td>
            <td>${usuario.creditos || 0}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        `;
        tbody.appendChild(tr);
    });
}

async function salvarUsuario() {
    const nome = document.getElementById("nome").value.trim();
    const dataNascimento = document.getElementById("dataNascimento").value.trim();
    const cidade = document.getElementById("cidade").value.trim();
    const estado = document.getElementById("estado").value.trim();
    const pais = document.getElementById("pais").value.trim();
    const email = document.getElementById("email").value.trim();
    const celular = document.getElementById("celular").value.trim();
    const usuario = document.getElementById("usuario").value.trim().toLowerCase();
    const timeId = document.getElementById("timeCoracao").value;
    const creditos = parseInt(document.getElementById("creditos").value) || 0;
    const status = document.getElementById("status").value;

    if (!usuario || !nome) {
        alert("Preencha o Nome e o Usuário.");
        return;
    }

    // Verifica se o usuário já existe (no modo cadastro novo)
    const querySnapshot = await db.collection("usuarios").where("usuario", "==", usuario).get();
    if (!editingId && !querySnapshot.empty) {
        alert("Este nome de usuário já existe.");
        return;
    }

    const dados = {
        nome, dataNascimento, cidade, estado, pais, email, celular, usuario,
        timeId, creditos, status,
        dataCadastro: firebase.firestore.FieldValue.serverTimestamp(),
        ultimoAcesso: null,
        qtdAcessos: 0
    };

    try {
        if (editingId) {
            await db.collection("usuarios").doc(editingId).update(dados);
            editingId = null;
        } else {
            await db.collection("usuarios").add(dados);
        }
        limparCampos();
        carregarUsuarios();
        alert("Usuário salvo com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar usuário:", error);
        alert("Erro ao salvar.");
    }
}

let editingId = null;

async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    if (!doc.exists) return alert("Usuário não encontrado.");

    const usuario = doc.data();
    editingId = id;

    document.getElementById("nome").value = usuario.nome || "";
    document.getElementById("dataNascimento").value = usuario.dataNascimento || "";
    document.getElementById("cidade").value = usuario.cidade || "";
    document.getElementById("estado").value = usuario.estado || "";
    document.getElementById("pais").value = usuario.pais || "Brasil";
    document.getElementById("email").value = usuario.email || "";
    document.getElementById("celular").value = usuario.celular || "";
    document.getElementById("usuario").value = usuario.usuario || "";
    document.getElementById("timeCoracao").value = usuario.timeId || "";
    document.getElementById("creditos").value = usuario.creditos || 0;
    document.getElementById("status").value = usuario.status || "ativo";
}

function limparCampos() {
    document.querySelectorAll("input").forEach(i => i.value = "");
    document.getElementById("status").value = "ativo";
    document.getElementById("pais").value = "Brasil";
}
