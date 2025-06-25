// AJUSTES SOLICITADOS PARA jogos.js COMPLETO

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

    if (filtroStatus && filtroStatus !== statusAtualizado) continue;
    if (filtroInicio && new Date(filtroInicio) > dataInicio) continue;
    if (filtroFim && new Date(filtroFim) < dataFim) continue;
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

    const linha = document.createElement("tr");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("jogo-checkbox");
    checkbox.dataset.export = JSON.stringify({
      casa: timeCasaNome,
      visitante: timeForaNome,
      inicio: formatarData(jogo.dataInicio),
      fim: formatarData(jogo.dataFim),
      entrada: jogo.valorEntrada + " créditos",
      status
    });
    const tdCheck = document.createElement("td");
    tdCheck.appendChild(checkbox);
    linha.appendChild(tdCheck);

    linha.innerHTML += `
      <td>${coresCasa} ${timeCasaNome}</td>
      <td>${coresFora} ${timeForaNome}</td>
      <td>${formatarData(jogo.dataInicio)}</td>
      <td>${formatarData(jogo.dataFim)}</td>
      <td>${jogo.valorEntrada} créditos</td>
      <td>${status}</td>
      <td>
        <button onclick="editarJogo('${id}')">Editar</button>
        <button onclick="excluirJogo('${id}')" style="margin-top:4px;color:red">Excluir</button>
      </td>`;

    lista.appendChild(linha);
  }
}

function selecionarTodos(master) {
  document.querySelectorAll(".jogo-checkbox").forEach(cb => cb.checked = master.checked);
}

function exportarSelecionadosCSV() {
  const selecionados = Array.from(document.querySelectorAll(".jogo-checkbox:checked"));
  if (selecionados.length === 0) return alert("Nenhum jogo selecionado.");

  let csv = "Casa,Visitante,Início,Fim,Entrada,Status\n";
  selecionados.forEach(cb => {
    const data = JSON.parse(cb.dataset.export);
    csv += `${data.casa},${data.visitante},${data.inicio},${data.fim},${data.entrada},${data.status}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "jogos.csv";
  link.click();
}

function exportarSelecionadosPDF() {
  const selecionados = Array.from(document.querySelectorAll(".jogo-checkbox:checked"));
  if (selecionados.length === 0) return alert("Nenhum jogo selecionado.");

  import("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js").then(jsPDFModule => {
    const { jsPDF } = jsPDFModule;
    const doc = new jsPDF();
    let y = 10;
    doc.text("Jogos Selecionados", 10, y);
    y += 10;
    selecionados.forEach(cb => {
      const data = JSON.parse(cb.dataset.export);
      doc.text(`${data.casa} x ${data.visitante} | ${data.inicio} - ${data.fim} | ${data.entrada} | ${data.status}`, 10, y);
      y += 10;
    });
    doc.save("jogos.pdf");
  });
}

function exportarSelecionadosExcel() {
  const selecionados = Array.from(document.querySelectorAll(".jogo-checkbox:checked"));
  if (selecionados.length === 0) return alert("Nenhum jogo selecionado.");

  const dados = selecionados.map(cb => JSON.parse(cb.dataset.export));
  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Jogos");
  XLSX.writeFile(wb, "jogos.xlsx");
}

window.onload = () => {
  carregarTimes();
  listarJogos();
  document.getElementById("btnAdicionarPatrocinador").onclick = adicionarPatrocinador;
  document.getElementById("salvarJogo").onclick = salvarJogo;
  document.getElementById("btnExportarCSV").onclick = exportarSelecionadosCSV;
  document.getElementById("btnExportarPDF").onclick = exportarSelecionadosPDF;
  document.getElementById("btnExportarExcel").onclick = exportarSelecionadosExcel;
};
