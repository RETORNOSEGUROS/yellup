const db = firebase.firestore();

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarTimes();
  }
});

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

  db.collection("times").orderBy("nome").get().then(snapshot => {
    snapshot.forEach(doc => {
      const time = doc.data();
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${time.nome}</td>
        <td>${time.pais}</td>
        <td style="background:${time.corPrimaria};">${time.corPrimaria}</td>
        <td style="background:${time.corSecundaria};">${time.corSecundaria}</td>
        <td style="background:${time.corTerciaria};">${time.corTerciaria}</td>
      `;
      lista.appendChild(linha);
    });
  });
}
