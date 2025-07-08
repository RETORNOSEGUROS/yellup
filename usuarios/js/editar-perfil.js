let uid = null;

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  uid = user.uid;
  const doc = await db.collection("usuarios").doc(uid).get();

  if (!doc.exists) {
    alert("Usuário não encontrado.");
    return;
  }

  const dados = doc.data();

  document.getElementById("nome").value = dados.nome || "";
  document.getElementById("usuario").value = dados.usuario || "";
  document.getElementById("celular").value = dados.celular || "";
  document.getElementById("cidade").value = dados.cidade || "";
  document.getElementById("estado").value = dados.estado || "";
  document.getElementById("dataNascimento").value = dados.dataNascimento || "";
  await carregarPaises(dados.pais);
  await carregarTimes(dados.timeId);
});

async function salvarPerfil() {
  const nome = document.getElementById('nome').value.trim();
  const celular = document.getElementById('celular').value.trim();
  const cidade = document.getElementById('cidade').value.trim();
  const estado = document.getElementById('estado').value.trim();
  const pais = document.getElementById('pais').value;
  const dataNascimento = document.getElementById('dataNascimento').value;
  const timeId = document.getElementById('timeId').value;
  const mensagem = document.getElementById("mensagem");

  try {
    await db.collection("usuarios").doc(uid).update({
      nome, celular, cidade, estado, pais, dataNascimento, timeId
    });
    mensagem.innerText = "Perfil atualizado com sucesso!";
  } catch (error) {
    console.error(error);
    mensagem.innerText = "Erro ao salvar perfil.";
  }
}

async function carregarPaises(paisSelecionado = "") {
  const select = document.getElementById("pais");
  const snapshot = await db.collection("paises").orderBy("nome").get();
  select.innerHTML = '<option value="">Selecione o país</option>';
  snapshot.forEach(doc => {
    const nome = doc.data().nome || doc.id;
    const selected = nome === paisSelecionado ? 'selected' : '';
    select.innerHTML += `<option value="${nome}" ${selected}>${nome}</option>`;
  });
}

async function carregarTimes(timeSelecionado = "") {
  const select = document.getElementById("timeId");
  const snapshot = await db.collection("times").orderBy("nome").get();
  select.innerHTML = '<option value="">Selecione o time</option>';
  snapshot.forEach(doc => {
    const nome = doc.data().nome || doc.id;
    const selected = doc.id === timeSelecionado ? 'selected' : '';
    select.innerHTML += `<option value="${doc.id}" ${selected}>${nome}</option>`;
  });
}
