function desenharCamiseta(cor1, cor2, cor3, estilo = "lisa") {
  let extra = "";

  if (estilo === "listrada") {
    extra = `
      <rect x="30" y="20" width="4" height="40" fill="${cor3}" />
      <rect x="36" y="20" width="4" height="40" fill="${cor3}" />
      <rect x="42" y="20" width="4" height="40" fill="${cor3}" />
    `;
  } else if (estilo === "faixa") {
    extra = `<rect x="22" y="35" width="36" height="8" fill="${cor3}" />`;
  } else if (estilo === "diagonal") {
    extra = `<polygon points="20,70 28,70 60,30 52,30" fill="${cor3}" />`;
  }

  return `
    <svg width="36" height="36" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M25 20 Q50 0 75 20 L85 35 L90 90 H10 L15 35 Z"
            fill="${cor1}" stroke="#000" stroke-width="2" />
      <path d="M15 35 L5 40 L10 90 L15 88 Z"
            fill="${cor2}" stroke="#000" stroke-width="1.5"/>
      <path d="M85 35 L95 40 L90 90 L85 88 Z"
            fill="${cor2}" stroke="#000" stroke-width="1.5"/>
      <path d="M40 20 Q50 30 60 20"
            fill="${cor3}" stroke="#000" stroke-width="1"/>
      ${extra}
    </svg>
  `;
}

async function carregarTimes() {
  const lista = document.getElementById("listaTimes");
  lista.innerHTML = "";
  const snapshot = await db.collection("times").orderBy("nome").get();
  snapshot.forEach(doc => {
    const t = doc.data();
    const cor1 = t.corPrimaria || t.primaria || "#ccc";
    const cor2 = t.corSecundaria || t.secundaria || "#eee";
    const cor3 = t.corTerciaria || t.terciaria || "#000";
    const estilo = t.estilo || "lisa";

    const linha = document.createElement("tr");
    linha.innerHTML = `
      <td>${t.nome}</td>
      <td>${t.pais}</td>
      <td>${desenharCamiseta(cor1, cor2, cor3, estilo)}</td>
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
  const estilo = document.getElementById("estilo").value;

  if (!nome || !pais) {
    alert("Preencha todos os campos.");
    return;
  }

  await db.collection("times").add({
    nome, pais, corPrimaria, corSecundaria, corTerciaria, estilo
  });

  document.getElementById("nomeTime").value = "";
  carregarTimes();
}

async function editarTime(id) {
  const doc = await db.collection("times").doc(id).get();
  const t = doc.data();

  document.getElementById("nomeTime").value = t.nome;
  document.getElementById("paisTime").value = t.pais;
  document.getElementById("corPrimaria").value = t.corPrimaria || "#cccccc";
  document.getElementById("corSecundaria").value = t.corSecundaria || "#eeeeee";
  document.getElementById("corTerciaria").value = t.corTerciaria || "#000000";
  document.getElementById("estilo").value = t.estilo || "lisa";

  document.querySelector("button[onclick='cadastrarTime()']").style.display = "none";

  const botaoSalvar = document.createElement("button");
  botaoSalvar.innerText = "Salvar Alterações";
  botaoSalvar.onclick = async () => {
    await db.collection("times").doc(id).update({
      nome: document.getElementById("nomeTime").value.trim(),
      pais: document.getElementById("paisTime").value,
      corPrimaria: document.getElementById("corPrimaria").value,
      corSecundaria: document.getElementById("corSecundaria").value,
      corTerciaria: document.getElementById("corTerciaria").value,
      estilo: document.getElementById("estilo").value
    });
    location.reload();
  };
  document.body.appendChild(botaoSalvar);
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

document.addEventListener("DOMContentLoaded", () => {
  carregarTimes();
  const campoBusca = document.getElementById("buscaTime");
  if (campoBusca) {
    campoBusca.addEventListener("input", aplicarFiltro);
  }
});
