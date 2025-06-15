const db = firebase.firestore();

async function carregarTimes() {
    const timesRef = await db.collection("times").get();
    const select = document.getElementById("timeId");
    select.innerHTML = `<option value="">Selecione</option>`;
    timesRef.forEach(doc => {
        let time = doc.data();
        let opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = time.nome;
        select.appendChild(opt);
    });
}

async function salvarUsuario() {
    const usuarioUnico = document.getElementById("usuarioUnico").value.trim();
    if (!usuarioUnico) return alert("Preencha o usuário!");

    const usuarioRef = db.collection("usuarios").doc(usuarioUnico);
    const docSnap = await usuarioRef.get();

    if (!docSnap.exists) {
        await usuarioRef.set(gerarDados());
    } else {
        await usuarioRef.update(gerarDados());
    }
    alert("Usuário salvo com sucesso.");
    carregarUsuarios();
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
        creditos: parseInt(document.getElementById("creditos").value),
        status: document.getElementById("status").value,
        timeId: document.getElementById("timeId").value
    };
}

async function carregarUsuarios() {
    const filtro = document.getElementById("filtro").value.trim().toLowerCase();
    const lista = document.getElementById("listaUsuarios");
    lista.innerHTML = "";
    
    const snap = await db.collection("usuarios").get();
    snap.forEach(doc => {
        const user = doc.data();
        if (filtro && !user.nome?.toLowerCase().includes(filtro)) return;
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${user.nome || ''}</td>
            <td>${doc.id}</td>
            <td>${user.timeId || ''}</td>
            <td>${user.status || ''}</td>
            <td>${user.creditos || 0}</td>
            <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
        `;
        lista.appendChild(tr);
    });
}

async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    const data = doc.data();

    document.getElementById("usuarioUnico").value = id;
    document.getElementById("nome").value = data.nome;
    document.getElementById("dataNascimento").value = data.dataNascimento || "";
    document.getElementById("cidade").value = data.cidade || "";
    document.getElementById("estado").value = data.estado || "";
    document.getElementById("pais").value = data.pais || "";
    document.getElementById("email").value = data.email || "";
    document.getElementById("celular").value = data.celular || "";
    document.getElementById("creditos").value = data.creditos || 0;
    document.getElementById("status").value = data.status || "ativo";
    document.getElementById("timeId").value = data.timeId || "";
}

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
}
