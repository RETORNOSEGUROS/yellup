
let paginaAtual = 1;
const jogosPorPagina = 10;
let jogosCache = [];
let ordenacaoAscendente = false;



function alternarOrdenacao() {
  ordenacaoAscendente = !ordenacaoAscendente;
  listarJogos();
}



function proximaPagina() {
  if (paginaAtual * jogosPorPagina < jogosCache.length) {
    paginaAtual++;
    listarJogos();
  }
}
function paginaAnterior() {
  if (paginaAtual > 1) {
    paginaAtual--;
    listarJogos();
  }
}
function atualizarControlesPaginacao() {
  document.getElementById("paginacaoInfo").textContent =
    `Página ${paginaAtual} de ${Math.ceil(jogosCache.length / jogosPorPagina)}`;
}



async function listarJogos() {
  const lista = document.getElementById("listaJogos");
  lista.innerHTML = "";

  const filtroStatus = document.getElementById("filtroStatus").value;
  const filtroInicio = document.getElementById("filtroDataInicio").value;
  const filtroFim = document.getElementById("filtroDataFim").value;
  const filtroTime = document.getElementById("filtroTime").value;

  const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();
  const todosJogos = [];

  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const dataInicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio);
    const dataFim = jogo.dataFim?.toDate?.() || new Date(jogo.dataFim);

    if (filtroInicio && dataFim < new Date(filtroInicio + "T00:00:00")) continue;
    if (filtroFim && dataInicio > new Date(filtroFim + "T23:59:59")) continue;
    if (filtroStatus && jogo.status !== filtroStatus) continue;
    if (filtroTime && filtroTime !== jogo.timeCasaId && filtroTime !== jogo.timeForaId) continue;

    todosJogos.push({ id: doc.id, jogo });
  }

  jogosCache = [...todosJogos];

  // Ordenação
  jogosCache.sort((a, b) => {
    const dataA = a.jogo.dataInicio?.toDate?.() || new Date(a.jogo.dataInicio);
    const dataB = b.jogo.dataInicio?.toDate?.() || new Date(b.jogo.dataInicio);
    return ordenacaoAscendente ? dataA - dataB : dataB - dataA;
  });

  const inicio = (paginaAtual - 1) * jogosPorPagina;
  const fim = inicio + jogosPorPagina;
  const pagina = jogosCache.slice(inicio, fim);

  for (const { id, jogo } of pagina) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="jogoSelecionado" value="${id}"></td>
      <td>${jogo.timeCasaNome || "-"}</td>
      <td>${jogo.timeForaNome || "-"}</td>
      <td>${jogo.dataInicio.toDate().toLocaleString("pt-BR")}</td>
      <td>${jogo.dataFim.toDate().toLocaleString("pt-BR")}</td>
      <td>${jogo.valorEntrada || 0}</td>
      <td>${jogo.status || "-"}</td>
    `;
    lista.appendChild(tr);
  }

  atualizarControlesPaginacao();
}


let jogoEditandoId = null;

async function carregarTimes() {
  const timesRef = await db.collection("times").orderBy("nome").get();
  const selects = [document.getElementById("timeCasa"), document.getElementById("timeVisitante"), document.getElementById("filtroTime")];
  selects.forEach(select => {
    if (!select) return;
    select.innerHTML = '<option value="">Selecione o Time</option>';
    timesRef.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = data.nome + ' - ' + (data.pais || '');
      select.appendChild(opt);
    });
  });
}

function formatarData(timestamp) {
  if (typeof timestamp?.toDate === "function") {
    return timestamp.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  if (typeof timestamp === "string") {
    return new Date(timestamp).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  return "-";
}

function formatarMoeda(valor) {
  return valor?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) || "R$ 0,00";
}

function definirStatus(dataInicio, dataFim) {
  const agora = new Date();
  if (agora < dataInicio) return "agendado";
  if (agora >= dataInicio && agora <= dataFim) return "ao_vivo";
  return "finalizado";
}

async function listarJogos() {
  const lista = document.getElementById("listaJogos");
  lista.innerHTML = "";

  const filtroStatus = document.getElementById("filtroStatus").value;
  const filtroInicio = document.getElementById("filtroDataInicio").value;
  const inicioFiltroDate = filtroInicio ? new Date(filtroInicio + "T00:00:00") : null;
  const filtroFim = document.getElementById("filtroDataFim").value;
  const fimFiltroDate = filtroFim ? new Date(filtroFim + "T23:59:59") : null;
  const filtroTime = document.getElementById("filtroTime").value;

  const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();
  const jogosFiltrados = [];

  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const dataInicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio);
    const dataFim = jogo.dataFim?.toDate?.() || new Date(jogo.dataFim);
    const statusAtualizado = definirStatus(dataInicio, dataFim);

    if (jogo.status !== statusAtualizado) {
      await db.collection("jogos").doc(doc.id).update({ status: statusAtualizado });
    }

    if (filtroStatus && filtroStatus !== statusAtualizado) continue;
    if (inicioFiltroDate && dataFim < inicioFiltroDate) continue;
    if (fimFiltroDate && dataInicio > fimFiltroDate) continue;
    if (filtroTime && filtroTime !== jogo.timeCasaId && filtroTime !== jogo.timeForaId) continue;

    jogosFiltrados.push({ id: doc.id, jogo, status: statusAtualizado });
  }

  jogosFiltrados.sort((a, b) => {
    const peso = { ao_vivo: 1, agendado: 2, finalizado: 3 };
    return peso[a.status] - peso[b.status];
  });

  for (const { id, jogo, status } of jogosFiltrados) {
    const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
    const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();

    const timeCasa = timeCasaDoc.exists ? timeCasaDoc.data() : {};
    const timeFora = timeForaDoc.exists ? timeForaDoc.data() : {};

    const timeCasaNome = `${timeCasa.nome || '-'} - ${timeCasa.pais || ''}`;
    const timeForaNome = `${timeFora.nome || '-'} - ${timeFora.pais || ''}`;

    const coresCasa = `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:linear-gradient(to bottom,${timeCasa.primaria || '#000'} 0%,${timeCasa.primaria || '#000'} 33%,${timeCasa.secundaria || '#000'} 33%,${timeCasa.secundaria || '#000'} 66%,${timeCasa.terciaria || '#000'} 66%,${timeCasa.terciaria || '#000'} 100%)"></span>`;
    const coresFora = `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:linear-gradient(to bottom,${timeFora.primaria || '#000'} 0%,${timeFora.primaria || '#000'} 33%,${timeFora.secundaria || '#000'} 33%,${timeFora.secundaria || '#000'} 66%,${timeFora.terciaria || '#000'} 66%,${timeFora.terciaria || '#000'} 100%)"></span>`;

    lista.innerHTML += `
      <tr>
        <td><input type="checkbox" class="jogoSelecionado" value="${id}"></td>
        <td>${coresCasa} ${timeCasaNome}</td>
        <td>${coresFora} ${timeForaNome}</td>
        <td>${formatarData(jogo.dataInicio)}</td>
        <td>${formatarData(jogo.dataFim)}</td>
        <td>${jogo.valorEntrada} créditos</td>
        <td>${status}</td>
        <td>
          <button onclick="editarJogo('${id}')">Editar</button>
          <button onclick="excluirJogo('${id}')" style="margin-top:4px;color:red">Excluir</button>
        </td>
      </tr>
    `;
  }
}

