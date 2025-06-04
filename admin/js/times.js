document.addEventListener("DOMContentLoaded", () => {
  const tabela = document.getElementById("tabelaTimes");
  const filtro = document.getElementById("filtro");
  const btnCadastrar = document.getElementById("btnCadastrar");

  function desenharCamiseta(cor1, cor2, cor3, estilo) {
  return `
    <svg width="40" height="50" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path d="M16,8 L24,0 H40 L48,8 L56,10 L54,20 L48,18 L48,56 H16 L16,18 L10,20 L8,10 Z" fill="${cor1}" stroke="black" stroke-width="2"/>
      ${estilo === "listrada" ? `
        <rect x="22" y="8" width="4" height="48" fill="${cor2}" />
        <rect x="32" y="8" width="4" height="48" fill="${cor2}" />
        <rect x="42" y="8" width="4" height="48" fill="${cor2}" />
      ` : ""}
      ${estilo === "gola" ? `
        <circle cx="32" cy="12" r="5" fill="${cor3}" />
      ` : ""}
    </svg>
  `;
}



  function carregarTimes() {
    db.collection("times").get().then(snapshot => {
      tabela.innerHTML = "";
      snapshot.forEach(doc => {
        const time = doc.data();
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${time.nome}</td>
          <td>${time.pais}</td>
          <td>${desenharCamiseta(time.primaria, time.secundaria, time.terciaria, time.estilo)}</td>
          <td><button onclick="editarTime('${doc.id}')">Editar</button></td>
        `;
        tabela.appendChild(row);
      });
    });
  }

  btnCadastrar.addEventListener("click", () => {
    const nome = document.getElementById("nome").value;
    const pais = document.getElementById("pais").value;
    const primaria = document.getElementById("corPrimaria").value;
    const secundaria = document.getElementById("corSecundaria").value;
    const terciaria = document.getElementById("corTerciaria").value;
    const estilo = document.getElementById("estilo").value;

    if (!nome || !pais) {
      alert("Preencha os campos obrigatórios.");
      return;
    }

    db.collection("times").add({ nome, pais, primaria, secundaria, terciaria, estilo }).then(() => {
      carregarTimes();
    });
  });

  filtro.addEventListener("input", () => {
    const termo = filtro.value.toLowerCase();
    const linhas = tabela.querySelectorAll("tr");
    linhas.forEach(linha => {
      const texto = linha.textContent.toLowerCase();
      linha.style.display = texto.includes(termo) ? "" : "none";
    });
  });

  carregarTimes();
});
