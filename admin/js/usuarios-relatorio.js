const db = firebase.firestore();

async function carregarTimes() {
  const select = document.getElementById("filtroTime");
  select.innerHTML = `<option value="Todos">Todos</option>`;
  const snapshot = await db.collection("times").orderBy("nome").get();
  snapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().nome;
    select.appendChild(opt);
  });
}

function calcularIdade(dataNasc) {
  if (!dataNasc) return "-";
  const nascimento = new Date(dataNasc);
  const hoje = new Date();
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const m = hoje.getMonth() - nascimento.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) idade--;
  return idade;
}

async function buscarUsuarios() {
  const lista = document.getElementById("tabelaUsuarios");
  lista.innerHTML = "";

  const snapshot = await db.collection("usuarios").get();
  for (const doc of snapshot.docs) {
    const u = doc.data();
    const idade = calcularIdade(u.dataNascimento);
    const dataCadastro = u.dataCadastro?.toDate().toLocaleDateString("pt-BR") || "-";

    let nomeTime = "-";
    if (u.timeId) {
      const timeDoc = await db.collection("times").doc(u.timeId).get();
      if (timeDoc.exists) nomeTime = timeDoc.data().nome;
    }

    let nomeIndicador = "-";
    if (u.indicadoPor && u.indicadoPor !== "-") {
      try {
        const indDoc = await db.collection("usuarios").doc(u.indicadoPor).get();
        if (indDoc.exists) nomeIndicador = indDoc.data().nome || "-";
      } catch (e) {
        console.warn("Erro ao buscar indicador:", e);
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="ckbUsuario" /></td>
      <td>${u.nome || "-"}</td>
      <td>${u.usuario || "-"}</td>
      <td>${u.status || "-"}</td>
      <td>${nomeTime}</td>
      <td>${idade}</td>
      <td>${u.creditos || 0}</td>
      <td>${dataCadastro}</td>
      <td>${nomeIndicador}</td>
      <td>${u.cidade || "-"}</td>
      <td>${u.estado || "-"}</td>
      <td>${u.pais || "-"}</td>
    `;
    lista.appendChild(tr);
  }
}

function exportarExcel() {
  const tabela = document.querySelector("table");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(tabela);
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, "relatorio_usuarios.xlsx");
}

function exportarCSV() {
  const tabela = document.querySelector("table");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(tabela);
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, "relatorio_usuarios.csv");
}

function gerarPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text("Relatório de Usuários Yellup", 14, 15);

  const headers = [["Nome", "Usuário", "Status", "Time", "Idade", "Créditos", "Cadastro", "Indicador", "Cidade", "Estado", "País"]];
  const dados = Array.from(document.querySelectorAll(".ckbUsuario:checked")).map(cb => {
    const row = cb.closest("tr");
    return Array.from(row.children).slice(1).map(td => td.textContent.trim());
  });

  doc.autoTable({
    head: headers,
    body: dados.length ? dados : [["Nenhum usuário selecionado"]],
    startY: 25,
    theme: 'grid'
  });

  doc.save("relatorio_usuarios.pdf");
}

document.getElementById("btnBuscar").onclick = buscarUsuarios;
document.getElementById("btnExcel").onclick = exportarExcel;
document.getElementById("btnCSV").onclick = exportarCSV;
document.getElementById("btnPDF").onclick = gerarPDF;
document.getElementById("btnSelecionarTodos").onclick = () => {
  document.querySelectorAll(".ckbUsuario").forEach(cb => cb.checked = true);
};

window.onload = () => {
  carregarTimes();
  buscarUsuarios();
};
