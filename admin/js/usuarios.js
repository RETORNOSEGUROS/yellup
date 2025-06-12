// usuarios.js corrigido

// Aqui o db e auth já estão definidos globalmente via firebase-init.js

document.addEventListener("DOMContentLoaded", carregarUsuarios);

function carregarUsuarios() {
  const tabela = document.getElementById("tabelaUsuarios");
  tabela.innerHTML = "";

  db.collection("usuarios").orderBy("nome").get().then(snapshot => {
    snapshot.forEach(doc => {
      const usuario = doc.data();
      const linha = document.createElement("tr");
      linha.innerHTML = `
        <td>${usuario.nome || '-'}</td>
        <td>${usuario.email || '-'}</td>
        <td>${usuario.creditos != null ? usuario.creditos : 0}</td>
        <td>${usuario.status || 'ativo'}</td>
        <td><button onclick="editarUsuario('${doc.id}')">Editar</button></td>
      `;
      tabela.appendChild(linha);
    });
  });
}

// Exemplo de função para edição futura (ainda não implementada)
function editarUsuario(id) {
  alert("Função editar usuário ainda será implementada. ID: " + id);
}
