// Inicialização do Firebase (ajuste com sua config real se ainda não estiver no projeto)
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Carrega os times no filtro
async function carregarTimes() {
  const select = document.getElementById("filtroTime");
  if (!select) return;
  select.innerHTML = `<option value="Todos">Todos</option>`;
  const snapshot = await db.collection("times").orderBy("nome").get();
  snapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.data().nome;
    opt.textContent = doc.data().nome;
    select.appendChild(opt);
  });
}

// Calcula idade baseado na data de nascimento
function calcularIdade(dataNasc) {
  if (!dataNasc) return "-";
  const [ano, mes, dia] = dataNasc.split("-").map(Number);
  const hoje = new Date();
  let idade = hoje.getFullYear() - ano;
  if (
    hoje.getMonth() + 1 < mes ||
    (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)
  ) {
    idade--;
  }
  return idade;
}

// Busca usuários com base nos filtros
async function buscarUsuarios() {
  const tabela = document.getElementById("tabelaUsuarios");
  tabela.innerHTML = "";

  const filtros = {
    status: document.getElementById("filtroStatus").value,
    time: document.getElementById("filtroTime").value,
    idadeMin: parseInt(document.getElementById("filtroIdadeMin").value) || 0,
    idadeMax: parseInt(document.getElementById("filtroIdadeMax").value) || 150,
    indicador: document.getElementById("filtroIndicador").value.toLowerCase(),
    nomeUsuario: document.getElementById("filtroNomeUsuario").value.toLowerCase(),
    cidade: document.getElementById("filtroCidade").value.toLowerCase(),
    estado: document.getElementById("filtroEstado").value.toLowerCase(),
    pais: document.getElementById("filtroPais").value.toLowerCase(),
    creditosMin: parseInt(document.getElementById("filtroCreditosMin").value) || 0,
    creditosMax: parseInt(document.getElementById("filtroCreditosMax").value) || 9999,
    dataInicio: document.getElementById("filtroDataInicio").value,
    dataFim: document.getElementById("filtroDataFim").value
  };

  const snapshot = await db.collection("usuarios").get();

  for (const doc of snapshot.docs) {
    const u = doc.data();
    const idade = calcularIdade(u.dataNasc);
    const dataCadastro = u.dataCadastro || "-";
    const creditos = u.creditos || 0;

    // Filtros
    if (
      (filtros.status !== "todos" && u.status !== filtros.status) ||
      (filtros.time !== "Todos" && u.time !== filtros.time) ||
      idade < filtros.idadeMin || idade > filtros.idadeMax ||
      (filtros.nomeUsuario && !(`${u.nome} ${u.usuario}`.toLowerCase().includes(filtros.nomeUsuario))) ||
      (filtros.cidade && !(u.cidade || "").toLowerCase().includes(filtros.cidade)) ||
      (filtros.estado && !(u.estado || "").toLowerCase().includes(filtros.estado)) ||
      (filtros.pais && !(u.pais || "").toLowerCase().includes(filtros.pais)) ||
      (creditos < filtros.creditosMin || creditos > filtros.creditosMax) ||
      (filtros.dataInicio && dataCadastro < filtros.dataInicio) ||
      (filtros.dataFim && dataCadastro > filtros.dataFim)
    ) continue;

    // Indicador (resolve nome via ID)
    let nomeIndicador = "-";
    if (u.indicadoPor) {
      try {
        const indDoc = await db.collection("usuarios").doc(u.indicadoPor).get();
        if (indDoc.exists) nomeIndicador = indDoc.data().nome || "-";
      } catch (e) {}
    }

    // Verifica se nome do indicador corresponde ao filtro
    if (
      filtros.indicador &&
      !nomeIndicador.toLowerCase().includes(filtros.indicador)
    ) continue;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="ckbUsuario" data-id="${doc.id}"></td>
      <td>${u.nome || "-"}</td>
      <td>${u.usuario || "-"}</td>
      <td>${u.status || "-"}</td>
      <td>${u.time || "-"}</td>
      <td>${idade}</td>
      <td>${creditos}</td>
      <td>${dataCadastro}</td>
      <td>${nomeIndicador}</td>
      <td>${u.cidade || "-"}</td>
      <td>${u.estado || "-"}</td>
      <td>${u.pais || "-"}</td>
    `;
    tabela.appendChild(tr);
  }
}

// Exportações

function exportarExcel() {
  const tabela = document.getElementById("tabelaUsuarios");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(tabela);
  XLSX.utils.book_append_sheet(wb, ws, "Usuários");
  XLSX.writeFile(wb, "relatorio_usuarios.xlsx");
}

function exportarCSV() {
  const tabela = document.getElementById("tabelaUsuarios");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(tabela);
  XLSX.utils.book_append_sheet(wb, ws, "Usuários");
  XLSX.writeFile(wb, "relatorio_usuarios.csv");
}

function gerarPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text("Relatório de Usuários Yellup", 14, 15);
  const headers = [["Nome", "Usuário", "Status", "Time", "Idade", "Créditos", "Cadastro", "Indicador", "Cidade", "Estado", "País"]];
  const linhas = Array.from(document.querySelectorAll(".ckbUsuario:checked")).map(ckb => {
    const tr = ckb.closest("tr");
    return Array.from(tr.children).slice(1).map(td => td.textContent);
  });
  doc.autoTable({
    head: headers,
    body: linhas.length ? linhas : [["Nenhum usuário selecionado"]],
    startY: 25,
    theme: 'grid'
  });
  doc.save("relatorio_usuarios.pdf");
}

// Eventos
document.getElementById("btnBuscar").onclick = buscarUsuarios;
document.getElementById("btnExcel").onclick = exportarExcel;
document.getElementById("btnCSV").onclick = exportarCSV;
document.getElementById("btnPDF").onclick = gerarPDF;
document.getElementById("btnSelecionarTodos").onclick = () => {
  document.querySelectorAll(".ckbUsuario").forEach(cb => cb.checked = true);
};

// Inicialização
window.onload = () => {
  carregarTimes();
  buscarUsuarios();
};
