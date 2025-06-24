// Referência ao Firestore


async function carregarFiltros() {
  const selectTime = document.getElementById("filtroTime");
  const selectIndicador = document.getElementById("filtroIndicador");

  // Buscar Times
  selectTime.innerHTML = '<option value="">Todos</option>';
  const timesSnap = await db.collection("times").orderBy("nome").get();
  timesSnap.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().nome;
    selectTime.appendChild(opt);
  });

  // Buscar Indicadores
  selectIndicador.innerHTML = '<option value="">Todos</option>';
  const indicadoresSnap = await db.collection("usuarios").where("status", "==", "ativo").get();
  indicadoresSnap.forEach(doc => {
    const opt = document.createElement("option");
    opt.value = doc.id;
    opt.textContent = doc.data().nome;
    selectIndicador.appendChild(opt);
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

async function buscarUsuarios() {
  const status = document.getElementById("filtroStatus").value;
  const timeId = document.getElementById("filtroTime").value;
  const indicador = document.getElementById("filtroIndicador").value;
  const idadeMin = parseInt(document.getElementById("filtroIdadeMin")?.value || 0);
  const idadeMax = parseInt(document.getElementById("filtroIdadeMax")?.value || 200);
  const dataInicio = document.getElementById("filtroDataInicio").value;
  const dataFim = document.getElementById("filtroDataFim").value;

  const tabela = document.getElementById("tabelaUsuarios");
  tabela.innerHTML = "";

  const snap = await db.collection("usuarios").get();

  for (const doc of snap.docs) {
    const user = doc.data();

    const idade = calcularIdade(user.dataNascimento);
    const cadastro = user.dataCadastro?.toDate?.() || null;

    // Aplicar filtros
    if (status && user.status !== status) continue;
    if (timeId && user.timeId !== timeId) continue;
    if (indicador && user.indicadoPor !== indicador) continue;
    if (idade && (idade < idadeMin || idade > idadeMax)) continue;
    if (dataInicio && (!cadastro || cadastro < new Date(dataInicio))) continue;
    if (dataFim && (!cadastro || cadastro > new Date(dataFim))) continue;

    // Obter nome do time
    let timeNome = "-";
    if (user.timeId) {
      const timeDoc = await db.collection("times").doc(user.timeId).get();
      if (timeDoc.exists) timeNome = timeDoc.data().nome;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${user.nome}</td>
      <td>${user.usuario || "-"}</td>
      <td>${user.status}</td>
      <td>${timeNome}</td>
      <td>${idade || "-"}</td>
      <td>${user.creditos || 0}</td>
      <td>${formatarData(user.dataCadastro)}</td>
      <td>${user.indicadoPor || "-"}</td>
    `;
    tabela.appendChild(tr);
  }
}

// TODO FUTURO:
// - Exportar Excel
// - Gerar PDF com totalizador e listagem
// - Adicionar filtros: país, cidade (com normalização), último login, créditos comprados/gastos

window.onload = carregarFiltros;
