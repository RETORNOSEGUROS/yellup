
async function carregarPerfil() {
  const usuarioId = localStorage.getItem("usuarioId"); // ou outro método de login
  if (!usuarioId) return alert("Usuário não identificado.");

  const doc = await db.collection("usuarios").doc(usuarioId).get();
  if (!doc.exists) return alert("Usuário não encontrado.");

  const user = doc.data();
  document.getElementById("nome").value = user.nome || "";
  document.getElementById("cidade").value = user.cidade || "";
  document.getElementById("estado").value = user.estado || "";
  document.getElementById("pais").value = user.pais || "";
  document.getElementById("celular").value = user.celular || "";
  document.getElementById("timeId").value = user.timeId || "";
  document.getElementById("usuarioUnico").value = user.usuarioUnico || "";
  document.getElementById("avatarPreview").src = user.avatarUrl || "https://www.gravatar.com/avatar/?d=mp";
}

async function salvarEdicao() {
  const usuarioId = localStorage.getItem("usuarioId");
  if (!usuarioId) return alert("Usuário não identificado.");

  const file = document.getElementById("avatar").files[0];
  let avatarUrl = document.getElementById("avatarPreview").src;

  if (file) {
    const storageRef = firebase.app().storage("gs://painel-yellup.firebasestorage.app").ref();
    const avatarRef = storageRef.child(`avatars/${usuarioId}.jpg`);
    await avatarRef.put(file);
    avatarUrl = await avatarRef.getDownloadURL();
  }

  await db.collection("usuarios").doc(usuarioId).update({
    nome: document.getElementById("nome").value,
    cidade: document.getElementById("cidade").value,
    estado: document.getElementById("estado").value,
    pais: document.getElementById("pais").value,
    celular: document.getElementById("celular").value,
    timeId: document.getElementById("timeId").value,
    avatarUrl: avatarUrl
  });

  alert("Dados atualizados com sucesso!");
}

async function carregarSelects() {
  const paises = await db.collection("paises").orderBy("nome").get();
  const selectPais = document.getElementById("pais");
  paises.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.data().nome;
    opt.textContent = doc.data().nome;
    selectPais.appendChild(opt);
  });

  const times = await db.collection("times").orderBy("nome").get();
  const selectTime = document.getElementById("timeId");
  times.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().nome;
    selectTime.appendChild(opt);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  carregarSelects();
  carregarPerfil();
});
