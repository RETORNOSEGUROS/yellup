/* painel.js – robusto + moderno
   - Exibe dados do usuário (fallback de campos/ids)
   - Listas: Hoje, Amanhã, Ontem
   - Cabeçalho dos times lado a lado com cores
   - Minibarra de torcida (50/50 quando sem votos)
   - torcer(): atualiza usuário e grava em torcidas/{jogoId}_{uid}
   Requer: firebase compat + firebase-init.js expondo "auth" e "db"
*/

/* ========================= Util ========================= */

// Seta texto se o elemento existir
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Log padronizado
function logError(ctx, err) {
  console.error(`[PAINEL] ${ctx}:`, err);
}

/* =================== Auth + Dados Usuário =================== */

auth.onAuthStateChanged(async (user) => {
  try {
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

    const dados = doc.data() || {};

    // nome / créditos / pontuação (com fallback de nomes)
    const nome     = dados.nome || "Usuário";
    const creditos = (dados.creditos ?? dados.creditosDisponiveis ?? 0);
    const pontos   = (dados.pontuacao ?? dados.pontuacaoAcumulada ?? 0);

    setText("nomeUsuario", nome);
    setText("creditos", String(creditos));
    setText("pontuacao", String(pontos));

    // time do coração + paleta dinâmica
    if (dados.timeId) {
      try {
        const timeRef = await db.collection("times").doc(dados.timeId).get();
        if (timeRef.exists) {
          const t = timeRef.data() || {};
          setText("timeCoracao", t.nome || "—");
          document.documentElement.style.setProperty('--cor-primaria',  t.corPrimaria  || '#004aad');
          document.documentElement.style.setProperty('--cor-secundaria', t.corSecundaria || '#007bff');
          document.documentElement.style.setProperty('--cor-terciaria',  t.corTerciaria  || '#d9ecff');
        } else {
          setText("timeCoracao", "Desconhecido");
        }
      } catch (e) {
        setText("timeCoracao", "Erro");
        logError("Lendo time do coração", e);
      }
    } else {
      setText("timeCoracao", "—");
    }

    // link de convite
    const inviteEl = document.getElementById("linkConvite");
    if (inviteEl) inviteEl.value = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;

    // listas
    await inicializarListas();

    // toque opcional de cor de fundo
    setTimeout(() => {
      const corFinal = getComputedStyle(document.documentElement).getPropertyValue('--cor-terciaria');
      if (corFinal) document.body.style.backgroundColor = corFinal;
    }, 200);
  } catch (e) {
    logError("onAuthStateChanged", e);
  }
});

/* ========================= Copiar link ========================= */

function copiarLink() {
  try {
    const input = document.getElementById("linkConvite");
    if (!input) return alert("Campo de link não encontrado.");
    input.select();
    document.execCommand("copy");
    alert("Link copiado!");
  } catch (e) {
    logError("copiarLink", e);
  }
}

/* =================== Range / Query Firestore =================== */

function getRange(periodo){
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);
  if (periodo === 'amanha'){ start.setDate(start.getDate()+1); end.setDate(end.getDate()+1); }
  if (periodo === 'ontem'){  start.setDate(start.getDate()-1); end.setDate(end.getDate()-1); }
  return { start, end };
}

async function queryJogosPorData(start, end){
  try{
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end)
      .orderBy("dataInicio", "asc")
      .get();
  }catch(err){
    // fallback sem orderBy (evita índice obrigatório); ordenamos no cliente
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end)
      .get();
  }
}

/* ====================== Carregar Partidas ====================== */

