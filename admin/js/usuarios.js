async function carregarTimes() {
    const select = document.getElementById("timeId");
    select.innerHTML = `<option value="">Selecione o Time</option>`;
    const snapshot = await db.collection("times").orderBy("nome").get();
    snapshot.forEach(doc => {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.data().nome;
        select.appendChild(opt);
    });
}

async function carregarIndicadores() {
    const select = document.getElementById("indicadoPor");
    select.innerHTML = `<option value="">Selecione o Indicador</option>`;
    const snapshot = await db.collection("usuarios").where("status", "==", "ativo").get();
    snapshot.forEach(doc => {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.data().nome;
        select.appendChild(opt);
    });
}

async function salvarUsuario() {
    const usuarioUnico = document.getElementById("usuarioUnico").value.trim();
    if (!usuarioUnico) return alert("Informe o usuário!");
    const docRef = db.collection("usuarios").doc(usuarioUnico);
    const doc = await docRef.get();

    let avatarUrlAntigo = doc.exists ? doc.data().avatarUrl || "" : "";
    let avatarUrl = avatarUrlAntigo;

    const file = document.getElementById("avatar").files[0];
    if (file) {
        const storageRef = firebase.storage().ref();
        const avatarRef = storageRef.child(`avatars/${usuarioUnico}.jpg`);
        try {
            await avatarRef.put(file);
            avatarUrl = await avatarRef.getDownloadURL();
        } catch (erro) {
            console.error("Erro ao fazer upload do avatar:", erro);
            alert("Erro ao enviar imagem para o Firebase Storage.");
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
        usuario: usuarioUnico,
        timeId: document.getElementById("timeId").value || "",
        creditos: parseInt(document.getElementById("creditos").value),
        indicadoPor: document.getElementById("indicadoPor").value || "-",
        status: document.getElementById("status").value,
        avatarUrl: avatarUrl,
        dataCadastro: firebase.firestore.Timestamp.now(),
    };

    await docRef.set(dados);
    alert("Usuário salvo com sucesso!");
    carregarUsuarios();
}

async function carregarUsuarios() {
    const filtro = document.getElementById("filtro").value.toLowerCase();
    const lista = document.getElementById("listaUsuarios");
    lista.innerHTML = "";
    const snapshot = await db.collection("usuarios").get();

    for (const doc of snapshot.docs) {
        const user = doc.data();
        if (filtro && !user.nome.toLowerCase().includes(filtro)) continue;

        const timeNome = user.timeId
            ? (await db.collection("times").doc(user.timeId).get()).data().nome
            : "-";

        const avatar = user.avatarUrl || "https://www.gravatar.com/avatar/?d=mp";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><img src="${avatar}" width="40" height="40" style="border-radius:50%"></td>
            <td>${user.nome}</td>
            <td>${user.usuario}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td>${user.indicadoPor}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="editarUsuario('${doc.id}')">Editar</button>
                <button class="btn btn-danger btn-sm" onclick="excluirUsuario('${doc.id}')">Excluir</button>
            </td>
        `;
        lista.appendChild(tr);
    }
}

async function editarUsuario(id) {
    const doc = await db.collection("usuarios").doc(id).get();
    const data = doc.data();
    document.getElementById("nome").value = data.nome || "";
    document.getElementById("dataNascimento").value = data.dataNascimento || "";
    document.getElementById("cidade").value = data.cidade || "";
    document.getElementById("estado").value = data.estado || "";
    document.getElementById("pais").value = data.pais || "";
    document.getElementById("email").value = data.email || "";
    document.getElementById("celular").value = data.celular || "";
    document.getElementById("usuarioUnico").value = data.usuario || "";
    document.getElementById("timeId").value = data.timeId || "";
    document.getElementById("creditos").value = data.creditos || 0;
    document.getElementById("indicadoPor").value = data.indicadoPor || "";
    document.getElementById("status").value = data.status || "ativo";
}

async function excluirUsuario(id) {
    if (!confirm("Tem certeza que deseja excluir este usuário?")) return;
    await db.collection("usuarios").doc(id).delete();
    alert("Usuário excluído com sucesso!");
    carregarUsuarios();
}

function exportarCSV() {
    db.collection("usuarios").get().then(snapshot => {
        let csv = "Nome,Usuário,Time,Status,Créditos,Email,Celular,Cidade,Estado,País,Indicado Por\n";

        const promessas = snapshot.docs.map(async doc => {
            const user = doc.data();
            let timeNome = "-";
            if (user.timeId) {
                const timeDoc = await db.collection("times").doc(user.timeId).get();
                if (timeDoc.exists) timeNome = timeDoc.data().nome;
            }

            const linha = [
                \`\${user.nome || ""}\`,
                \`\${user.usuario || ""}\`,
                \`\${timeNome}\`,
                \`\${user.status || ""}\`,
                \`\${user.creditos || 0}\`,
                \`\${user.email || ""}\`,
                \`\${user.celular || ""}\`,
                \`\${user.cidade || ""}\`,
                \`\${user.estado || ""}\`,
                \`\${user.pais || ""}\`,
                \`\${user.indicadoPor || ""}\`
            ].join(",");

            return linha;
        });

        Promise.all(promessas).then(linhas => {
            csv += linhas.join("\n");
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "usuarios.csv";
            a.click();
            URL.revokeObjectURL(url);
        });
    });
}

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
    carregarIndicadores();
};
