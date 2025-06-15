const db = firebase.firestore();

async function carregarTimes() {
    const timesSelect = document.getElementById('timeId');
    timesSelect.innerHTML = '<option value="">Selecione...</option>';

    const snapshot = await db.collection("times").get();
    snapshot.forEach(doc => {
        const time = doc.data();
        let option = document.createElement('option');
        option.value = doc.id;
        option.textContent = time.nome;
        timesSelect.appendChild(option);
    });
}

async function salvarUsuario() {
    const usuario = document.getElementById('usuario').value.trim();
    if (!usuario) { alert("Informe o nome de usuário único!"); return; }

    const docRef = db.collection("usuarios").doc(usuario);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
        await docRef.set({
            nome: document.getElementById('nome').value,
            dataNascimento: document.getElementById('dataNascimento').value,
            cidade: document.getElementById('cidade').value,
            estado: document.getElementById('estado').value,
            pais: document.getElementById('pais').value,
            email: document.getElementById('email').value,
            celular: document.getElementById('celular').value,
            timeId: document.getElementById('timeId').value,
            creditos: parseInt(document.getElementById('creditos').value),
            status: document.getElementById('status').value,
            dataCadastro: new Date(),
            totalAcessos: 0,
            ultimoLogin: null
        });
        alert("Usuário cadastrado com sucesso.");
    } else {
        await docRef.update({
            nome: document.getElementById('nome').value,
            dataNascimento: document.getElementById('dataNascimento').value,
            cidade: document.getElementById('cidade').value,
            estado: document.getElementById('estado').value,
            pais: document.getElementById('pais').value,
            email: document.getElementById('email').value,
            celular: document.getElementById('celular').value,
            timeId: document.getElementById('timeId').value,
            creditos: parseInt(document.getElementById('creditos').value),
            status: document.getElementById('status').value
        });
        alert("Usuário atualizado com sucesso.");
    }
    carregarUsuarios();
}

async function carregarUsuarios() {
    const filtro = document.getElementById('buscaNome').value.trim().toLowerCase();
    const tbody = document.getElementById('tabelaUsuarios');
    tbody.innerHTML = "";

    const snapshot = await db.collection("usuarios").get();
    snapshot.forEach(doc => {
        const user = doc.data();
        if (filtro && !user.nome.toLowerCase().includes(filtro)) return;

        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${user.nome}</td>
            <td>${doc.id}</td>
            <td>${user.timeId}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        `;
        tbody.appendChild(tr);
    });
}

async function editarUsuario(usuarioId) {
    const doc = await db.collection("usuarios").doc(usuarioId).get();
    const data = doc.data();

    document.getElementById('usuario').value = usuarioId;
    document.getElementById('usuario').disabled = true;
    document.getElementById('nome').value = data.nome;
    document.getElementById('dataNascimento').value = data.dataNascimento || "";
    document.getElementById('cidade').value = data.cidade || "";
    document.getElementById('estado').value = data.estado || "";
    document.getElementById('pais').value = data.pais || "";
    document.getElementById('email').value = data.email || "";
    document.getElementById('celular').value = data.celular || "";
    document.getElementById('timeId').value = data.timeId || "";
    document.getElementById('creditos').value = data.creditos || 0;
    document.getElementById('status').value = data.status || "ativo";
}

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
}