async function excluirJogo(jogoId) {
  if (confirm("Tem certeza que deseja excluir este jogo?")) {
    await db.collection("jogos").doc(jogoId).delete();
    alert("Jogo excluído com sucesso!");
    listarJogos();
  }
}

function adicionarPatrocinador() {
  const container = document.getElementById("patrocinadoresContainer");
  const item = document.createElement("div");
  item.classList.add("patrocinador-item");
  item.innerHTML = `
    <input type="text" class="patrocinador-nome" placeholder="Nome">
    <input type="number" class="patrocinador-valor" placeholder="Valor em R$">
    <input type="url" class="patrocinador-site" placeholder="Site">
    <input type="file" class="patrocinador-logo">
    <div class="preview"></div>
  `;

  item.querySelector(".patrocinador-logo").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (file && file.size < 300 * 1024) {
      const reader = new FileReader();
      reader.onload = function (evt) {
        const preview = item.querySelector(".preview");
        preview.innerHTML = `<img src="${evt.target.result}" alt="Logo">`;
        item.dataset.base64 = evt.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      alert("Logo inválido ou maior que 300KB.");
    }
  });

  container.appendChild(item);
}

async function salvarJogo() {
  const timeCasaId = document.getElementById("timeCasa").value;
  const timeForaId = document.getElementById("timeVisitante").value;
  const dataInicio = firebase.firestore.Timestamp.fromDate(new Date(document.getElementById("dataInicio").value));
  const dataFim = firebase.firestore.Timestamp.fromDate(new Date(document.getElementById("dataFim").value));
  const valorEntrada = parseInt(document.getElementById("valorEntrada").value) || 0;
  const status = document.getElementById("status").value;

  const patrocinadores = [];
  document.querySelectorAll(".patrocinador-item").forEach(item => {
    patrocinadores.push({
      nome: item.querySelector(".patrocinador-nome").value || "",
      valor: parseInt(item.querySelector(".patrocinador-valor").value) || 0,
      site: item.querySelector(".patrocinador-site").value || "",
      logo: item.dataset.base64 || ""
    });
  });

  const jogoData = { timeCasaId, timeForaId, dataInicio, dataFim, valorEntrada, status, patrocinadores };

  if (jogoEditandoId) {
    await db.collection("jogos").doc(jogoEditandoId).update(jogoData);
    alert("Jogo atualizado com sucesso!");
    jogoEditandoId = null;
    document.getElementById("salvarJogo").textContent = "Salvar Jogo";
  } else {
    await db.collection("jogos").add(jogoData);
    alert("Jogo salvo com sucesso!");
  }

  listarJogos();
}

