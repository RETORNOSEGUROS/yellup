// jogos.js atualizado - com filtros, exportações e patrocinadores funcionando
let jogoEditandoId = null;
let todosJogosCarregados = [];
let patrocinadores = [];

async function carregarTimes() {
  const timesRef = await db.collection("times").orderBy("nome").get();
  const selects = ["timeCasa", "timeVisitante", "filtroTime"];
  selects.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">Selecione o Time</option>';
    timesRef.forEach(doc => {
      const data = doc.data();
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = `${data.nome} - ${data.pais || ''}`;
      select.appendChild(opt);
    });
  });
}

function formatarData(timestamp) {
  if (typeof timestamp?.toDate === "function") {
    return timestamp.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  return new Date(timestamp).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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
  const hojeStr = new Date().toDateString();
  let jogosFiltrados = [];

  for (const doc of snapshot.docs) {
    const jogo = doc.data();
    const dataInicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio);
    const dataFim = jogo.dataFim?.toDate?.() || new Date(jogo.dataFim);
    const statusAtualizado = definirStatus(dataInicio, dataFim);

    if (jogo.status !== statusAtualizado) {
      await db.collection("jogos").doc(doc.id).update({ status: statusAtualizado });
    }

    const dataStr = dataInicio.toDateString();

    const incluiPorFiltro = (
      (!filtroStatus || filtroStatus === statusAtualizado) &&
      (!filtroTime || filtroTime === jogo.timeCasaId || filtroTime === jogo.timeForaId) &&
      (!filtroInicio || new Date(filtroInicio).toDateString() <= dataStr) &&
      (!filtroFim || new Date(filtroFim).toDateString() >= dataStr)
    );

    const hojeSemFiltro = !filtroStatus && !filtroTime && !filtroInicio && !filtroFim && dataStr === hojeStr;

    if (incluiPorFiltro || hojeSemFiltro) {
      jogosFiltrados.push({ id: doc.id, jogo, status: statusAtualizado });
    }
  }

  if (!filtroStatus && !filtroTime && !filtroInicio && !filtroFim && jogosFiltrados.length === 0) {
    jogosFiltrados = snapshot.docs.slice(0, 10).map(doc => {
      const jogo = doc.data();
      const dataInicio = jogo.dataInicio?.toDate?.() || new Date(jogo.dataInicio);
      const dataFim = jogo.dataFim?.toDate?.() || new Date(jogo.dataFim);
      const status = definirStatus(dataInicio, dataFim);
      return { id: doc.id, jogo, status };
    });
  }

  todosJogosCarregados = jogosFiltrados;

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
      <td><img src="${timeCasa.bandeira || '#'}" alt="" width="20"> ${timeCasaNome}</td>
      <td><img src="${timeFora.bandeira || '#'}" alt="" width="20"> ${timeForaNome}</td>
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

function adicionarPatrocinador() {
  const container = document.getElementById("patrocinadoresContainer");
  const div = document.createElement("div");
  div.className = "patrocinador-item";
  div.innerHTML = `
    <input type="text" placeholder="Nome" class="pat-nome">
    <input type="number" placeholder="Valor em R$" class="pat-valor">
    <input type="text" placeholder="Site" class="pat-site">
    <input type="file" class="pat-logo" accept="image/*">
    <div class="preview"></div>
  `;
  div.querySelector(".pat-logo").addEventListener("change", e => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = ev => {
      div.querySelector(".preview").innerHTML = `<img src="${ev.target.result}" height="40">`;
      div.dataset.logoBase64 = ev.target.result;
    };
    if (file) reader.readAsDataURL(file);
  });
  container.appendChild(div);
}

window.onload = () => {
  carregarTimes();
  listarJogos();

  document.getElementById("btnAdicionarPatrocinador")?.addEventListener("click", adicionarPatrocinador);
  document.getElementById("salvarJogo")?.addEventListener("click", salvarJogo);
  document.getElementById("btnExportarCSV")?.addEventListener("click", () => exportarSelecionados('csv'));
  document.getElementById("btnExportarPDF")?.addEventListener("click", () => exportarSelecionados('pdf'));
  document.getElementById("btnExportarXLSX")?.addEventListener("click", () => exportarSelecionados('excel'));
}

function exportarSelecionados(formato) {
  const selecionados = Array.from(document.querySelectorAll(".select-jogo:checked"))
    .map(input => todosJogosCarregados.find(j => j.id === input.dataset.id))
    .filter(Boolean);

  if (!selecionados.length) {
    alert("Selecione ao menos 1 jogo para exportar.");
    return;
  }

  const cabecalho = ["Time Casa", "Time Visitante", "Início", "Fim", "Entrada", "Status"];
  const dados = selecionados.map(({ jogo, status }) => [
    jogo.timeCasaId,
    jogo.timeForaId,
    formatarData(jogo.dataInicio),
    formatarData(jogo.dataFim),
    jogo.valorEntrada,
    status
  ]);

  if (formato === 'csv') {
    let csv = cabecalho.join(";") + "\n";
    dados.forEach(row => csv += row.join(";") + "\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "jogos.csv";
    link.click();
  } else if (formato === 'pdf') {
    const doc = new jspdf.jsPDF();
    doc.text("Relatório de Jogos", 14, 10);
    doc.autoTable({ head: [cabecalho], body: dados });
    doc.save("jogos.pdf");
  } else if (formato === 'excel') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...dados]);
    XLSX.utils.book_append_sheet(wb, ws, "Jogos");
    XLSX.writeFile(wb, "jogos.xlsx");
  }
}
