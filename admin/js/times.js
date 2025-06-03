# Gerar o JS do painel de times com busca, exibição e compatibilidade total

times_restaurado = """
const lista = document.getElementById("listaTimes");

function desenharCamiseta(cor1, cor2, cor3) {
  return \`
    <svg width="32" height="32" viewBox="0 0 64 64">
      <path d="M8,8 Q16,0 24,8 L24,16 L40,16 L40,8 Q48,0 56,8 L52,28 L44,24 L32,44 L20,24 L12,28 Z"
            fill="\${cor1}" stroke="\${cor3}" stroke-width="2"/>
      <line x1="24" y1="8" x2="24" y2="16" stroke="\${cor2}" stroke-width="4"/>
      <line x1="40" y1="8" x2="40" y2="16" stroke="\${cor2}" stroke-width="4"/>
    </svg>
  \`;
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
    linha.innerHTML = \`
      <td>\${t.nome}</td>
      <td>\${t.pais}</td>
      <td>\${desenharCamiseta(cor1, cor2, cor3)}</td>
      <td><button onclick="editarTime('\${doc.id}')">Editar</button></td>
    \`;
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
"""

# Salvar arquivo restaurado
path_js = "/mnt/data/times-restaurado.js"
with open(path_js, "w", encoding="utf-8") as f:
    f.write(times_restaurado.strip())

path_js
