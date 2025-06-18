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

    const fileInput = document.getElementById("avatar");
    const file = fileInput.files[0];

    if (file) {
        const tiposPermitidos = ["image/jpeg", "image/png"];
        if (!tiposPermitidos.includes(file.type)) {
            return alert("Apenas arquivos JPG ou PNG são permitidos.");
        }
        if (file.size > 1024 * 1024) {
            return alert("Imagem muito grande (máximo 1 MB).");
        }

        try {
            const resizedBlob = await redimensionarImagem(file, 128, 128);

            const timestamp = Date.now();
            const storageRef = firebase.app().storage("gs://painel-yellup.firebasestorage.app").ref();
            const avatarRef = storageRef.child(`avatars/${usuarioUnico}_${timestamp}.jpg`);
            console.log("Fazendo upload de imagem...");

            await avatarRef.put(resizedBlob);
            avatarUrl = await avatarRef.getDownloadURL();
            console.log("URL da imagem salva:", avatarUrl);
        } catch (erro) {
            console.error("Erro ao fazer upload do avatar:", erro);
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
        usuarioUnico: usuarioUnico,
        timeId: document.getElementById("timeId").value || "",
        creditos: parseInt(document.getElementById("creditos").value),
        indicadoPor: document.getElementById("indicadoPor").value || "-",
        status: document.getElementById("status").value,
        avatarUrl: avatarUrl
    };

    if (!doc.exists) {
        dados.dataCadastro = firebase.firestore.Timestamp.now();
        await docRef.set(dados);
    } else {
        await docRef.update(dados);
    }

    alert("Usuário salvo com sucesso!");
    carregarUsuarios();
}

function redimensionarImagem(file, maxWidth, maxHeight) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = e => {
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);

        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            let [w, h] = [img.width, img.height];

            if (w > h) {
                if (w > maxWidth) {
                    h = Math.round(h * (maxWidth / w));
                    w = maxWidth;
                }
            } else {
                if (h > maxHeight) {
                    w = Math.round(w * (maxHeight / h));
                    h = maxHeight;
                }
            }

            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(resolve, "image/jpeg", 0.8);
        };

        img.onerror = reject;
    });
}

async function carregarUsuarios() {
    const filtro = document.getElementById("filtro").value.toLowerCase();
    const lista = document.getElementById("listaUsuarios");
    lista.innerHTML = "";

    const snapshot = await db.collection("usuarios").get();
    for (const doc of snapshot.docs) {
        const user = doc.data();
        if (
            filtro &&
            !user.nome.toLowerCase().includes(filtro) &&
            !user.usuarioUnico.toLowerCase().includes(filtro)
        ) continue;

        let timeNome = "-";
        if (user.timeId) {
            const timeDoc = await db.collection("times").doc(user.timeId).get();
            if (timeDoc.exists) timeNome = timeDoc.data().nome;
        }

        const avatar = user.avatarUrl || "https://www.gravatar.com/avatar/?d=mp";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><img src="${avatar}" class="avatar" /></td>
            <td>${user.nome}</td>
            <td>${user.usuario || "-"}</td>
            <td>${timeNome}</td>
            <td>${user.status}</td>
            <td>${user.creditos}</td>
            <td>${user.indicadoPor || "-"}</td>
            <td>
                <button onclick="editarUsuario('${doc.id}')">Editar</button>
                <button onclick="excluirUsuario('${doc.id}')">Excluir</button>
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
    document.getElementById("usuarioUnico").value = data.usuarioUnico || "";
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

window.onload = () => {
    carregarTimes();
    carregarUsuarios();
    carregarIndicadores();
};
