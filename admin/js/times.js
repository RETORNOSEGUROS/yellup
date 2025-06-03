function desenharCamiseta(cor1, cor2, cor3) {
  return `
    <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <!-- Corpo principal -->
      <path d="M30,20 Q50,0 70,20 L80,35 L90,40 L85,90 H15 L10,40 L20,35 Z"
            fill="${cor1}" stroke="#000" stroke-width="2" />

      <!-- Mangas -->
      <path d="M20,35 L10,40 L15,90 L20,87 Z"
            fill="${cor2}" stroke="#000" stroke-width="1.5"/>
      <path d="M80,35 L90,40 L85,90 L80,87 Z"
            fill="${cor2}" stroke="#000" stroke-width="1.5"/>

      <!-- Gola em V -->
      <path d="M40,20 Q50,30 60,20"
            fill="${cor3}" stroke="#000" stroke-width="1"/>

      <!-- Faixa horizontal no peito -->
      <rect x="25" y="45" width="50" height="8" rx="2"
            fill="${cor3}" stroke="#000" stroke-width="0.5"/>
    </svg>
  `;
}


const lista = document.getElementById("listaTimes");

function desenharCamiseta(cor1, cor2, cor3) {
  return `
    <svg width="32" height="32" viewBox="0 0 64 64">
      <path d="M8,8 Q16,0 24,8 L24,16 L40,16 L40,8 Q48,0 56,8 L52,28 L44,24 L32,44 L20,24 L12,28 Z"
            fill="${cor1}" stroke="${cor3}" stroke-width="2"/>
      <line x1="24" y1="8" x2="24" y2="16" stroke="${cor2}" stroke-width="4"/>
      <line x1="40" y1="8" x2="40" y2="16" stroke="${cor2}" stroke-width="4"/>
    </svg>
  `;
}

function aplicarFiltro() {
  const termo = document.getElementById("buscaTime")?.value.toLowerCase() || "";
  const linhas = document.querySelectorAll("#listaTimes tr");
  linhas.forEach(linha => {
    const nome = linha.querySelector("td")?.innerText.toLowerCase() || "";
    const pais = linha.querySelectorAll("td")[1]?.innerText.toLowerCase() || "";
    linha.style.display = (nome.includes(termo) || pais.includes(termo)) ? "" : "none";
  });
}

async function carregarTimes() {
  lista.innerHTML = "";
  const snapshot = await db.collection("times").orderBy("nome").get();
  snapshot.forEach(doc => {
    const t = doc.data();
    const cor1 = t.corPrimaria || t.primaria || "#ccc";
    const cor2 = t.corSecundaria || t.secundaria || "#eee";
    const cor3 = t.corTerciaria || t.terciaria || "#000";

    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${t.nome}</td>
      <td>${t.pais}</td>
      <td>${desenharCamiseta(cor1, cor2, cor3)}</td>
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

document.addEventListener("DOMContentLoaded", () => {
  carregarTimes();
  const campoBusca = document.getElementById("buscaTime");
  if (campoBusca) {
    campoBusca.addEventListener("input", aplicarFiltro);
  }
});
