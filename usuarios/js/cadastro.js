const urlParams = new URLSearchParams(window.location.search);
const indicadoPor = urlParams.get('indicador') || "-";

async function cadastrar() {
  const nome = document.getElementById('nome').value.trim();
  const email = document.getElementById('email').value.trim();
  const senha = document.getElementById('senha').value.trim();
  const usuario = document.getElementById('usuario').value.trim().toLowerCase();
  const celular = document.getElementById('celular').value.trim();
  const cidade = document.getElementById('cidade').value.trim();
  const estado = document.getElementById('estado').value.trim();
  const pais = document.getElementById('pais').value;
  const dataNascimento = document.getElementById('dataNascimento').value;
  const timeId = document.getElementById('timeId').value;
  const mensagem = document.getElementById('mensagem');

  if (!nome || !email || !senha || !usuario || !celular || !cidade || !estado || !pais || !dataNascimento || !timeId) {
    mensagem.innerText = "Preencha todos os campos.";
    return;
  }

  // Verifica se já existe esse nome de usuário
  const snapshot = await db.collection("usuarios").where("usuarioUnico", "==", usuario).get();
  if (!snapshot.empty) {
    mensagem.innerText = "Nome de usuário já existe. Escolha outro.";
    return;
  }

  try {
    const userCredential = await auth.createUserWithEmailAndPassword(email, senha);
    const uid = userCredential.user.uid;

    await db.collection("usuarios").doc(uid).set({
      nome,
      email,
      celular,
      cidade,
      estado,
      pais,
      dataNascimento,
      timeId,
      usuario,
      usuarioUnico: usuario,
      indicadoPor,
      status: "ativo",
      avatarUrl: "", // futuro
      creditos: 30,
      dataCadastro: new Date()
    });

    window.location.href = "painel.html";
  } catch (error) {
    console.error("Erro:", error);
    mensagem.innerText = "Erro ao cadastrar: " + error.message;
  }
}

// Carregar países da coleção Firestore
async function carregarPaises() {
  const select = document.getElementById("pais");
  const snapshot = await db.collection("paises").orderBy("nome").get();
  select.innerHTML = '<option value="">Selecione o país</option>';
  snapshot.forEach(doc => {
    const nome = doc.data().nome || doc.id;
    select.innerHTML += `<option value="${nome}">${nome}</option>`;
  });
}

// Carregar times da coleção Firestore
async function carregarTimes() {
  const select = document.getElementById("timeId");
  const snapshot = await db.collection("times").orderBy("nome").get();
  select.innerHTML = '<option value="">Selecione o time</option>';
  snapshot.forEach(doc => {
    const nome = doc.data().nome || doc.id;
    select.innerHTML += `<option value="${doc.id}">${nome}</option>`;
  });
}

// Inicia carregamento ao abrir a página
window.onload = () => {
  carregarPaises();
  carregarTimes();
};
