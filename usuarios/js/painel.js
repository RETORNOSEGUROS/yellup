/* painel.js – moderno: Hoje/Amanhã/Ontem, cabeçalho com cores, minibarra de torcida
   mantém auth, leitura de usuario/times/torcer e leitura de pontuacao de usuarios.pontuacao
*/

// Auth + dados do usuário
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const uid = user.uid;
  const doc = await db.collection("usuarios").doc(uid).get();

  if (!doc.exists) {
    alert("Usuário não encontrado.");
    return;
  }

  const dados = doc.data();

  // Nome, créditos, pontuação
  document.getElementById("nomeUsuario")?.innerText = dados.nome || "Usuário";
  document.getElementById("creditos").innerText = dados.creditos || 0;
  document.getElementById("pontuacao").innerText = dados.pontuacao || 0; // vem do doc do usuário

  // Time do coração + paleta dinâmica
  if (dados.timeId) {
    try {
      const timeRef = await db.collection("times").doc(dados.timeId).get();
      if (timeRef.exists) {
        const timeData = timeRef.data();
        document.getElementById("timeCoracao").innerText = timeData.nome;
        document.documentElement.style.setProperty('--cor-primaria',  timeData.corPrimaria  || '#004aad');
        document.documentElement.style.setProperty('--cor-secundaria', timeData.corSecundaria || '#007bff');
        document.documentElement.style.setProperty('--cor-terciaria',  timeData.corTerciaria  || '#d9ecff');
      } else {
        document.getElementById("timeCoracao").innerText = "Desconhecido";
      }
    } catch (e) {
      document.getElementById("timeCoracao").innerText = "Erro";
    }
  } else {
    document.getElementById("timeCoracao").innerText = "---";
  }

  // Link de indicação
  const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;
  document.getElementById("linkConvite").value = link;

  // Inicializa as listas por período
  await inicializarListas();

  // Ajuste opcional de cor de fundo
  setTimeout(() => {
    const corFinal = getComputedStyle(document.documentElement).getPropertyValue('--cor-terciaria');
    if (corFinal) document.body.style.backgroundColor = corFinal;
  }, 200);
});

// Copiar link
function copiarLink() {
  const input = document.getElementById("linkConvite");
  input.select();
  document.execCommand("copy");
  alert("Link copiado!");
}

/* ========= Util e carregadores por período ========= */
function getRange(periodo){
  // define meia-noite e 23:59:59 do fuso local
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);

  if (periodo === 'amanha'){ start.setDate(start.getDate()+1); end.setDate(end.getDate()+1); }
  if (periodo === 'ontem'){  start.setDate(start.getDate()-1); end.setDate(end.getDate()-1); }

  return { start, end };
}

async function queryJogosPorData(start, end){
  // tenta com orderBy (ideal); se Firestore pedir índice, cai no fallback
  try{
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end)
      .orderBy("dataInicio", "asc")
      .get();
  }catch(err){
    // fallback sem orderBy (funciona sem índice; ordenamos no cliente)
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end)
      .get();
  }
}

