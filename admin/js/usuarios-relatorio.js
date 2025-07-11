async function carregarFiltros() {
  const selectTime = document.getElementById("filtroTime");
  selectTime.innerHTML = '<option value="">Todos</option>';
  const timesSnap = await db.collection("times").orderBy("nome").get();
  timesSnap.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().nome;
    selectTime.appendChild(opt);
  });
}

function calcularIdade(dataNascStr) {
  if (!dataNascStr) return null;
  const hoje = new Date();
  const nasc = new Date(dataNascStr);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function formatarData(timestamp) {
  if (!timestamp || !timestamp.toDate) return "-";
  const d = timestamp.toDate();
  return d.toLocaleDateString('pt-BR');
}

let cacheIndicadores = {};

async function buscarUsuarios() {
  const status = document.getElementById("filtroStatus").value;
  const timeId = document.getElementById("filtroTime").value;
  const idadeMin = parseInt(document.getElementById("filtroIdadeMin")?.value || 0);
  const idadeMax = parseInt(document.getElementById("filtroIdadeMax")?.value || 200);
  const dataInicio = document.getElementById("filtroDataInicio").value;
  const dataFim = document.getElementById("filtroDataFim").value;
  const buscaUsuario = document.getElementById("filtroBuscaUsuario").value.toLowerCase();
  const filtroCidade = document.getElementById("filtroCidade").value.toLowerCase();
  const filtroEstado = document.getElementById("filtroEstado").value.toLowerCase();
  const filtroPais = document.getElementById("filtroPais").value.toLowerCase();
  const creditosMin = parseInt(document.getElementById("filtroCreditosMin")?.value || 0);
  const creditosMax = parseInt(document.getElementById("filtroCreditosMax")?.value || 999999);
  const filtroIndicadorNome = document.getElementById("filtroIndicadorNome").value.toLowerCase();

  const tabela = document.getElementById("tabelaUsuarios");
  tabela.innerHTML = "";

  const snap = await db.collection("usuarios").get();
  cacheIndicadores = {};

  for (const doc of snap.docs) {
    const user = doc.data();
    const idade = calcularIdade(user.dataNascimento);
    const cadastro = user.dataCadastro?.toDate?.() || null;

    let indicadorUsuario = "-";

    if (user.indicadoPor) {
      if (!cacheIndicadores[user.indicadoPor]) {
        const indicadorDoc = await db.collection("usuarios").doc(user.indicadoPor).get();
        if (indicadorDoc.exists) {
          cacheIndicadores[user.indicadoPor] = indicadorDoc.data().usuarioUnico || "";
        } else {
          cacheIndicadores[user.indicadoPor] = "-";
        }
      }

      indicadorUsuario = cacheIndicadores[user.indicadoPor];

      if (filtroIndicadorNome && !indicadorUsuario.toLowerCase().includes(filtroIndicadorNome)) {
        continue;
      }
    }

    if (status && user.status !== status) continue;
    if (timeId && user.timeId !== timeId) continue;
    if (idade && (idade < idadeMin || idade > idadeMax)) continue;
    if (dataInicio && (!cadastro || cadastro < new Date(`${dataInicio}T00:00:00`))) continue;
    if (dataFim && (!cadastro || cadastro > new Date(`${dataFim}T23:59:59`))) continue;
    if (buscaUsuario && !(`${user.nome || ""}`.toLowerCase().includes(buscaUsuario) || `${user.usuarioUnico || ""}`.toLowerCase().includes(buscaUsuario))) continue;
    if (filtroCidade && !(`${user.cidade || ""}`.toLowerCase().includes(filtroCidade))) continue;
    if (filtroEstado && !(`${user.estado || ""}`.toLowerCase().includes(filtroEstado))) continue;
    if (filtroPais && !(`${user.pais || ""}`.toLowerCase().includes(filtroPais))) continue;
    if (user.creditos < creditosMin || user.creditos > creditosMax) continue;

    let timeNome = "-";
    if (user.timeId) {
      const timeDoc = await db.collection("times").doc(user.timeId).get();
      if (timeDoc.exists) {
        const timeData = timeDoc.data();
        timeNome = `${timeData.nome} - ${timeData.pais?.slice(0, 3).toUpperCase() || ""}`;
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="linhaSelecionada" value="${doc.id}" /></td>
      <td>${user.nome}</td>
      <td>${user.usuario || "-"}</td>
      <td>${user.status}</td>
      <td>${timeNome}</td>
      <td>${idade || "-"}</td>
      <td>${user.creditos || 0}</td>
      <td>${formatarData(user.dataCadastro)}</td>
      <td>${indicadorUsuario}</td>
      <td>${user.cidade || "-"}</td>
      <td>${user.estado || "-"}</td>
      <td>${user.pais || "-"}</td>
    `;
    tabela.appendChild(tr);
  }
}

function selecionarTodosCheckboxes(source) {
  const checkboxes = document.querySelectorAll('.linhaSelecionada');
  checkboxes.forEach(cb => cb.checked = source?.checked ?? true);
}

// As funções exportarExcel, gerarPDF e exportarCSV permanecem inalteradas...

document.addEventListener('DOMContentLoaded', () => {
  carregarFiltros();
  carregarPaises();
});



async function carregarPaises() {
  const selectPais = document.getElementById("filtroPais");
  if (!selectPais) return;

  selectPais.innerHTML = `<option value="">Todos</option>`;
  const snapshot = await db.collection("paises").orderBy("nome").get();
  snapshot.forEach(doc => {
    const nomePais = doc.data().nome;
    const opt = document.createElement("option");
    opt.value = nomePais;
    opt.textContent = nomePais;
    selectPais.appendChild(opt);
  });
}



function exportarExcel() {
  const rows = [];
  const checkboxes = document.querySelectorAll(".linhaSelecionada:checked");

  checkboxes.forEach(cb => {
    const tr = cb.closest("tr");
    const cols = [...tr.children].map(td => td.innerText);
    rows.push(cols.slice(1));
  });

  if (rows.length === 0) return alert("Selecione pelo menos um usuário.");

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Nome", "Usuário", "Status", "Time", "Idade", "Créditos", "Cadastro", "Indicador", "Cidade", "Estado", "País"],
    ...rows
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "RelatorioUsuarios");
  XLSX.writeFile(wb, "relatorio_usuarios.xlsx");
}

function gerarPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(12);
  doc.text("Relatório de Usuários Yellup", 14, 20);

  const rows = [];
  const checkboxes = document.querySelectorAll(".linhaSelecionada:checked");

  checkboxes.forEach(cb => {
    const tr = cb.closest("tr");
    const cols = [...tr.children].map(td => td.innerText);
    rows.push(cols.slice(1));
  });

  if (rows.length === 0) return alert("Selecione pelo menos um usuário.");

  doc.autoTable({
    head: [[
      "Nome", "Usuário", "Status", "Time", "Idade", "Créditos",
      "Cadastro", "Indicador", "Cidade", "Estado", "País"
    ]],
    body: rows,
    startY: 30,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] }
  });

  doc.save("relatorio_usuarios.pdf");
}

function exportarCSV() {
  const checkboxes = document.querySelectorAll(".linhaSelecionada:checked");
  if (checkboxes.length === 0) return alert("Selecione pelo menos um usuário.");

  const headers = [
    "Nome", "Usuário", "Status", "Time", "Idade", "Créditos",
    "Cadastro", "Indicador", "Cidade", "Estado", "País"
  ];

  const linhas = [headers];

  checkboxes.forEach(cb => {
    const tr = cb.closest("tr");
    const cols = [...tr.children].map(td => td.innerText);
    linhas.push(cols.slice(1));
  });

  const csvContent = linhas.map(linha =>
    linha.map(valor => `"${valor.replace(/"/g, '""')}"`).join(";")
  ).join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", "relatorio_usuarios.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
