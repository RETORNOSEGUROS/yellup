const db = firebase.firestore();
let listaCompleta = [];

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarPaises();
    carregarTimes();
  }
});

function carregarPaises() {
  const select = document.getElementById("pais");
  const paises = [
    "Alemanha", "Argentina", "Brasil", "Espanha", "França", "Inglaterra", "Itália", "Japão",
    "México", "Portugal", "Estados Unidos", "Holanda", "Uruguai", "Croácia", "Bélgica", "Polônia"
  ];
  paises.sort().forEach(p => {
    const option = document.createElement("option");
    option.value = p;
    option.textContent = p;
    select.appendChild(option);
  });
}

function atualizarPreview() {
  document.getElementById("preview1").style.background = document.getElementById("corPrimaria").value;
  document.getElementById("preview2").style.background = document.getElementById("corSecundaria").value;
  document.getElementById("preview3").style.background = document.getElementById("corTerciaria").value;
}

function cadastrarTime() {
  const nome = document.getElementById('nome').value;
  const pais = document.getElementById('pais').value;
  const corPrimaria = document.getElementById('corPrimaria').value;
  const corSecundaria = document.getElementById('corSecundaria').value;
  const corTerciaria = document.getElementById('corTerciaria').value;

  if (!nome || !pais) {
    alert("Preencha o nome e o país.");
    return;
  }

  db.collection("times").add({
    nome,
    pais,
    corPrimaria,
    corSecundaria,
    corTerciaria
  }).then(() => {
    alert("Time cadastrado com sucesso!");
    document.getElementById('nome').value = '';
    document.getElementById('pais').value = '';
    carregarTimes();
  });
}

function carregarTimes() {
  const lista = document.getElementById('listaTimes');
  lista.innerHTML = '';
  listaCompleta = [];

  db.collection("times").orderBy("nome").get().then(snapshot => {
    snapshot.forEach(doc => {
      const time = doc.data();
      listaCompleta.push({ id: doc.id, ...time });
    });
    filtrarTimes();
  });
}

function filtrarTimes() {
  const filtro = document.getElementById('filtro').value.toLowerCase();
  const lista = document.getElementById('listaTimes');
  lista.innerHTML = '';

  listaCompleta
    .filter(time =>
      time.nome.toLowerCase().includes(filtro) ||
      time.pais.toLowerCase().includes(filtro)
    )
    .forEach(time => {
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${time.nome}</td>
        <td>${time.pais}</td>
        <td style="background:${time.corPrimaria};">${time.corPrimaria}</td>
        <td style="background:${time.corSecundaria};">${time.corSecundaria}</td>
        <td style="background:${time.corTerciaria};">${time.corTerciaria}</td>
        <td><button onclick="editarTime('${time.id}')">Editar</button></td>
      `;
      lista.appendChild(linha);
    });
}

function editarTime(id) {
  alert(`Função de edição em desenvolvimento para o time ID: ${id}`);
}
