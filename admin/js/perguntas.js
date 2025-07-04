firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/admin/login.html";
  } else {
    carregarTimes();
    carregarPerguntas();
  }
});

function carregarTimes() {
  const select = document.getElementById('selectTime');
  select.innerHTML = '<option value="">Selecione o time</option>';
  db.collection("times").orderBy("nome").get().then(snapshot => {
    snapshot.forEach(doc => {
      const dados = doc.data();
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = dados.pais ? `${dados.nome} - ${dados.pais}` : dados.nome;
      option.setAttribute("data-nome", dados.nome);
      select.appendChild(option);
      console.log("✅ Time carregado:", dados.nome, doc.id);
    });
  });
}

function atualizarCamposTime() {
  const select = document.getElementById('selectTime');
  const selectedOption = select.options[select.selectedIndex];

  const timeId = select.value;
  const timeNome = selectedOption.getAttribute("data-nome") || selectedOption.textContent.split(" - ")[0];

  document.getElementById('timeId').value = timeId;
  document.getElementById('timeNome').value = timeNome;
}

function salvarPergunta() {
  const id = document.getElementById('perguntaId').value;
  const pergunta = document.getElementById('pergunta').value;
  const alternativas = {
    A: document.getElementById('altA').value,
    B: document.getElementById('altB').value,
    C: document.getElementById('altC').value,
    D: document.getElementById('altD').value
  };
  const correta = document.getElementById('correta').value;
  const pontuacao = parseInt(document.getElementById('pontuacao').value);
  const timeId = document.getElementById('timeId').value;
  const timeNome = document.getElementById('timeNome').value;

  if (!pergunta || !alternativas.A || !alternativas.B || !alternativas.C || !alternativas.D || !correta || !pontuacao || !timeId || !timeNome) {
    alert("Preencha todos os campos.");
    return;
  }

  const dados = {
    pergunta, alternativas, correta, pontuacao, timeId, timeNome,
    atualizadoEm: firebase.firestore.Timestamp.now()
  };

  if (id) {
    db.collection("perguntas").doc(id).update(dados).then(() => {
      alert("Pergunta atualizada!");
      limparCampos();
      carregarPerguntas();
    });
  } else {
    dados.criadoEm = firebase.firestore.Timestamp.now();
    db.collection("perguntas").add(dados).then(() => {
      alert("Pergunta cadastrada!");
      limparCampos();
      carregarPerguntas();
    });
  }
}

function carregarPerguntasFiltradas() {
  const filtro = document.getElementById('filtroTimeNome').value.trim().toLowerCase();
  const lista = document.getElementById('listaPerguntas');
  lista.innerHTML = '';

  db.collection("perguntas").get().then(snapshot => {
    snapshot.forEach(doc => {
      const dados = doc.data();
      const nomeTime = dados.timeNome?.toLowerCase() || '';
      if (!filtro || nomeTime.includes(filtro)) {
        const linha = document.createElement('tr');
        linha.innerHTML = `
          <td>${dados.pergunta}</td>
          <td>${dados.correta || "-"} - ${dados.alternativas?.[dados.correta] || "-"}</td>
          <td>${dados.timeNome}</td>
          <td>${dados.pontuacao}</td>
          <td class="acoes">
            <button onclick='editarPergunta("${doc.id}", ${JSON.stringify(dados).replace(/"/g, '&quot;')})'>Editar</button>
            <button onclick="excluirPergunta('${doc.id}')">Excluir</button>
          </td>
        `;
        lista.appendChild(linha);
      }
    });
  });
}

function carregarPerguntas() {
  const lista = document.getElementById('listaPerguntas');
  lista.innerHTML = '';

  db.collection("perguntas").get().then(snapshot => {
    snapshot.forEach(doc => {
      const dados = doc.data();
      const linha = document.createElement('tr');
      linha.innerHTML = `
        <td>${dados.pergunta}</td>
        <td>${dados.correta} - ${dados.alternativas[dados.correta]}</td>
        <td>${dados.timeNome}</td>
        <td>${dados.pontuacao}</td>
        <td class="acoes">
          <button onclick='editarPergunta("${doc.id}", ${JSON.stringify(dados).replace(/"/g, '&quot;')})'>Editar</button>
          <button onclick="excluirPergunta('${doc.id}')">Excluir</button>
        </td>
      `;
      lista.appendChild(linha);
    });
  });
}

function editarPergunta(id, dados) {
  document.getElementById('perguntaId').value = id;
  document.getElementById('pergunta').value = dados.pergunta;
  document.getElementById('altA').value = dados.alternativas.A;
  document.getElementById('altB').value = dados.alternativas.B;
  document.getElementById('altC').value = dados.alternativas.C;
  document.getElementById('altD').value = dados.alternativas.D;
  document.getElementById('correta').value = dados.correta;
  document.getElementById('pontuacao').value = dados.pontuacao;
  document.getElementById('timeId').value = dados.timeId;
  document.getElementById('timeNome').value = dados.timeNome;

  setTimeout(() => {
    const select = document.getElementById('selectTime');
    const option = [...select.options].find(opt => opt.value === dados.timeId);
    if (option) {
      select.value = option.value;
      console.log("🎯 Select preenchido com:", option.textContent, option.value);
    } else {
      console.warn("⚠️ Time não encontrado no select:", dados.timeId);
    }
  }, 300);
}

function excluirPergunta(id) {
  if (confirm("Tem certeza que deseja excluir essa pergunta?")) {
    db.collection("perguntas").doc(id).delete().then(() => {
      alert("Pergunta excluída!");
      carregarPerguntas();
    });
  }
}

function limparCampos() {
  document.getElementById('perguntaId').value = '';
  document.getElementById('pergunta').value = '';
  document.getElementById('altA').value = '';
  document.getElementById('altB').value = '';
  document.getElementById('altC').value = '';
  document.getElementById('altD').value = '';
  document.getElementById('correta').value = '';
  document.getElementById('pontuacao').value = '';
  document.getElementById('timeId').value = '';
  document.getElementById('timeNome').value = '';
  document.getElementById('selectTime').value = '';
}
