let jogoEditandoId = null;
let todosJogosCarregados = [];

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
  alert("Função de patrocinador ativada — implemente aqui seu modal ou upload.");
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
