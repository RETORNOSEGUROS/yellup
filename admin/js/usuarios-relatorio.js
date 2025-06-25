import { db } from "./firebase-config.js";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore-lite.js";

// Referência à coleção
const usuariosRef = collection(db, "usuarios");
const timesRef = collection(db, "times");

// Função principal de carregamento
window.addEventListener("DOMContentLoaded", async () => {
  await carregarTimes();
  await buscarUsuarios();

  document.getElementById("filtrosForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await buscarUsuarios();
  });

  document.getElementById("selecionarTodos").addEventListener("click", () => {
    document.querySelectorAll("#tabelaUsuarios tbody input[type='checkbox']").forEach((el) => {
      el.checked = true;
    });
  });

  document.getElementById("exportarExcel").addEventListener("click", exportarExcel);
  document.getElementById("exportarCSV").addEventListener("click", exportarCSV);
  document.getElementById("gerarPDF").addEventListener("click", gerarPDF);
});

async function carregarTimes() {
  const snapshot = await getDocs(timesRef);
  const select = document.getElementById("filtroTime");
  snapshot.forEach(doc => {
    const option = document.createElement("option");
    option.value = doc.data().nome;
    option.textContent = doc.data().nome + (doc.data().pais ? ` - ${doc.data().pais}` : "");
    select.appendChild(option);
  });
}

async function buscarUsuarios() {
  const snapshot = await getDocs(usuariosRef);
  const todosUsuarios = [];

  snapshot.forEach(doc => {
    const usuario = doc.data();
    usuario.id = doc.id;
    todosUsuarios.push(usuario);
  });

  const filtros = coletarFiltros();
  const resultado = aplicarFiltros(todosUsuarios, filtros);
  renderizarTabela(resultado);
}

function coletarFiltros() {
  const get = (id) => document.getElementById(id).value.trim();
  return {
    status: get("filtroStatus"),
    time: get("filtroTime"),
    idadeMin: parseInt(get("filtroIdadeMin")),
    idadeMax: parseInt(get("filtroIdadeMax")),
    indicador: get("filtroIndicador").toLowerCase(),
    nomeUsuario: get("filtroNomeUsuario").toLowerCase(),
    cidade: get("filtroCidade").toLowerCase(),
    estado: get("filtroEstado").toLowerCase(),
    pais: get("filtroPais").toLowerCase(),
    creditosMin: parseInt(get("filtroCreditosMin")),
    creditosMax: parseInt(get("filtroCreditosMax")),
    dataCadastro: get("filtroDataCadastro")
  };
}

function aplicarFiltros(usuarios, filtros) {
  return usuarios.filter(u => {
    const idade = u.idade || 0;
    const creditos = u.creditos || 0;
    const nome = (u.nome || "").toLowerCase();
    const usuario = (u.usuario || "").toLowerCase();
    const indicador = (u.indicadoPor || "").toLowerCase();

    const condicoes = [
      !filtros.status || u.status === filtros.status,
      !filtros.time || u.time === filtros.time,
      !filtros.idadeMin || idade >= filtros.idadeMin,
      !filtros.idadeMax || idade <= filtros.idadeMax,
      !filtros.creditosMin || creditos >= filtros.creditosMin,
      !filtros.creditosMax || creditos <= filtros.creditosMax,
      !filtros.nomeUsuario || nome.includes(filtros.nomeUsuario) || usuario.includes(filtros.nomeUsuario),
      !filtros.indicador || indicador.includes(filtros.indicador),
      !filtros.cidade || (u.cidade || "").toLowerCase().includes(filtros.cidade),
      !filtros.estado || (u.estado || "").toLowerCase().includes(filtros.estado),
      !filtros.pais || (u.pais || "").toLowerCase().includes(filtros.pais),
      !filtros.dataCadastro || formatarData(u.dataCadastro?.toDate?.()) === filtros.dataCadastro.split("-").reverse().join("/")
    ];

    return condicoes.every(Boolean);
  });
}

function renderizarTabela(usuarios) {
  const tbody = document.getElementById("tabelaBody");
  tbody.innerHTML = "";

  usuarios.forEach(u => {
    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    tdCheck.innerHTML = `<input type="checkbox">`;
    tr.appendChild(tdCheck);

    const campos = [
      u.nome || "-",
      u.usuario || "-",
      u.status || "-",
      u.time || "-",
      u.idade || "-",
      u.creditos ?? "-",
      formatarData(u.dataCadastro?.toDate?.()) || "-",
      u.indicadoPor || "-",
      u.cidade || "-",
      u.estado || "-",
      u.pais || "-"
    ];

    campos.forEach(texto => {
      const td = document.createElement("td");
      td.textContent = texto;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function formatarData(data) {
  if (!data) return "-";
  const d = new Date(data);
  return d.toLocaleDateString("pt-BR");
}

function exportarExcel() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(document.getElementById("tabelaUsuarios"));
  XLSX.utils.book_append_sheet(wb, ws, "Usuários");
  XLSX.writeFile(wb, "relatorio_usuarios.xlsx");
}

function exportarCSV() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(document.getElementById("tabelaUsuarios"));
  XLSX.utils.book_append_sheet(wb, ws, "Usuários");
  XLSX.writeFile(wb, "relatorio_usuarios.csv", { bookType: "csv" });
}

function gerarPDF() {
  const doc = new jspdf.jsPDF();
  doc.text("Relatório de Usuários Yellup", 14, 15);
  doc.autoTable({
    html: "#tabelaUsuarios",
    startY: 25,
    theme: "grid"
  });
  doc.save("relatorio_usuarios.pdf");
}
