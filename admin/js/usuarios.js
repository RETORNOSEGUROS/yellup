// Função para carregar times no select
async function carregarTimes() {
    const timesRef = await db.collection("times").orderBy("nome").get();
    const select = document.getElementById("timeId");
    select.innerHTML = `<option value="">Selecione o Time</option>`;

    timesRef.forEach(doc => {
        let opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.data().nome;
        select.appendChild(opt);
    });
}

// Função para salvar o usuário
async function salvarUsuario() {
    const usuarioUnico = document.getElementById("usuarioUnico").value.trim().toLowerCase();
    if (!usuarioUnico) return alert("Preencha o usuário!");

    const usuarioRef = db.collection("usuarios").doc(usuarioUnico);
    const docSnap = await usuarioRef.get();

    const dados = {
        nome: document.getElementById("nome").value,
        dataNascimento: document.getElementById("dataNascimento").value,
        cidade: document.getElementById("cidade").value,
        estado: document.getElementById("estado").value,
        pais: document.getElementById("pais").value,
        email: document.getElementById("email").value,
        celular: document.getElementById("celular").value,
        creditos: parseInt(document.getElementById("creditos").value),
        status: document.getElementById("status").value,
        timeId: document.getElementById("timeId").value
    };

    if (!docSnap.exists) {
        await usuarioRef.set(dados);
    } else {
        await usuarioRef.update(dados);
    }
    alert("Usuário salvo com sucesso.");
    carregarUsuarios();
}

// Função para listar os usuários
async function carregarUsuarios() {
    const filtro = document.getElementById("filtro").value.toLowerCase();
    const tbody = document.getElementById("listaUsuarios");
    tbody.innerHTML = "";

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
            <td>${doc.id}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        `;
        tbody.appendChild(tr);
    }
}

// Função de edição (puxa os dados para o formulário)
async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    const data = doc.data();

    document.getElementById("usuarioUnico").value = id;
    document.getElementById("nome").value = data.nome;
    document.getElementById("dataNascimento").value = data.dataNascimento;
    document.getElementById("cidade").value = data.cidade;
    document.getElementById("estado").value = data.estado;
    document.getElementById("pais").value = data.pais;
    document.getElementById("email").value = data.email;
    document.getElementById("celular").value = data.celular;
    document.getElementById("creditos").value = data.creditos;
    document.getElementById("status").value = data.status;
    document.getElementById("timeId").value = data.timeId;
}

// Carregar tudo ao abrir a página
window.onload = () => {
    carregarTimes();
    carregarUsuarios();
};
