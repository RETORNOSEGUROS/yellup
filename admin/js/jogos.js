const db = firebase.firestore();
const storage = firebase.storage();
let mapaTimes = {};
let listaTimes = [];
let jogoEditandoId = null;

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
    listaTimes = [];

    snapshot.forEach(doc => {
      const time = doc.data();
      time.id = doc.id;
      mapaTimes[doc.id] = time.nome;
      listaTimes.push(time);
    });

    preencherSelects();
  });
}

function preencherSelects(filtro = "") {
  const selectCasa = document.getElementById("timeCasa");
  const selectFora = document.getElementById("timeFora");
  selectCasa.innerHTML = '<option value="">Selecione o Time da Casa</option>';
  selectFora.innerHTML = '<option value="">Selecione o Time Visitante</option>';

  const textoCasa = document.getElementById('buscaCasa')?.value?.toLowerCase() || "";
  const textoFora = document.getElementById('buscaFora')?.value?.toLowerCase() || "";

  listaTimes.forEach(time => {
    if (time.nome.toLowerCase().includes(textoCasa)) {
      const opt = new Option(time.nome, time.id);
      selectCasa.appendChild(opt);
    }
    if (time.nome.toLowerCase().includes(textoFora)) {
      const opt = new Option(time.nome, time.id);
      selectFora.appendChild(opt);
    }
  });
}

function filtrarTimes(tipo) {
  preencherSelects();
}

function adicionarPatrocinador() {
  const container = document.getElementById("patrocinadoresContainer");
  const div = document.createElement("div");
  div.innerHTML = `
    <input type="text" placeholder="Nome do patrocinador" class="nomePatrocinador">
    <input type="number" placeholder="Valor pago" class="valorPatrocinador">
    <input type="file" class="logoPatrocinador">
    <hr>
  `;
  container.appendChild(div);
}

async function cadastrarJogo() {
  const timeCasa = document.getElementById('timeCasa').value;
  const timeFora = document.getElementById('timeFora').value;
  const dataInicio = document.getElementById('dataInicio').value;
  const dataFim = document.getElementById('dataFim').value;
  const status = document.getElementById('statusJogo').value;

  if (!timeCasa || !timeFora || !dataInicio || !dataFim) {
    alert("Preencha todos os campos obrigatórios.");
    return;
  }

  const jogoRef = await db.collection("jogos").add({
    timeCasa, timeFora, dataInicio, dataFim, status
  });

  await salvarPatrocinadores(jogoRef.id);

  alert("Jogo cadastrado com sucesso!");
  limparFormulario();
  carregarJogos();
}

async function salvarPatrocinadores(jogoId) {
  const blocos = document.querySelectorAll("#patrocinadoresContainer div");

  for (const bloco of blocos) {
    const nome = bloco.querySelector(".nomePatrocinador").value;
    const valor = bloco.querySelector(".valorPatrocinador").value;
    const file = bloco.querySelector(".logoPatrocinador").files[0];

    if (!nome || !valor) continue;

    let logoURL = "";
    if (file) {
      const ref = storage.ref(`patrocinadores/${Date.now()}_${file.name}`);
      await ref.put(file);
      logoURL = await ref.getDownloadURL();
    }

    await db.collection("patrocinadores").add({
      jogoId,
      nome,
      valor: parseFloat(valor),
      logoURL,
      data: new Date().toISOString()
    });
  }
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
          <button onclick="editarJogo('${id}')">Editar</button>
          <button onclick="encerrarJogo('${id}')">Encerrar</button>
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
  db.collection("jogos").doc(id).get().then(doc => {
    if (!doc.exists) return;

    const jogo = doc.data();
    jogoEditandoId = id;

    document.getElementById('timeCasa').value = jogo.timeCasa;
    document.getElementById('timeFora').value = jogo.timeFora;
    document.getElementById('dataInicio').value = jogo.dataInicio;
    document.getElementById('dataFim').value = jogo.dataFim;
    document.getElementById('statusJogo').value = jogo.status;

    document.getElementById('btnCadastrar').style.display = 'none';
    document.getElementById('btnAtualizar').style.display = 'inline-block';
  });
}

function atualizarJogo() {
  const timeCasa = document.getElementById('timeCasa').value;
  const timeFora = document.getElementById('timeFora').value;
  const dataInicio = document.getElementById('dataInicio').value;
  const dataFim = document.getElementById('dataFim').value;
  const status = document.getElementById('statusJogo').value;

  db.collection("jogos").doc(jogoEditandoId).update({
    timeCasa, timeFora, dataInicio, dataFim, status
  }).then(() => {
    alert("Jogo atualizado!");
    limparFormulario();
    carregarJogos();
  });
}

function limparFormulario() {
  document.getElementById('timeCasa').value = '';
  document.getElementById('timeFora').value = '';
  document.getElementById('dataInicio').value = '';
  document.getElementById('dataFim').value = '';
  document.getElementById('statusJogo').value = 'agendado';
  document.getElementById('patrocinadoresContainer').innerHTML = '';
  document.getElementById('btnCadastrar').style.display = 'inline-block';
  document.getElementById('btnAtualizar').style.display = 'none';
  jogoEditandoId = null;
}
