const db = firebase.firestore();
const storage = firebase.storage();
let mapaTimes = {};

firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarTimes();
    carregarJogos();
  }
});

function carregarTimes() {
  const selectCasa = document.getElementById("timeCasa");
  const selectFora = document.getElementById("timeFora");

  db.collection("times").get().then(snapshot => {
    const grupos = {};

    snapshot.forEach(doc => {
      const t = doc.data();
      const id = doc.id;
      mapaTimes[id] = t.nome;

      const pais = t.pais?.normalize("NFD").replace(/[\u0300-\u036f]/g, "") || "Outro";
      if (!grupos[pais]) grupos[pais] = [];
      grupos[pais].push({ id, nome: t.nome });
    });

    selectCasa.innerHTML = '<option value="">Selecione o Time da Casa</option>';
    selectFora.innerHTML = '<option value="">Selecione o Time Visitante</option>';

    Object.keys(grupos).sort().forEach(pais => {
      const optgroupCasa = document.createElement("optgroup");
      const optgroupFora = document.createElement("optgroup");
      optgroupCasa.label = pais;
      optgroupFora.label = pais;

      grupos[pais].forEach(t => {
        const o1 = new Option(t.nome, t.id);
        const o2 = new Option(t.nome, t.id);
        optgroupCasa.appendChild(o1);
        optgroupFora.appendChild(o2);
      });

      selectCasa.appendChild(optgroupCasa);
      selectFora.appendChild(optgroupFora);
    });
  });
}

async function cadastrarJogo() {
  const timeCasa = document.getElementById('timeCasa').value;
  const timeFora = document.getElementById('timeFora').value;
  const dataInicio = document.getElementById('dataInicio').value;
  const dataFim = document.getElementById('dataFim').value;
  const status = document.getElementById('statusJogo').value;

  const nomePatrocinador = document.getElementById('nomePatrocinador').value;
  const valorPatrocinador = document.getElementById('valorPatrocinador').value;
  const logoFile = document.getElementById('logoPatrocinador').files[0];

  if (!timeCasa || !timeFora || !dataInicio || !dataFim) {
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  let logoURL = "";
  if (logoFile) {
    const storageRef = storage.ref(`patrocinadores/${Date.now()}_${logoFile.name}`);
    await storageRef.put(logoFile);
    logoURL = await storageRef.getDownloadURL();
  }

  const jogoRef = await db.collection("jogos").add({
    timeCasa,
    timeFora,
    dataInicio,
    dataFim,
    status
  });

  if (nomePatrocinador && valorPatrocinador) {
    await db.collection("patrocinadores").add({
      jogoId: jogoRef.id,
      nome: nomePatrocinador,
      valor: parseFloat(valorPatrocinador),
      logoURL,
      data: new Date().toISOString()
    });
  }

  alert("Jogo cadastrado!");
  document.getElementById('timeCasa').value = '';
  document.getElementById('timeFora').value = '';
  document.getElementById('dataInicio').value = '';
  document.getElementById('dataFim').value = '';
  document.getElementById('statusJogo').value = 'agendado';
  document.getElementById('nomePatrocinador').value = '';
  document.getElementById('valorPatrocinador').value = '';
  document.getElementById('logoPatrocinador').value = '';

  carregarJogos();
}

function carregarJogos() {
  const tabela = document.getElementById('tabelaJogos');
  tabela.innerHTML = '';

  db.collection("jogos").orderBy("dataInicio").get().then(snapshot => {
    snapshot.forEach(doc => {
      const jogo = doc.data();
      const id = doc.id;
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${mapaTimes[jogo.timeCasa] ?? jogo.timeCasa}</td>
        <td>${mapaTimes[jogo.timeFora] ?? jogo.timeFora}</td>
        <td>${new Date(jogo.dataInicio).toLocaleString()}</td>
        <td>${new Date(jogo.dataFim).toLocaleString()}</td>
        <td>${jogo.status}</td>
        <td>
          <button onclick="encerrarJogo('${id}')">Encerrar</button>
          <button onclick="editarJogo('${id}')">Editar</button>
        </td>
      `;
      tabela.appendChild(linha);
    });
  });
}

function encerrarJogo(id) {
  db.collection("jogos").doc(id).update({
    status: "finalizado",
    dataFim: new Date().toISOString()
  }).then(() => {
    alert("Jogo encerrado.");
    carregarJogos();
  });
}

function editarJogo(id) {
  alert("Função de edição será implementada em breve. ID: " + id);
}
