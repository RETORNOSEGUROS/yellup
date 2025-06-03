
const lista = document.getElementById("listaTimes");

async function carregarTimes() {
  lista.innerHTML = "";
  const snapshot = await db.collection("times").orderBy("nome").get();
  snapshot.forEach(doc => {
    const t = doc.data();
    const cor1 = t.corPrimaria || t.primaria || '#ccc';
    const cor2 = t.corSecundaria || t.secundaria || '#eee';
    const cor3 = t.corTerciaria || t.terciaria || '#000';

    const linha = document.createElement("tr");
    const camisa = `
      <div class="camiseta" style="
        background: linear-gradient(to right, ${cor1} 50%, ${cor2} 50%);
        border: 2px solid ${cor3};
      "></div>
    `;
    linha.innerHTML = `
      <td>${t.nome}</td>
      <td>${t.pais}</td>
      <td>${camisa}</td>
      <td><button onclick="editarTime('${doc.id}')">Editar</button></td>
    `;
    lista.appendChild(linha);
  });
}

async function cadastrarTime() {
  const nome = document.getElementById("nomeTime").value.trim();
  const pais = document.getElementById("paisTime").value;
  const corPrimaria = document.getElementById("corPrimaria").value;
  const corSecundaria = document.getElementById("corSecundaria").value;
  const corTerciaria = document.getElementById("corTerciaria").value;

  if (!nome || !pais) {
    alert("Preencha todos os campos.");
    return;
  }

  await db.collection("times").add({
    nome, pais, corPrimaria, corSecundaria, corTerciaria
  });

  document.getElementById("nomeTime").value = "";
  carregarTimes();
}

async function editarTime(id) {
  const doc = await db.collection("times").doc(id).get();
  const t = doc.data();

  document.getElementById("nomeTime").value = t.nome;
  document.getElementById("paisTime").value = t.pais;
  document.getElementById("corPrimaria").value = t.corPrimaria || t.primaria || "#cccccc";
  document.getElementById("corSecundaria").value = t.corSecundaria || t.secundaria || "#eeeeee";
  document.getElementById("corTerciaria").value = t.corTerciaria || t.terciaria || "#000000";

  document.querySelector("button[onclick='cadastrarTime()']").style.display = "none";

  const botaoSalvar = document.createElement("button");
  botaoSalvar.innerText = "Salvar Alterações";
  botaoSalvar.onclick = async () => {
    await db.collection("times").doc(id).update({
      nome: document.getElementById("nomeTime").value.trim(),
      pais: document.getElementById("paisTime").value,
      corPrimaria: document.getElementById("corPrimaria").value,
      corSecundaria: document.getElementById("corSecundaria").value,
      corTerciaria: document.getElementById("corTerciaria").value
    });
    location.reload();
  };
  document.body.appendChild(botaoSalvar);
}

document.addEventListener("DOMContentLoaded", carregarTimes);
