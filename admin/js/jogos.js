const db = firebase.firestore();
let mapaTimes = {}; // id → nome

firebase.auth().onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarTimes();
    carregarJogos();
  }
});

function carregarTimes() {
  db.collection("times").orderBy("pais").get().then(snapshot => {
    const timeCasaSelect = document.getElementById("timeCasa");
    const timeForaSelect = document.getElementById("timeFora");

    const grupos = {};

    snapshot.forEach(doc => {
      const time = doc.data();
      const id = doc.id;
      mapaTimes[id] = time.nome;

      if (!grupos[time.pais]) grupos[time.pais] = [];
      grupos[time.pais].push({ id, nome: time.nome });
    });

    // Limpar e reconstruir os selects
    timeCasaSelect.innerHTML = '<option value="">Selecione o Time da Casa</option>';
    timeForaSelect.innerHTML = '<option value="">Selecione o Time Visitante</option>';

    Object.keys(grupos).forEach(pais => {
      const grupoCasa = document.createElement("optgroup");
      grupoCasa.label = pais;

      const grupoFora = document.createElement("optgroup");
      grupoFora.label = pais;

      grupos[pais].forEach(time => {
        const optionCasa = document.createElement("option");
        optionCasa.value = time.id;
        optionCasa.textContent = time.nome;

        const optionFora = document.createElement("option");
        optionFora.value = time.id;
        optionFora.textContent = time.nome;

        grupoCasa.appendChild(optionCasa);
        grupoFora.appendChild(optionFora);
      });

      timeCasaSelect.appendChild(grupoCasa);
      timeForaSelect.appendChild(grupoFora);
    });
  });
}

function cadastrarJogo() {
  const timeCasa = document.getElementById('timeCasa').value;
  const timeFora = document.getElementById('timeFora').value;
  const dataInicio = document.getElementById('dataInicio').value;
  const dataFim = document.getElementById('dataFim').value;
  const status = document.getElementById('statusJogo').value;

  if (!timeCasa || !timeFora || !dataInicio || !dataFim) {
    alert("Preencha todos os campos.");
    return;
  }

  db.collection("jogos").add({
    timeCasa,
    timeFora,
    dataInicio,
    dataFim,
    status
  }).then(() => {
    alert("Jogo cadastrado!");
    document.getElementById('timeCasa').value = '';
    document.getElementById('timeFora').value = '';
    document.getElementById('dataInicio').value = '';
    document.getElementById('dataFim').value = '';
    document.getElementById('statusJogo').value = 'agendado';
    carregarJogos();
  });
}

function carregarJogos() {
  const tabela = document.getElementById('tabelaJogos');
  tabela.innerHTML = '';

  db.collection("jogos").orderBy("dataInicio").get().then(snapshot => {
    snapshot.forEach(doc => {
      const jogo = doc.data();
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${mapaTimes[jogo.timeCasa] ?? jogo.timeCasa}</td>
        <td>${mapaTimes[jogo.timeFora] ?? jogo.timeFora}</td>
        <td>${new Date(jogo.dataInicio).toLocaleString()}</td>
        <td>${new Date(jogo.dataFim).toLocaleString()}</td>
        <td>${jogo.status}</td>
      `;
      tabela.appendChild(linha);
    });
  });
}
