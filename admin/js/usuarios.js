// admin/js/usuarios.js

const dbRef = db.collection("usuarios");
const timesRef = db.collection("times");

async function carregarTimes() {
    const select = document.getElementById("timeId");
    select.innerHTML = `<option value="">Selecione o Time</option>`;
    const times = await timesRef.orderBy("nome").get();
    times.forEach(doc => {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.data().nome;
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
        usuarioUnico: document.getElementById("usuarioUnico").value.toLowerCase(),
        timeId: document.getElementById("timeId").value,
        creditos: parseInt(document.getElementById("creditos").value) || 0,
        status: document.getElementById("status").value,
        dataCadastro: new Date()
    };
}

async function salvarUsuario() {
    const dados = gerarDados();
    if (!dados.usuarioUnico) return alert("Preencha o usuário único!");

    const userRef = dbRef.doc(dados.usuarioUnico);
    const docSnap = await userRef.get();

    if (!docSnap.exists) {
        await userRef.set(dados);
    } else {
        await userRef.update(dados);
    }

    alert("Usuário salvo com sucesso!");
    carregarUsuarios();
}

async function carregarUsuarios() {
    const lista = document.getElementById("listaUsuarios");
    const filtro = document.getElementById("filtro").value.toLowerCase();
    lista.innerHTML = "";

    const snap = await dbRef.get();
    for (const doc of snap.docs) {
        const user = doc.data();
        if (filtro && !user.nome.toLowerCase().includes(filtro)) continue;

        let timeNome = "-";
        if (user.timeId) {
            const timeDoc = await timesRef.doc(user.timeId).get();
            if (timeDoc.exists) timeNome = timeDoc.data().nome;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${user.nome}</td>
            <td>${user.usuarioUnico}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos || 0}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        `;
        lista.appendChild(tr);
    }
}

async function editarUsuario(id) {
    const doc = await dbRef.doc(id).get();
    const data = doc.data();

    document.getElementById("nome").value = data.nome;
    document.getElementById("dataNascimento").value = data.dataNascimento;
    document.getElementById("cidade").value = data.cidade;
    document.getElementById("estado").value = data.estado;
    document.getElementById("pais").value = data.pais;
    document.getElementById("email").value = data.email;
    document.getElementById("celular").value = data.celular;
    document.getElementById("usuarioUnico").value = id;
    document.getElementById("timeId").value = data.timeId || "";
    document.getElementById("creditos").value = data.creditos || 0;
    document.getElementById("status").value = data.status || "ativo";
}

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
}
