document.addEventListener("DOMContentLoaded", () => {
  const tabela = document.getElementById("tabelaTimes");
  const filtro = document.getElementById("filtro");
  const btnCadastrar = document.getElementById("btnCadastrar");

  function desenharCamiseta(cor1, cor2, cor3, estilo) {
    return `
      <svg width="40" height="40" viewBox="0 0 100 100">
        <path d="M30 20 L40 10 H60 L70 20 V90 H30 Z" fill="${cor1}" stroke="black" stroke-width="2"/>
        ${estilo === "Listrada" ? `
          <line x1="40" y1="20" x2="40" y2="90" stroke="${cor2}" stroke-width="6"/>
          <line x1="50" y1="20" x2="50" y2="90" stroke="${cor3}" stroke-width="6"/>
        ` : estilo === "Mangas" ? `
          <path d="M30 20 L20 30 V50 L30 40 Z" fill="${cor2}" />
          <path d="M70 20 L80 30 V50 L70 40 Z" fill="${cor3}" />
        ` : ``}
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
