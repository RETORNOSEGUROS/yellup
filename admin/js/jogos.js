// jogos.js atualizado com filtros, exportação selecionada, e suporte Excel
// BASE: jogos (9).js ajustado

let jogoEditandoId = null;
let todosJogosCarregados = [];

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
  const filtroFim = document.getElementById("filtroDataFim").value;
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

    const dataStr = dataInicio.toDateString();

    if (filtroStatus && filtroStatus !== statusAtualizado) continue;
    if (filtroInicio && new Date(filtroInicio).toDateString() > dataStr) continue;
    if (filtroFim && new Date(filtroFim).toDateString() < dataStr) continue;
    if (filtroTime && filtroTime !== jogo.timeCasaId && filtroTime !== jogo.timeForaId) continue;

    jogosFiltrados.push({ id: doc.id, jogo, status: statusAtualizado });
  }

  todosJogosCarregados = jogosFiltrados;

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

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="select-jogo" data-id="${id}"></td>
      <td>${timeCasaNome}</td>
      <td>${timeForaNome}</td>
      <td>${formatarData(jogo.dataInicio)}</td>
      <td>${formatarData(jogo.dataFim)}</td>
      <td>${jogo.valorEntrada} créditos</td>
      <td>${status}</td>
      <td>
        <button onclick="editarJogo('${id}')">Editar</button>
        <button onclick="excluirJogo('${id}')" style="color:red">Excluir</button>
      </td>
    `;
    lista.appendChild(row);
  }
}

function exportarSelecionados(tipo) {
  const selecionados = [...document.querySelectorAll(".select-jogo:checked")].map(el => el.dataset.id);
  const jogos = todosJogosCarregados.filter(j => selecionados.includes(j.id));
  if (!jogos.length) return alert("Nenhum jogo selecionado");

  const dados = jogos.map(({ jogo, status }) => [
    jogo.timeCasaId,
    jogo.timeForaId,
    formatarData(jogo.dataInicio),
    formatarData(jogo.dataFim),
    jogo.valorEntrada + " créditos",
    status
  ]);
  const cabecalho = ["Time Casa", "Time Visitante", "Início", "Fim", "Entrada", "Status"];

  if (tipo === "csv") {
    let csv = cabecalho.join(",") + "\n" + dados.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jogos.csv";
    a.click();
  }

  if (tipo === "excel") {
    import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs").then(XLSX => {
      const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...dados]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Jogos");
      XLSX.writeFile(wb, "jogos.xlsx");
    });
  }

  if (tipo === "pdf") {
    import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js").then(jsPDFModule => {
      const { jsPDF } = jsPDFModule;
      import("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js").then(() => {
        const doc = new jsPDF();
        doc.autoTable({ head: [cabecalho], body: dados });
        doc.save("jogos.pdf");
      });
    });
  }
}

window.onload = () => {
  carregarTimes();
  listarJogos();
  document.getElementById("btnExportarCSV").onclick = () => exportarSelecionados("csv");
  document.getElementById("btnExportarPDF").onclick = () => exportarSelecionados("pdf");
  document.getElementById("btnExportarXLSX").onclick = () => exportarSelecionados("excel");
};