async function editarJogo(jogoId) {
  const doc = await db.collection("jogos").doc(jogoId).get();
  if (!doc.exists) return alert("Jogo não encontrado!");

  const jogo = doc.data();
  jogoEditandoId = jogoId;

  document.getElementById("timeCasa").value = jogo.timeCasaId;
  document.getElementById("timeVisitante").value = jogo.timeForaId;
  document.getElementById("dataInicio").value = jogo.dataInicio.toDate().toISOString().slice(0, 16);
  document.getElementById("dataFim").value = jogo.dataFim.toDate().toISOString().slice(0, 16);
  document.getElementById("valorEntrada").value = jogo.valorEntrada;
  document.getElementById("status").value = jogo.status;

  document.getElementById("patrocinadoresContainer").innerHTML = "";
  (jogo.patrocinadores || []).forEach(p => {
    const item = document.createElement("div");
    item.classList.add("patrocinador-item");
    item.dataset.base64 = p.logo;
    item.innerHTML = `
      <input type="text" class="patrocinador-nome" placeholder="Nome" value="${p.nome}">
      <input type="number" class="patrocinador-valor" placeholder="Valor em R$" value="${p.valor}">
      <input type="url" class="patrocinador-site" placeholder="Site" value="${p.site}">
      <input type="file" class="patrocinador-logo">
      <div class="preview">${p.logo ? `<img src="${p.logo}" alt="Logo">` : ""}</div>
    `;
    item.querySelector(".patrocinador-logo").addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (file && file.size < 300 * 1024) {
        const reader = new FileReader();
        reader.onload = function (evt) {
          const preview = item.querySelector(".preview");
          preview.innerHTML = `<img src="${evt.target.result}" alt="Logo">`;
          item.dataset.base64 = evt.target.result;
        };
        reader.readAsDataURL(file);
      } else {
        alert("Logo inválido ou maior que 300KB.");
      }
    });
    document.getElementById("patrocinadoresContainer").appendChild(item);
  });

  document.getElementById("salvarJogo").textContent = "Atualizar Jogo";
}

