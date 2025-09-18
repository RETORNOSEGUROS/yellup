/* painel.js – lógica do painel do usuário
   Mantém: auth, leitura de usuario/times/jogos, torcer, etc.
   Adiciona: listas por período (hoje/amanhã/ontem/semana)
   Requer: firebase-init.js deve expor auth e db
*/

// Autenticação e carregamento inicial
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
  document.getElementById("pontuacao").innerText = dados.pontuacao || 0;

  // Time do coração + paleta
  if (dados.timeId) {
    try {
      const timeRef = await db.collection("times").doc(dados.timeId).get();
      if (timeRef.exists) {
        const timeData = timeRef.data();
        document.getElementById("timeCoracao").innerText = timeData.nome;
        document.documentElement.style.setProperty('--cor-primaria', timeData.corPrimaria || '#004aad');
        document.documentElement.style.setProperty('--cor-secundaria', timeData.corSecundaria || '#007bff');
        document.documentElement.style.setProperty('--cor-terciaria', timeData.corTerciaria || '#d9ecff');
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

  // Ajuste opcional de cor de fundo a partir da cor terciária (mantém seu comportamento)
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

/* ===================== NOVO: util e carregadores por período ===================== */
function getRange(periodo){
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);

  if (periodo === 'amanha'){ start.setDate(start.getDate()+1); end.setDate(end.getDate()+1); }
  if (periodo === 'ontem'){  start.setDate(start.getDate()-1); end.setDate(end.getDate()-1); }
  if (periodo === 'semana'){
    // Segunda a domingo da semana corrente
    const day = start.getDay(); // 0=dom
    const diffToMon = (day === 0 ? -6 : 1 - day);
    start.setDate(start.getDate() + diffToMon);
    start.setHours(0,0,0,0);
    end.setTime(start.getTime());
    end.setDate(end.getDate()+6);
    end.setHours(23,59,59,999);
  }
  return { start, end };
}

async function carregarJogosPeriodo(periodo, containerId){
  const { start, end } = getRange(periodo);

  const snap = await db.collection("jogos")
    .where("dataInicio", ">=", start)
    .where("dataInicio", "<=", end)
    .orderBy("dataInicio", "asc")
    .get();

  const el = document.getElementById(containerId);
  if (!el) return;

  if (snap.empty){
    el.innerHTML = `<p class="text-white-50">Sem partidas ${periodo === 'ontem' ? 'ontem' : periodo === 'amanha' ? 'amanhã' : periodo}.</p>`;
    return;
  }

  const user = auth.currentUser;
  const uDoc = await db.collection("usuarios").doc(user.uid).get();
  const dados = uDoc.data() || {};
  const torcidas = dados.torcidas || {};

  el.innerHTML = "";

  for (const d of snap.docs){
    const jogo = d.data(); const jogoId = d.id;

    const casaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
    const foraDoc = await db.collection("times").doc(jogo.timeForaId).get();
    const nomeCasa = casaDoc.exists ? casaDoc.data().nome : "Time A";
    const nomeFora = foraDoc.exists ? foraDoc.data().nome : "Time B";

    const hora = jogo.dataInicio.toDate().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    const status = (jogo.status || 'indefinido').replace('_',' ').toUpperCase();

    // contador de torcedores (coleção opcional "torcidas": { jogoId, uid, timeId })
    let torcidaCount = 0;
    try{
      const tSnap = await db.collection("torcidas").where("jogoId","==",jogoId).get();
      torcidaCount = tSnap.size;
    }catch(_){ /* se não existir, fica 0 sem quebrar */ }

    const torcidaId = torcidas[jogoId];
    const jaTorcendo = Boolean(torcidaId);

    const col = document.createElement('div'); col.className = "col-12 col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="yl-match h-100">
        <div class="yl-league">${jogo.liga || ''}</div>

        <div class="yl-row">
          <div class="yl-teams">
            <div class="yl-team"><span class="yl-badge">${jogo.golsCasa ?? '-'}</span> ${nomeCasa}</div>
            <div class="yl-team"><span class="yl-badge">${jogo.golsFora ?? '-'}</span> ${nomeFora}</div>
          </div>

          <div class="yl-meta">
            ${jogo.status === 'ao_vivo' ? `<span class="yl-badge yl-live">LIVE</span>` : ''}
            <span class="yl-badge">${hora}</span>
            <span class="yl-badge yl-hot" title="Torcedores na partida">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 6 4 4 6.5 4 8.04 4 9.54 4.81 10.35 6.09 11.16 4.81 12.66 4 14.2 4 16.7 4 18.7 6 18.7 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              ${torcidaCount}
            </span>
            <span class="yl-badge">${status}</span>
          </div>
        </div>

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
  await carregarJogosPeriodo('semana', 'listaSemana');
}

/* ===================== Funções já existentes ===================== */
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
