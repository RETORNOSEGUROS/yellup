// Referência ao Firestore


async function carregarFiltros() {
  const timeSelect = document.getElementById("filtroTime");
  timeSelect.innerHTML = `<option value="todos">Todos</option>`;
  const timesSnapshot = await db.collection("times").orderBy("nome").get();
  timesSnapshot.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().nome + (doc.data().sigla ? ` - ${doc.data().sigla}` : "");
    timeSelect.appendChild(opt);
  });
}

document.getElementById("btnBuscar").addEventListener("click", buscarUsuarios);
document.getElementById("btnExcel").addEventListener("click", exportarExcel);
document.getElementById("btnCSV").addEventListener("click", exportarCSV);
document.getElementById("btnPDF").addEventListener("click", exportarPDF);
document.getElementById("btnSelecionarTodos").addEventListener("click", () => {
  document.querySelectorAll(".ckbUsuario").forEach(cb => cb.checked = true);
});

function getFiltros() {
  return {
    status: document.getElementById("filtroStatus").value,
    timeId: document.getElementById("filtroTime").value,
    idadeMin: parseInt(document.getElementById("filtroIdadeMin").value) || 0,
    idadeMax: parseInt(document.getElementById("filtroIdadeMax").value) || 200,
    dataInicio: document.getElementById("filtroDataInicio").value,
    dataFim: document.getElementById("filtroDataFim").value,
    nomeUsuario: document.getElementById("filtroNomeUsuario").value.toLowerCase(),
    cidade: document.getElementById("filtroCidade").value.toLowerCase(),
    estado: document.getElementById("filtroEstado").value.toLowerCase(),
    pais: document.getElementById("filtroPais").value.toLowerCase(),
    creditosMin: parseInt(document.getElementById("filtroCreditosMin").value) || 0,
    creditosMax: parseInt(document.getElementById("filtroCreditosMax").value) || 999999,
    indicadoPorNome: document.getElementById("filtroIndicador").value.toLowerCase()
  };
}

async function buscarUsuarios() {
  const lista = document.getElementById("tabelaUsuarios");
  lista.innerHTML = "";
  const filtros = getFiltros();
  const snapshot = await db.collection("usuarios").get();
  const usuarios = [];

  for (const doc of snapshot.docs) {
    const u = doc.data();
    const idade = u.dataNascimento ? calcularIdade(u.dataNascimento) : "-";

    if (
      (filtros.status !== "todos" && u.status !== filtros.status) ||
      (filtros.timeId !== "todos" && u.timeId !== filtros.timeId) ||
      (idade !== "-" && (idade < filtros.idadeMin || idade > filtros.idadeMax)) ||
      (filtros.nomeUsuario && !((u.nome || "").toLowerCase().includes(filtros.nomeUsuario) || (u.usuarioUnico || "").toLowerCase().includes(filtros.nomeUsuario))) ||
      (filtros.cidade && (u.cidade || "").toLowerCase() !== filtros.cidade) ||
      (filtros.estado && (u.estado || "").toLowerCase() !== filtros.estado) ||
      (filtros.pais && (u.pais || "").toLowerCase() !== filtros.pais) ||
      (u.creditos < filtros.creditosMin || u.creditos > filtros.creditosMax)
    ) continue;

    if (filtros.dataInicio || filtros.dataFim) {
      const data = u.dataCadastro?.toDate();
      if (!data) continue;
      if (filtros.dataInicio && data < new Date(filtros.dataInicio)) continue;
      if (filtros.dataFim && data > new Date(filtros.dataFim + "T23:59:59")) continue;
    }

    if (filtros.indicadoPorNome) {
      let nomeIndicador = "-";
      if (u.indicadoPor && u.indicadoPor !== "-") {
        const indicadorDoc = await db.collection("usuarios").doc(u.indicadoPor).get();
        if (indicadorDoc.exists) nomeIndicador = indicadorDoc.data().nome || "-";
      }
      if (!nomeIndicador.toLowerCase().includes(filtros.indicadoPorNome)) continue;
    }

    let nomeTime = "-";
    if (u.timeId) {
      const timeDoc = await db.collection("times").doc(u.timeId).get();
      if (timeDoc.exists) {
        const t = timeDoc.data();
        nomeTime = `${t.nome}${t.sigla ? ` - ${t.sigla}` : ""}`;
      }
    }

    let nomeIndicador = "-";
    if (u.indicadoPor && u.indicadoPor !== "-") {
      const indicadorDoc = await db.collection("usuarios").doc(u.indicadoPor).get();
      if (indicadorDoc.exists) nomeIndicador = indicadorDoc.data().nome || "-";
    }

    const row = {
      nome: u.nome,
      usuario: u.usuarioUnico || "-",
      status: u.status,
      time: nomeTime,
      idade: idade,
      creditos: u.creditos,
      dataCadastro: u.dataCadastro?.toDate().toLocaleDateString("pt-BR") || "-",
      indicador: nomeIndicador,
      cidade: u.cidade || "-",
      estado: u.estado || "-",
      pais: u.pais || "-"
    };
    usuarios.push(row);

    lista.innerHTML += `
      <tr>
        <td><input type="checkbox" class="ckbUsuario"></td>
        <td>${row.nome}</td>
        <td>${row.usuario}</td>
        <td>${row.status}</td>
        <td>${row.time}</td>
        <td>${row.idade}</td>
        <td>${row.creditos}</td>
        <td>${row.dataCadastro}</td>
        <td>${row.indicador}</td>
        <td>${row.cidade}</td>
        <td>${row.estado}</td>
        <td>${row.pais}</td>
      </tr>
    `;
  }

  window.resultadoUsuarios = usuarios;
}

