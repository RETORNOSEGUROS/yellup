// Inicialização do Firebase
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Carregar times para o filtro
async function carregarTimes() {
  const select = document.getElementById("filtroTime");
  select.innerHTML = `<option value="Todos">Todos</option>`;
  const snapshot = await db.collection("times").orderBy("nome").get();
  snapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.data().nome;
    opt.textContent = doc.data().nome;
    select.appendChild(opt);
  });
}

// Buscar usuários com filtros
async function buscarUsuarios() {
  const tabela = document.getElementById("tabelaUsuarios");
  tabela.innerHTML = "";

  const filtroStatus = document.getElementById("filtroStatus").value;
  const filtroTime = document.getElementById("filtroTime").value;
  const idadeMin = parseInt(document.getElementById("filtroIdadeMin").value) || 0;
  const idadeMax = parseInt(document.getElementById("filtroIdadeMax").value) || 200;
  const filtroIndicador = document.getElementById("filtroIndicador").value.toLowerCase();
  const dataInicio = document.getElementById("filtroDataInicio").value;
  const dataFim = document.getElementById("filtroDataFim").value;
  const filtroNomeUsuario = document.getElementById("filtroNomeUsuario").value.toLowerCase();
  const filtroCidade = document.getElementById("filtroCidade").value.toLowerCase();
  const filtroEstado = document.getElementById("filtroEstado").value.toLowerCase();
  const filtroPais = document.getElementById("filtroPais").value.toLowerCase();
  const creditoMin = parseInt(document.getElementById("filtroCreditosMin").value) || 0;
  const creditoMax = parseInt(document.getElementById("filtroCreditosMax").value) || 9999;

  const snapshot = await db.collection("usuarios").get();
  for (const doc of snapshot.docs) {
    const u = doc.data();
    const idade = calcularIdade(u.dataNasc);
    const nome = u.nome?.toLowerCase() || "";
    const usuario = u.usuario?.toLowerCase() || "";
    const cidade = u.cidade?.toLowerCase() || "";
    const estado = u.estado?.toLowerCase() || "";
    const pais = u.pais?.toLowerCase() || "";
    const dataCadastro = u.dataCadastro || "";
    const creditos = u.creditos || 0;
    const time = u.time || "";

    if (
      (filtroStatus !== "todos" && u.status !== filtroStatus) ||
      (filtroTime !== "Todos" && time !== filtroTime) ||
      idade < idadeMin || idade > idadeMax ||
      (filtroNomeUsuario && !nome.includes(filtroNomeUsuario) && !usuario.includes(filtroNomeUsuario)) ||
      (filtroCidade && !cidade.includes(filtroCidade)) ||
      (filtroEstado && !estado.includes(filtroEstado)) ||
      (filtroPais && !pais.includes(filtroPais)) ||
      (creditos < creditoMin || creditos > creditoMax) ||
      (dataInicio && dataCadastro < dataInicio) ||
      (dataFim && dataCadastro > dataFim)
    ) continue;

    // Buscar nome do indicador
    let nomeIndicador = "-";
    if (u.indicadoPor) {
      const indDoc = await db.collection("usuarios").doc(u.indicadoPor).get();
      if (indDoc.exists) nomeIndicador = indDoc.data().nome || "-";
    }

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

function calcularIdade(data) {
  if (!data) return "-";
  const [ano, mes, dia] = data.split("-").map(Number);
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
  const tabela = document.getElementById("tabelaUsuarios");
  const headers = [["Nome", "Usuário", "Status", "Time", "Idade", "Créditos", "Cadastro", "Indicador", "Cidade", "Estado", "País"]];
  const data = Array.from(tabela.querySelectorAll("tr"))
    .slice(1)
    .filter(row => row.querySelector("input[type='checkbox']").checked)
    .map(row => Array.from(row.children).slice(1).map(td => td.textContent));
  doc.autoTable({
    head: headers,
    body: data.length ? data : [["Nenhum usuário selecionado"]],
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
