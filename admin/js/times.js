
const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8",
  measurementId: "G-SYZ16X31KQ"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

function desenharBotaoCircular(cor1, cor2, cor3) {
  return `
    <div class="circle-button" style="
      background: linear-gradient(to bottom, ${cor1} 33%, ${cor2} 33% 66%, ${cor3} 66%);
    "></div>
  `;
}

function carregarTimes() {
  const tabela = document.getElementById("tabelaTimes");
  tabela.innerHTML = "";
  db.collection("times").get().then(snapshot => {
    snapshot.forEach(doc => {
      const time = doc.data();
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${time.nome}</td>
        <td>${time.pais}</td>
        <td>${desenharBotaoCircular(time.primaria, time.secundaria, time.terciaria)}</td>
        <td>
          <button onclick="editarTime('${doc.id}', '${time.nome}', '${time.pais}', '${time.primaria}', '${time.secundaria}', '${time.terciaria}')">Editar</button>
        </td>
      `;
      tabela.appendChild(row);
    });
  });
}

function editarTime(id, nome, pais, primaria, secundaria, terciaria) {
  document.getElementById("idEdicao").value = id;
  document.getElementById("nome").value = nome;
  document.getElementById("pais").value = pais;
  document.getElementById("corPrimaria").value = primaria;
  document.getElementById("corSecundaria").value = secundaria;
  document.getElementById("corTerciaria").value = terciaria;
  document.getElementById("btnCadastrar").textContent = "Salvar Alterações";
}

document.getElementById("btnCadastrar").addEventListener("click", () => {
  const idEdicao = document.getElementById("idEdicao").value;
  const nome = document.getElementById("nome").value;
  const pais = document.getElementById("pais").value;
  const primaria = document.getElementById("corPrimaria").value;
  const secundaria = document.getElementById("corSecundaria").value;
  const terciaria = document.getElementById("corTerciaria").value;

  if (!nome || !pais) {
    alert("Preencha os campos obrigatórios.");
    return;
  }

  const dados = { nome, pais, primaria, secundaria, terciaria };

  if (idEdicao) {
    db.collection("times").doc(idEdicao).update(dados).then(() => {
      document.getElementById("idEdicao").value = "";
      document.getElementById("btnCadastrar").textContent = "Cadastrar";
      carregarTimes();
    });
  } else {
    db.collection("times").add(dados).then(() => {
      carregarTimes();
    });
  }

  document.getElementById("nome").value = "";
  document.getElementById("pais").value = "Brasil";
  document.getElementById("corPrimaria").value = "#000000";
  document.getElementById("corSecundaria").value = "#ffffff";
  document.getElementById("corTerciaria").value = "#ff0000";
});

document.getElementById("filtro").addEventListener("input", () => {
  const termo = document.getElementById("filtro").value.toLowerCase();
  const linhas = document.querySelectorAll("#tabelaTimes tr");
  linhas.forEach(linha => {
    const texto = linha.textContent.toLowerCase();
    linha.style.display = texto.includes(termo) ? "" : "none";
  });
});

document.addEventListener("DOMContentLoaded", carregarTimes);
