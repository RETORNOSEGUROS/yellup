document.addEventListener("DOMContentLoaded", () => {
  const tabela = document.getElementById("tabelaTimes");
  const filtro = document.getElementById("filtro");
  const btnCadastrar = document.getElementById("btnCadastrar");

  function desenharCamiseta(cor1, cor2, cor3, estilo) {
  if (estilo === "listrada") {
    return `
      <svg width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="40" height="50" rx="6" ry="6" fill="${cor1}" />
        <rect x="10" y="0" width="5" height="50" fill="${cor2}" />
        <rect x="25" y="0" width="5" height="50" fill="${cor2}" />
        <path d="M10 0 Q20 10 30 0" fill="${cor3}" />
      </svg>
    `;
  } else if (estilo === "gola") {
    return `
      <svg width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="40" height="50" rx="6" ry="6" fill="${cor1}" />
        <circle cx="20" cy="10" r="6" fill="${cor3}" />
      </svg>
    `;
  } else {
    return `
      <svg width="40" height="50" viewBox="0 0 40 50" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="40" height="50" rx="6" ry="6" fill="${cor1}" />
      </svg>
    `;
  }
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
