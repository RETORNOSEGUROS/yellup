// usuarios.js atualizado

// Inicializando o Firebase Modular (você já tem firebase-init.js separadamente)

import { getFirestore, collection, query, where, getDocs, addDoc, updateDoc, doc, Timestamp } from "firebase/firestore";
import { getApp } from "firebase/app";

const db = getFirestore(getApp());
let editingUserId = null;

// Função para carregar os times no select
async function carregarTimes() {
    const timeSelect = document.getElementById('timeSelect');
    timeSelect.innerHTML = '<option value="">Selecione</option>';

    const timesSnapshot = await getDocs(collection(db, "times"));
    timesSnapshot.forEach(doc => {
        const option = document.createElement("option");
        option.value = doc.id;
        option.textContent = doc.data().nome;
        timeSelect.appendChild(option);
    });
}

async function salvarUsuario() {
    const nome = document.getElementById('nome').value.trim();
    const dataNascimento = document.getElementById('dataNascimento').value.trim();
    const cidade = document.getElementById('cidade').value.trim();
    const estado = document.getElementById('estado').value.trim();
    const pais = document.getElementById('pais').value.trim();
    const email = document.getElementById('email').value.trim();
    const celular = document.getElementById('celular').value.trim();
    const usuario = document.getElementById('usuario').value.trim().toLowerCase();
    const timeId = document.getElementById('timeSelect').value;
    const creditos = parseInt(document.getElementById('creditos').value.trim()) || 0;
    const status = document.getElementById('status').value;

    if (!nome || !usuario) {
        alert("Preencha todos os campos obrigatórios (nome e usuário).");
        return;
    }

    if (!editingUserId) {
        const q = query(collection(db, "usuarios"), where("usuario", "==", usuario));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            alert("Este nome de usuário já está em uso.");
            return;
        }
    }

    const dadosUsuario = {
        nome, dataNascimento, cidade, estado, pais, email, celular, usuario,
        timeId, creditos, status, dataCadastro: editingUserId ? undefined : Timestamp.now()
    };

    try {
        if (editingUserId) {
            await updateDoc(doc(db, "usuarios", editingUserId), dadosUsuario);
            alert("Usuário atualizado com sucesso!");
            editingUserId = null;
        } else {
            await addDoc(collection(db, "usuarios"), dadosUsuario);
            alert("Usuário cadastrado com sucesso!");
        }
        limparCampos();
        listarUsuarios();
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
    document.getElementById('timeSelect').value = '';
    document.getElementById('creditos').value = 0;
    document.getElementById('status').value = 'ativo';
}

async function listarUsuarios() {
    const filtro = document.getElementById('filtroNome').value.trim();
    const tabela = document.getElementById('tabelaUsuarios');
    tabela.innerHTML = "";

    let q = collection(db, "usuarios");
    if (filtro) {
        q = query(q, where("nome", ">=", filtro), where("nome", "<=", filtro + "\uf8ff"));
    }

    const snapshot = await getDocs(q);

    snapshot.forEach(docSnap => {
        const user = docSnap.data();
        const linha = document.createElement("tr");

        linha.innerHTML = `
            <td>${user.nome}</td>
            <td>${user.usuario}</td>
            <td>${user.timeId || '-'}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td><button onclick="editarUsuario('${docSnap.id}', ${JSON.stringify(user).replace(/"/g, '&quot;')})">Editar</button></td>
        `;
        tabela.appendChild(linha);
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
    document.getElementById('timeSelect').value = user.timeId || '';
    document.getElementById('creditos').value = user.creditos || 0;
    document.getElementById('status').value = user.status || 'ativo';
}

// Inicializa ao carregar a página
window.onload = () => {
    carregarTimes();
    listarUsuarios();
}
