firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarPerguntas();
  }
});

function cadastrarPergunta() {
  const pergunta = document.getElementById('pergunta').value;
  const alternativas = {
    A: document.getElementById('altA').value,
    B: document.getElementById('altB').value,
    C: document.getElementById('altC').value,
    D: document.getElementById('altD').value,
  };
  const correta = document.getElementById('correta').value;
  const timeId = document.getElementById('timeId').value;

  if (!pergunta || !alternativas.A || !alternativas.B || !alternativas.C || !alternativas.D || !correta || !timeId) {
    alert("Preencha todos os campos.");
    return;
  }

  db.collection("perguntas").add({
    pergunta,
    alternativas,
    correta,
    timeId
  }).then(() => {
    alert("Pergunta cadastrada!");
    document.getElementById('pergunta').value = '';
    document.getElementById('altA').value = '';
    document.getElementById('altB').value = '';
    document.getElementById('altC').value = '';
    document.getElementById('altD').value = '';
    document.getElementById('correta').value = '';
    document.getElementById('timeId').value = '';
    carregarPerguntas();
  });
}

function carregarPerguntas() {
  const lista = document.getElementById('listaPerguntas');
  lista.innerHTML = '';

  db.collection("perguntas").orderBy("timeId").get().then(snapshot => {
    snapshot.forEach(doc => {
      const dados = doc.data();
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${dados.pergunta}</td>
        <td>${dados.correta}</td>
        <td>${dados.timeId}</td>
      `;
      lista.appendChild(linha);
    });
  });
}