async function carregarJogosPeriodo(periodo, containerId){
  const { start, end } = getRange(periodo);
  const snap = await queryJogosPorData(start, end);

  const el = document.getElementById(containerId);
  if (!el) return;

  if (snap.empty){
    el.innerHTML = `<p class="text-white-50">Sem partidas ${periodo === 'ontem' ? 'ontem' : periodo === 'amanha' ? 'amanhã' : periodo}.</p>`;
    return;
  }

  const user = auth.currentUser;
  const uDoc = await db.collection("usuarios").doc(user.uid).get();
  const dadosUser = uDoc.data() || {};
  const torcidasUser = dadosUser.torcidas || {};

  // se vier sem orderBy, ordena no cliente
  const docs = snap.docs.sort((a,b)=>{
    const ta = a.data().dataInicio?.toDate()?.getTime() ?? 0;
    const tb = b.data().dataInicio?.toDate()?.getTime() ?? 0;
    return ta - tb;
  });

  el.innerHTML = "";

  for (const d of docs){
    const jogo = d.data(); const jogoId = d.id;

    // times + cores
    const casaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
    const foraDoc = await db.collection("times").doc(jogo.timeForaId).get();
    const nomeCasa = casaDoc.exists ? casaDoc.data().nome : "Time A";
    const nomeFora = foraDoc.exists ? foraDoc.data().nome : "Time B";
    const corCasa  = casaDoc.exists ? (casaDoc.data().corPrimaria || '#2ecc71') : '#2ecc71';
    const corFora  = foraDoc.exists ? (foraDoc.data().corPrimaria || '#e74c3c') : '#e74c3c';

    const hora = jogo.dataInicio.toDate().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const status = (jogo.status || 'indefinido').replace('_',' ').toUpperCase();

    // contagem de torcedores por time
    let torcidaCasa = 0, torcidaFora = 0;
    try{
      const tSnap = await db.collection("torcidas").where("jogoId","==",jogoId).get();
      tSnap.forEach(doc => {
        const t = doc.data();
        if (t.timeId === jogo.timeCasaId) torcidaCasa++;
        else if (t.timeId === jogo.timeForaId) torcidaFora++;
      });
    }catch(_){}

    const totalTorc = Math.max(1, torcidaCasa + torcidaFora); // evita dividir por 0
    const pctCasa = Math.round((torcidaCasa / totalTorc) * 100);
    const pctFora = 100 - pctCasa;

    const jaTorcendo = Boolean(torcidasUser[jogoId]);

    const col = document.createElement('div'); col.className = "col-12 col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="yl-match h-100">
        <!-- Cabeçalho: times lado a lado com cor -->
        <div class="yl-match-header">
          <div class="yl-team-side">
            <span class="yl-dot" style="background:${corCasa}"></span>
            <span>${nomeCasa}</span>
          </div>
          <div class="yl-meta">
            ${jogo.status === 'ao_vivo' ? `<span class="yl-badge yl-live">LIVE</span>` : ''}
            <span class="yl-badge">${hora}</span>
          </div>
          <div class="yl-team-side">
            <span class="yl-dot" style="background:${corFora}"></span>
            <span>${nomeFora}</span>
          </div>
        </div>

        <!-- Minibarra de torcida -->
        <div class="yl-torc">
          <div class="yl-torc-bar" title="Torcida: ${nomeCasa} ${torcidaCasa} x ${torcidaFora} ${nomeFora}">
            <div class="yl-torc-home" style="width:${pctCasa}%; background:${corCasa}"></div>
            <div class="yl-torc-away" style="width:${pctFora}%; background:${corFora}"></div>
          </div>
        </div>

        <!-- Ações -->
        <div class="yl-actions">
          ${
            jaTorcendo
              ? `<a class="yl-btn yl-btn-outline" href="painel-jogo.html?id=${jogoId}">Acessar Partida</a>`
              : `
                <button class="yl-btn yl-btn-primary" onclick="torcer('${jogoId}','${jogo.timeCasaId}')">Torcer ${nomeCasa}</button>
                <button class="yl-btn yl-btn-outline"  onclick="torcer('${jogoId}','${jogo.timeForaId}')">Torcer ${nomeFora}</button>
              `
          }
        </div>
      </div>
    `;
    el.appendChild(col);
  }
}

async function inicializarListas(){
  await carregarJogosPeriodo('hoje',   'listaHoje');
  await carregarJogosPeriodo('amanha', 'listaAmanha');
  await carregarJogosPeriodo('ontem',  'listaOntem');
}

/* ========= Torcer ========= */
async function torcer(jogoId, timeEscolhidoId) {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = db.collection("usuarios").doc(user.uid);
  const doc = await userRef.get();
  const dados = doc.data();

  if (dados.torcidas && dados.torcidas[jogoId]) {
    alert("Você já escolheu seu time para este jogo.");
    return;
  }

  if ((dados.creditos || 0) < 1) {
    alert("Você não tem créditos suficientes para torcer.");
    return;
  }

  await userRef.update({
    creditos: (dados.creditos || 0) - 1,
    [`torcidas.${jogoId}`]: timeEscolhidoId
  });

  window.location.href = `painel-jogo.html?id=${jogoId}`;
}
