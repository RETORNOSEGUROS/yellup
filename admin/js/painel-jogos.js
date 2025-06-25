
let jogoEditandoId = null;

async function carregarTimes() {
  const timesRef = await db.collection("times").orderBy("nome").get();
  const selects = [document.getElementById("filtroTime")];
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

function definirStatus(dataInicio, dataFim) {
  const agora = new Date();
  if (agora < dataInicio) return "agendado";
  if (agora >= dataInicio && agora <= dataFim) return "ao_vivo";
  return "finalizado";
}

async function listarJogos() {
  const lista = document.getElementById("tabela-jogos");
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

    if (filtroInicio && filtroFim) {
      const inicioFiltro = new Date(filtroInicio);
      const fimFiltro = new Date(filtroFim);
      inicioFiltro.setHours(0, 0, 0, 0);
      fimFiltro.setHours(23, 59, 59, 999);
      if (dataFim < inicioFiltro || dataInicio > fimFiltro) continue;
    } else if (filtroInicio) {
      const inicioFiltro = new Date(filtroInicio);
      const fimFiltro = new Date(filtroInicio);
      inicioFiltro.setHours(0, 0, 0, 0);
      fimFiltro.setHours(23, 59, 59, 999);
      if (dataFim < inicioFiltro || dataInicio > fimFiltro) continue;
    }

    if (filtroTime && filtroTime !== jogo.timeCasaId && filtroTime !== jogo.timeForaId) continue;

    jogosFiltrados.push({ id: doc.id, jogo, status: statusAtualizado });
  }

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
        <td>${coresCasa} ${timeCasaNome}</td>
        <td>${coresFora} ${timeForaNome}</td>
        <td>${formatarData(jogo.dataInicio)}</td>
        <td>${formatarData(jogo.dataFim)}</td>
        <td>${jogo.valorEntrada} créditos</td>
        <td>${status}</td>
        <td>
          <a class="btn" href="painel-jogo.html?id=${id}" target="_blank">Ver</a>
        </td>
      </tr>`;
  }
}

function exportarTabelaCSV() {
  let csv = "Casa,Visitante,Início,Fim,Entrada,Status\n";
  document.querySelectorAll("#tabela-jogos tr").forEach(row => {
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
    document.querySelectorAll("#tabela-jogos tr").forEach(row => {
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
};
