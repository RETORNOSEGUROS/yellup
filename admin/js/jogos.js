// jogos.js atualizado com:
// - Filtro por data exata (00:00 até 23:59)
// - Exportação com nomes dos times
// - Valor total dos patrocinadores
// - Correção de jsPDF
// - Bandeiras funcionais

let jogoEditandoId = null;
let todosJogosCarregados = [];

function formatarDataCompleta(data) {
  return new Date(data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatarReais(valor) {
  return `R$ ${parseFloat(valor).toFixed(2).replace('.', ',')}`;
}

function formatarHoraBrasil(data) {
  return new Date(data).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
}

async function listarJogos() {
  const lista = document.getElementById("listaJogos");
  lista.innerHTML = "";

  const filtroStatus = document.getElementById("filtroStatus").value;
  const filtroInicio = document.getElementById("filtroDataInicio").value;
  const filtroFim = document.getElementById("filtroDataFim").value;
  const filtroTime = document.getElementById("filtroTime").value;

  const snapshot = await db.collection("jogos").orderBy("dataInicio", "desc").get();

  todosJogosCarregados = [];
  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const id = doc.id;
    const dataInicio = new Date(jogo.dataInicio?.seconds ? jogo.dataInicio.seconds * 1000 : jogo.dataInicio);
    const dataFim = new Date(jogo.dataFim?.seconds ? jogo.dataFim.seconds * 1000 : jogo.dataFim);

    // Filtro por data exata
    if (filtroInicio) {
      const inicioFiltro = new Date(filtroInicio);
      inicioFiltro.setHours(0, 0, 0, 0);
      if (dataInicio < inicioFiltro) continue;
    }
    if (filtroFim) {
      const fimFiltro = new Date(filtroFim);
      fimFiltro.setHours(23, 59, 59, 999);
      if (dataInicio > fimFiltro) continue;
    }
    if (filtroStatus && filtroStatus !== jogo.status) continue;
    if (filtroTime && filtroTime !== jogo.timeCasaId && filtroTime !== jogo.timeForaId) continue;

    const timeCasaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
    const timeForaDoc = await db.collection("times").doc(jogo.timeForaId).get();
    const timeCasa = timeCasaDoc.exists ? timeCasaDoc.data() : {};
    const timeFora = timeForaDoc.exists ? timeForaDoc.data() : {};

    const patrocinadores = jogo.patrocinadores || [];
    const totalPatrocinio = patrocinadores.reduce((acc, cur) => acc + (parseFloat(cur.valor || 0) || 0), 0);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="select-jogo" data-id="${id}"></td>
      <td><img src="${timeCasa.bandeira || '#'}" width="20"> ${timeCasa.nome || '-'} - ${timeCasa.pais || ''}</td>
      <td><img src="${timeFora.bandeira || '#'}" width="20"> ${timeFora.nome || '-'} - ${timeFora.pais || ''}</td>
      <td>${formatarDataCompleta(dataInicio)}</td>
      <td>${formatarDataCompleta(dataFim)}</td>
      <td>${jogo.valorEntrada} créditos</td>
      <td>${jogo.status}</td>
      <td>💰 ${formatarReais(totalPatrocinio)}</td>
      <td>
        <button onclick="editarJogo('${id}')">Editar</button>
        <button onclick="excluirJogo('${id}')" style="color:red">Excluir</button>
      </td>
    `;
    lista.appendChild(row);
    todosJogosCarregados.push({ id, jogo, timeCasa, timeFora, totalPatrocinio });
  }
}

function exportarSelecionados(tipo) {
  const selecionados = Array.from(document.querySelectorAll(".select-jogo:checked"))
    .map(el => todosJogosCarregados.find(j => j.id === el.dataset.id))
    .filter(Boolean);

  if (selecionados.length === 0) {
    alert("Selecione ao menos 1 jogo para exportar");
    return;
  }

  const header = ["Time Casa", "Time Visitante", "Início", "Fim", "Entrada", "Status", "Patrocínio"];
  const dados = selecionados.map(j => [
    `${j.timeCasa.nome} - ${j.timeCasa.pais}`,
    `${j.timeFora.nome} - ${j.timeFora.pais}`,
    formatarDataCompleta(j.jogo.dataInicio),
    formatarDataCompleta(j.jogo.dataFim),
    j.jogo.valorEntrada + " créditos",
    j.jogo.status,
    formatarReais(j.totalPatrocinio)
  ]);

  if (tipo === 'csv') {
    let csv = header.join(";") + "\n";
    dados.forEach(l => csv += l.join(";") + "\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jogos.csv";
    a.click();
  } else if (tipo === 'pdf') {
    const doc = new jspdf.jsPDF();
    doc.text("Relatório de Jogos", 14, 10);
    doc.autoTable({ head: [header], body: dados });
    doc.save("jogos.pdf");
  } else if (tipo === 'excel') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...dados]);
    XLSX.utils.book_append_sheet(wb, ws, "Jogos");
    XLSX.writeFile(wb, "jogos.xlsx");
  }
}

window.onload = () => {
  listarJogos();

  document.getElementById("btnExportarCSV")?.addEventListener("click", () => exportarSelecionados('csv'));
  document.getElementById("btnExportarPDF")?.addEventListener("click", () => exportarSelecionados('pdf'));
  document.getElementById("btnExportarXLSX")?.addEventListener("click", () => exportarSelecionados('excel'));
  document.getElementById("btnAdicionarPatrocinador")?.addEventListener("click", () => alert("Função de patrocinador ativada"));
  document.getElementById("filtrarBtn")?.addEventListener("click", listarJogos);
};
