// usuarios.js

const db = firebase.firestore();

let editingUserId = null;

async function salvarUsuario() {
    const nome = document.getElementById('nome').value.trim();
    const dataNascimento = document.getElementById('dataNascimento').value.trim();
    const cidade = document.getElementById('cidade').value.trim();
    const estado = document.getElementById('estado').value.trim();
    const pais = document.getElementById('pais').value.trim();
    const email = document.getElementById('email').value.trim();
    const celular = document.getElementById('celular').value.trim();
    const usuario = document.getElementById('usuario').value.trim().toLowerCase();
    const timeId = document.getElementById('timeId').value.trim();
    const creditos = parseInt(document.getElementById('creditos').value.trim()) || 0;
    const status = document.getElementById('status').value;

    if (!nome || !usuario) {
        alert("Preencha todos os campos obrigatórios (nome e usuário).");
        return;
    }

    if (!editingUserId) {
        const usuarioQuery = await db.collection("usuarios").where("usuario", "==", usuario).get();
        if (!usuarioQuery.empty) {
            alert("Este nome de usuário já está em uso.");
            return;
        }
    }

    const dadosUsuario = {
        nome,
        dataNascimento,
        cidade,
        estado,
        pais,
        email,
        celular,
        usuario,
        timeId,
        creditos,
        status,
        dataCadastro: editingUserId ? undefined : firebase.firestore.Timestamp.now()
    };

    try {
        if (editingUserId) {
            await db.collection("usuarios").doc(editingUserId).update(dadosUsuario);
            alert("Usuário atualizado com sucesso!");
            editingUserId = null;
        } else {
            await db.collection("usuarios").add(dadosUsuario);
            alert("Usuário cadastrado com sucesso!");
        }
        limparCampos();
        carregarUsuarios();
    } catch (error) {
        console.error("Erro ao salvar:", error);
        alert("Erro ao salvar usuário.");
    }
}

function limparCampos() {
    document.getElementById('nome').value = '';
    document.getElementById('dataNascimento').value = '';
    document.getElementById('cidade').value = '';
    document.getElementById('estado').value = '';
    document.getElementById('pais').value = 'Brasil';
    document.getElementById('email').value = '';
    document.getElementById('celular').value = '';
    document.getElementById('usuario').value = '';
    document.getElementById('timeId').value = '';
    document.getElementById('creditos').value = 0;
    document.getElementById('status').value = 'Ativo';
}

async function carregarUsuarios(filtro = '') {
    const tabela = document.querySelector("#usuariosTable tbody");
    tabela.innerHTML = "";

    let query = db.collection("usuarios");
    if (filtro) {
        query = query.where("nome", ">=", filtro).where("nome", "<=", filtro + "\uf8ff");
    }

    const snapshot = await query.get();

    snapshot.forEach(doc => {
        const user = doc.data();
        const linha = tabela.insertRow();

        linha.insertCell().textContent = user.nome;
        linha.insertCell().textContent = user.usuario || '-';
        linha.insertCell().textContent = user.timeId || '-';
        linha.insertCell().textContent = user.status || '-';
        linha.insertCell().textContent = user.creditos || 0;

        const btnEditar = document.createElement("button");
        btnEditar.textContent = "Editar";
        btnEditar.onclick = () => editarUsuario(doc.id, user);
        linha.insertCell().appendChild(btnEditar);
    });
}

function editarUsuario(id, user) {
    editingUserId = id;

    document.getElementById('nome').value = user.nome || '';
    document.getElementById('dataNascimento').value = user.dataNascimento || '';
    document.getElementById('cidade').value = user.cidade || '';
    document.getElementById('estado').value = user.estado || '';
    document.getElementById('pais').value = user.pais || 'Brasil';
    document.getElementById('email').value = user.email || '';
    document.getElementById('celular').value = user.celular || '';
    document.getElementById('usuario').value = user.usuario || '';
    document.getElementById('timeId').value = user.timeId || '';
    document.getElementById('creditos').value = user.creditos || 0;
    document.getElementById('status').value = user.status || 'Ativo';
}

document.getElementById('buscarBtn').addEventListener('click', () => {
    const filtro = document.getElementById('busca').value.trim();
    carregarUsuarios(filtro);
});

// Carregar ao abrir a página
carregarUsuarios();