function calcularIdade(dataNascStr) {
  const hoje = new Date();
  const nasc = new Date(dataNascStr);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade;
}

function exportarExcel() {
  const XLSX = window.XLSX;
  const linhasSelecionadas = Array.from(document.querySelectorAll(".ckbUsuario:checked")).map(cb => cb.closest("tr"));
  const cabecalhos = ["Nome", "Usuário", "Status", "Time", "Idade", "Créditos", "Data Cadastro", "Indicador", "Cidade", "Estado", "País"];
  const dados = linhasSelecionadas.map(tr => {
    return Array.from(tr.children).slice(1).map(td => td.textContent.trim());
  });
  const ws = XLSX.utils.aoa_to_sheet([cabecalhos, ...dados]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Relatório");
  XLSX.writeFile(wb, "relatorio_usuarios.xlsx");
}

function exportarCSV() {
  const linhasSelecionadas = Array.from(document.querySelectorAll(".ckbUsuario:checked")).map(cb => cb.closest("tr"));
  const cabecalhos = ["Nome",Usuário,Status,Time,Idade,Créditos,Data Cadastro,Indicador,Cidade,Estado,País];
  const dados = linhasSelecionadas.map(tr =>
    Array.from(tr.children).slice(1).map(td => `"${td.textContent.trim()}"`).join(",")
  );
  const csvContent = [cabecalhos.join(","), ...dados].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "relatorio_usuarios.csv";
  link.click();
}

function exportarPDF() {
  const doc = new jspdf.jsPDF();
  const linhasSelecionadas = Array.from(document.querySelectorAll(".ckbUsuario:checked")).map(cb => cb.closest("tr"));
  const cabecalhos = ["Nome", "Usuário", "Status", "Time", "Idade", "Créditos", "Cadastro", "Indicador", "Cidade", "Estado", "País"];
  const dados = linhasSelecionadas.map(tr =>
    Array.from(tr.children).slice(1).map(td => td.textContent.trim())
  );
  doc.text("Relatório de Usuários Yellup", 14, 10);
  doc.autoTable({ startY: 20, head: [cabecalhos], body: dados });
  doc.save("relatorio_usuarios.pdf");
}

window.onload = () => {
  carregarFiltros();
};