function exportarTabelaCSV() {
  let csv = "Casa,Visitante,Início,Fim,Entrada,Status\n";
  document.querySelectorAll("#listaJogos tr").forEach(row => {
    const cols = Array.from(row.children).slice(0, 6).map(col => col.innerText.replace(/\n/g, ' ').trim());
    csv += cols.join(",") + "\n";
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "jogos.csv";
  link.click();
}

function exportarTabelaPDF() {
  import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js").then(jsPDFModule => {
    const { jsPDF } = jsPDFModule;
    const doc = new jsPDF();
    let y = 10;
    doc.text("Lista de Jogos", 10, y);
    y += 10;
    document.querySelectorAll("#listaJogos tr").forEach(row => {
      const cols = Array.from(row.children).slice(0, 6).map(col => col.innerText.replace(/\n/g, ' ').trim());
      doc.text(cols.join(" | "), 10, y);
      y += 10;
    });
    doc.save("jogos.pdf");
  });
}

window.onload = () => {
  carregarTimes();
  listarJogos();
  document.getElementById("btnAdicionarPatrocinador").onclick = adicionarPatrocinador;
  document.getElementById("salvarJogo").onclick = salvarJogo;
  document.getElementById("btnExportarCSV").onclick = exportarTabelaCSV;
  document.getElementById("btnExportarPDF").onclick = exportarTabelaPDF;
};



function selecionarTodos(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.jogoSelecionado');
  checkboxes.forEach(cb => cb.checked = masterCheckbox.checked);
}


function exportarTabelaPDF() {
  import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js").then(jsPDFModule => {
    const { jsPDF } = jsPDFModule;
    const doc = new jsPDF();
    let y = 10;
    doc.setFontSize(12);
    doc.text("Lista de Jogos", 10, y);
    y += 10;

    const linhasSelecionadas = obterJogosSelecionados();
    const linhas = linhasSelecionadas.length ? linhasSelecionadas : document.querySelectorAll("#listaJogos tr");

    linhas.forEach(row => {
      const cols = Array.from(row.children).slice(1, 7).map(col => col.innerText.replace(/\n/g, ' ').trim());
      doc.text(cols.join(" | "), 10, y);
      y += 10;
      if (y > 280) {
        doc.addPage();
        y = 10;
      }
    });
    doc.save("jogos.pdf");
  });
}

function exportarTabelaExcel() {
  const linhasSelecionadas = obterJogosSelecionados();
  const linhas = linhasSelecionadas.length ? linhasSelecionadas : document.querySelectorAll("#listaJogos tr");

  let table = `<table border='1'><tr>
    <th>Casa</th><th>Visitante</th><th>Início</th><th>Fim</th><th>Entrada</th><th>Status</th>
  </tr>`;

  linhas.forEach(row => {
    const cols = Array.from(row.children).slice(1, 7).map(col => col.innerText.replace(/\n/g, ' ').trim());
    table += `<tr><td>${cols.join("</td><td>")}</td></tr>`;
  });

  table += "</table>";

  const blob = new Blob([table], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "jogos.xls";
  link.click();
}

function exportarExcel() {
  const rows = [];
  const checkboxes = document.querySelectorAll(".jogoSelecionado:checked");

  checkboxes.forEach(cb => {
    const tr = cb.closest("tr");
    const cols = [...tr.children].map(td => td.innerText);
    rows.push(cols.slice(1));
  });

  if (rows.length === 0) return alert("Selecione pelo menos um jogo.");

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Casa", "Visitante", "Início", "Fim", "Entrada", "Status"],
    ...rows
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "RelatorioJogos");
  XLSX.writeFile(wb, "relatorio_jogos.xlsx");
}

function exportarTabelaPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(12);
  doc.text("Relatório de Jogos Yellup", 14, 20);

  const rows = [];
  const checkboxes = document.querySelectorAll(".jogoSelecionado:checked");

  checkboxes.forEach(cb => {
    const tr = cb.closest("tr");
    const cols = [...tr.children].map(td => td.innerText);
    rows.push(cols.slice(1));
  });

  if (rows.length === 0) return alert("Selecione pelo menos um jogo.");

  doc.autoTable({
    head: [["Casa", "Visitante", "Início", "Fim", "Entrada", "Status"]],
    body: rows,
    startY: 30,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [41, 128, 185] }
  });

  doc.save("relatorio_jogos.pdf");
}