async function carregarJogosPeriodo(periodo, containerId){
  try {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<p class="text-white-50">Carregando...</p>`;

    const { start, end } = getRange(periodo);
    const snap = await queryJogosPorData(start, end);

    if (snap.empty){
      el.innerHTML = `<p class="text-white-50">Sem partidas ${periodo === 'ontem' ? 'ontem' : periodo === 'amanha' ? 'amanhã' : periodo}.</p>`;
      return;
    }

    const user = auth.currentUser;
    const uDoc = await db.collection("usuarios").doc(user.uid).get();
    const dadosUser = uDoc.data() || {};
    const torcidasUser = dadosUser.torcidas || {};

    // ordenação local caso não venha com orderBy
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
      const nomeCasa = casaDoc.exists ? (casaDoc.data().nome || "Time A") : "Time A";
      const nomeFora = foraDoc.exists ? (foraDoc.data().nome || "Time B") : "Time B";
      const corCasa  = casaDoc.exists ? (casaDoc.data().corPrimaria || '#2ecc71') : '#2ecc71';
      const corFora  = foraDoc.exists ? (foraDoc.data().corPrimaria || '#e74c3c') : '#e74c3c';

      const hora = jogo.dataInicio.toDate().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      const status = (jogo.status || 'indefinido').replace('_',' ').toUpperCase();

      // contagem de torcedores por time a partir da coleção "torcidas"
      let torcidaCasa = 0, torcidaFora = 0;
      try{
        const tSnap = await db.collection("torcidas").where("jogoId","==",jogoId).get();
        tSnap.forEach(doc => {
          const t = doc.data();
          if (t.timeId === jogo.timeCasaId) torcidaCasa++;
          else if (t.timeId === jogo.timeForaId) torcidaFora++;
        });
      }catch(_){}

      // porcentagens (se não houver votos, 50/50 neutro)
      const totalTorc = torcidaCasa + torcidaFora;
      let pctCasa, pctFora;
      if (totalTorc === 0) { pctCasa = 50; pctFora = 50; }
      else {
        pctCasa = Math.round((torcidaCasa / totalTorc) * 100);
        pctFora = 100 - pctCasa;
      }

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
              <span class="yl-badge">${status}</span>
            </div>
            <div class="yl-team-side">
              <span class="yl-dot" style="background:${corFora}"></span>
              <span>${nomeFora}</span>
            </div>
          </div>

          <!-- Minibarra de torcida (home à esquerda, away à direita) -->
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
  } catch (e) {
    logError(`carregarJogosPeriodo(${periodo})`, e);
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<p class="text-danger">Erro ao carregar partidas.</p>`;
  }
}

async function inicializarListas(){
  await carregarJogosPeriodo('hoje',   'listaHoje');
  await carregarJogosPeriodo('amanha', 'listaAmanha');
  await carregarJogosPeriodo('ontem',  'listaOntem');
}

/* ========================= Torcer =========================
   - Atualiza créditos e mapa de torcidas no doc do usuário
   - Grava/atualiza doc em "torcidas/{jogoId}_{uid}" para contagem global
*/
async function torcer(jogoId, timeEscolhidoId) {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const userRef = db.collection("usuarios").doc(user.uid);
    const doc = await userRef.get();
    const dados = doc.data() || {};

    if (dados.torcidas && dados.torcidas[jogoId]) {
      alert("Você já escolheu seu time para este jogo.");
      return;
    }

    const creditosAtuais = (dados.creditos ?? dados.creditosDisponiveis ?? 0);
    if (creditosAtuais < 1) {
      alert("Você não tem créditos suficientes para torcer.");
      return;
    }

    // 1) Atualiza o doc do usuário
    await userRef.update({
      creditos: creditosAtuais - 1,
      [`torcidas.${jogoId}`]: timeEscolhidoId
    });

    // 2) Grava/atualiza a torcida agregada por jogo
    await db.collection("torcidas")
      .doc(`${jogoId}_${user.uid}`)
      .set({
        uid: user.uid,
        jogoId: jogoId,
        timeId: timeEscolhidoId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    window.location.href = `painel-jogo.html?id=${jogoId}`;
  } catch (e) {
    logError("torcer", e);
    alert("Não foi possível registrar sua torcida.");
  }
}
