
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
  const datalist = document.getElementById("listaTimes");
  if (datalist) datalist.innerHTML = '';
  listaTimes = [];
  mapaTimes = {};

  db.collection("times").orderBy("nome").get().then(snapshot => {
    snapshot.forEach(doc => {
      const time = doc.data();
      time.id = doc.id;
      listaTimes.push(time);
      mapaTimes[time.nome] = time.id;

      if (datalist) {
        const option = document.createElement("option");
        option.value = time.nome;
        datalist.appendChild(option);
      }
    });
  });
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
  const nomeCasa = document.getElementById('timeCasa').value.trim();
  const nomeFora = document.getElementById('timeFora').value.trim();
  const timeCasa = mapaTimes[nomeCasa];
  const timeFora = mapaTimes[nomeFora];
  const dataInicio = new Date(document.getElementById('dataInicio').value);
  const dataFim = new Date(document.getElementById('dataFim').value);
  const status = document.getElementById('statusJogo').value;

  if (!timeCasa || !timeFora || !dataInicio || !dataFim) {
    alert("Preencha todos os campos corretamente.");
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
      data: new Date()
    });
  }
}

function carregarJogos() {
  const tabela = document.getElementById('tabelaJogos');
  if (tabela) tabela.innerHTML = '';

  db.collection("jogos").orderBy("dataInicio").get().then(snapshot => {
    snapshot.forEach(doc => {
      const jogo = doc.data();
      const id = doc.id;
      if (!tabela) return;
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${obterNomeTime(jogo.timeCasa)}</td>
        <td>${obterNomeTime(jogo.timeFora)}</td>
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

function obterNomeTime(idOuNome) {
  return Object.values(mapaTimes).includes(idOuNome)
    ? Object.keys(mapaTimes).find(nome => mapaTimes[nome] === idOuNome)
    : idOuNome;
}

function encerrarJogo(id) {
  db.collection("jogos").doc(id).update({
    status: "finalizado",
    dataFim: new Date()
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

    document.getElementById('timeCasa').value = obterNomeTime(jogo.timeCasa);
    document.getElementById('timeFora').value = obterNomeTime(jogo.timeFora);
    document.getElementById('dataInicio').value = formatarDataInput(jogo.dataInicio);
    document.getElementById('dataFim').value = formatarDataInput(jogo.dataFim);
    document.getElementById('statusJogo').value = jogo.status;

    document.getElementById('btnCadastrar').style.display = 'none';
    document.getElementById('btnAtualizar').style.display = 'inline-block';
  });
}

function atualizarJogo() {
  const nomeCasa = document.getElementById('timeCasa').value.trim();
  const nomeFora = document.getElementById('timeFora').value.trim();
  const timeCasa = mapaTimes[nomeCasa];
  const timeFora = mapaTimes[nomeFora];
  const dataInicio = new Date(document.getElementById('dataInicio').value);
  const dataFim = new Date(document.getElementById('dataFim').value);
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

function formatarDataInput(valor) {
  const date = valor instanceof Date ? valor : new Date(valor?.toDate?.() || valor);
  const iso = date.toISOString();
  return iso.substring(0, 16);
}
