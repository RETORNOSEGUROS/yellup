document.addEventListener('DOMContentLoaded', () => {
  const nomeInput = document.getElementById('nome');
  const paisInput = document.getElementById('pais');
  const corPrimaria = document.getElementById('corPrimaria');
  const corSecundaria = document.getElementById('corSecundaria');
  const corTerciaria = document.getElementById('corTerciaria');
  const estiloSelect = document.getElementById('estilo');
  const btnCadastrar = document.getElementById('btnCadastrar');
  const listaTimes = document.getElementById('listaTimes');
  const filtro = document.getElementById('filtroBusca');

  function renderizarCamiseta(time) {
    const estilo = (time.estilo || 'classico').toLowerCase();
    const cor1 = time.primaria || '#000000';
    const cor2 = time.secundaria || '#ffffff';
    const cor3 = time.terciaria || '#ff0000';

    if (estilo === 'listrada') {
      return `
        <svg width="40" height="40" viewBox="0 0 64 64">
          <rect width="64" height="64" fill="${cor1}"/>
          <rect x="16" width="8" height="64" fill="${cor2}"/>
          <rect x="32" width="8" height="64" fill="${cor2}"/>
          <rect x="48" width="8" height="64" fill="${cor2}"/>
        </svg>
      `;
    } else {
      return `
        <svg width="40" height="40" viewBox="0 0 64 64">
          <rect width="64" height="64" fill="${cor1}" stroke="${cor3}" stroke-width="4"/>
        </svg>
      `;
    }
  }

  function carregarTimes() {
    db.collection('times').get().then(snapshot => {
      listaTimes.innerHTML = '';
      snapshot.forEach(doc => {
        const time = doc.data();
        const div = document.createElement('tr');
        div.innerHTML = `
          <td>${time.nome}</td>
          <td>${time.pais}</td>
          <td>${renderizarCamiseta(time)}</td>
          <td><button onclick="editarTime('${doc.id}')">Editar</button></td>
        `;
        listaTimes.appendChild(div);
      });
    });
  }

  btnCadastrar.addEventListener('click', () => {
    const novoTime = {
      nome: nomeInput.value,
      pais: paisInput.value,
      primaria: corPrimaria.value,
      secundaria: corSecundaria.value,
      terciaria: corTerciaria.value,
      estilo: estiloSelect.value
    };
    db.collection('times').add(novoTime).then(() => {
      carregarTimes();
    });
  });

  carregarTimes();
});
