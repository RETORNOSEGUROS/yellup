/* painel.js – UI PRO (fonts/tema) + fixes solicitados
   Requer: firebase compat + firebase-init.js expondo "auth" e "db"
*/

function setText(id, value){ const el = document.getElementById(id); if(el) el.textContent = value; }
function logError(ctx, err){ console.error(`[PAINEL] ${ctx}:`, err); }

/* =================== Auth + Dados Usuário =================== */
auth.onAuthStateChanged(async (user) => {
  try{
    if(!user){ window.location.href="index.html"; return; }

    const uid = user.uid;
    const doc = await db.collection("usuarios").doc(uid).get();
    if(!doc.exists){ alert("Usuário não encontrado."); return; }
    const dados = doc.data() || {};

    // nome / créditos
    const nome     = dados.nome || "Usuário";
    const creditos = (dados.creditos ?? dados.creditosDisponiveis ?? 0);

    // PONTUAÇÃO REAL (somar mapa 'pontuacoes')
    let pontos = 0;
    if (dados.pontuacoes && typeof dados.pontuacoes === 'object'){
      try{ pontos = Object.values(dados.pontuacoes).reduce((a,b)=>a+(Number(b)||0),0); }catch(_){}
    } else {
      pontos = (dados.pontuacao ?? dados.pontuacaoAcumulada ?? 0);
    }

    setText("nomeUsuario", nome);
    setText("creditos", String(creditos));
    setText("pontuacao", String(pontos));

    // Avatar no rodapé
    const avatar = (dados.avatarUrl && String(dados.avatarUrl).trim()) ? dados.avatarUrl : "/usuarios/img/avatar-fallback.png";
    const avatarImg = document.getElementById("avatarImg");
    if(avatarImg) avatarImg.src = avatar;

    // time do coração + paleta dinâmica
    if (dados.timeId){
      try{
        const timeRef = await db.collection("times").doc(dados.timeId).get();
        if(timeRef.exists){
          const t = timeRef.data() || {};
          setText("timeCoracao", t.nome || "—");
          document.documentElement.style.setProperty('--cor-primaria',  t.corPrimaria  || '#004aad');
          document.documentElement.style.setProperty('--cor-secundaria', t.corSecundaria || '#007bff');
          document.documentElement.style.setProperty('--cor-terciaria',  t.corTerciaria  || '#0f1720');
        } else setText("timeCoracao","—");
      }catch(e){ setText("timeCoracao","—"); logError("Lendo time do coração", e); }
    }else setText("timeCoracao","—");

    // Link de convite (usado pelo modal)
    const inviteEl = document.getElementById("linkConvite");
    if(inviteEl) inviteEl.value = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;

    // listas
    await inicializarListas();

  }catch(e){ logError("onAuthStateChanged", e); }
});

/* =================== Datas / Query =================== */
function getRange(periodo){
  const s = new Date(); s.setHours(0,0,0,0);
  const e = new Date(); e.setHours(23,59,59,999);
  if(periodo==='amanha'){ s.setDate(s.getDate()+1); e.setDate(e.getDate()+1); }
  if(periodo==='ontem'){  s.setDate(s.getDate()-1); e.setDate(e.getDate()-1); }
  return { start:s, end:e };
}

async function queryJogosPorData(start, end){
  try{
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end)
      .orderBy("dataInicio","asc")
      .get();
  }catch{
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end).get();
  }
}

/* ====================== Partidas ====================== */
function badgeStatus(jogo){
  const s = (jogo.status||'').toLowerCase();
  if (s === 'ao_vivo') return `<span class="yl-badge yl-live">LIVE</span>`;
  if (s === 'encerrado' || s === 'finalizado' || s === 'fim') return `<span class="yl-badge">ENCERRADO</span>`;
  return ''; // nada pra pré-jogo
}

function termoHTML(pct, cor){ // termômetro compacto ao lado do nome
  pct = Math.max(0, Math.min(100, Number(pct)||0));
  return `
    <span class="yl-thermo" title="${pct}%">
      <span class="yl-thermo-fill" style="width:${pct}%; background:${cor}"></span>
    </span>
  `;
}

async function carregarJogosPeriodo(periodo, containerId){
  try{
    const el = document.getElementById(containerId);
    if(!el) return;
    el.innerHTML = `<p class="text-white-50">Carregando...</p>`;

    const {start,end} = getRange(periodo);
    const snap = await queryJogosPorData(start,end);
    if(snap.empty){ el.innerHTML = `<p class="text-white-50">Sem partidas ${periodo==='ontem'?'ontem':periodo==='amanha'?'amanhã':'hoje'}.</p>`; return; }

    // torcidas do usuário (pra saber se já torceu)
    const uid = auth.currentUser?.uid;
    const uDoc = uid ? (await db.collection("usuarios").doc(uid).get()) : null;
    const torcidasUser = uDoc?.data()?.torcidas || {};

    const docs = snap.docs.sort((a,b)=>{
      const ta = a.data().dataInicio?.toDate()?.getTime() ?? 0;
      const tb = b.data().dataInicio?.toDate()?.getTime() ?? 0;
      return ta - tb;
    });

    el.innerHTML = "";
    for (const d of docs){
      const jogo = d.data(); const jogoId = d.id;

      // times
      const casaDoc = await db.collection("times").doc(jogo.timeCasaId).get();
      const foraDoc = await db.collection("times").doc(jogo.timeForaId).get();
      const nomeCasa = casaDoc.exists ? (casaDoc.data().nome || "Time A") : "Time A";
      const nomeFora = foraDoc.exists ? (foraDoc.data().nome || "Time B") : "Time B";
      const corCasa  = casaDoc.exists ? (casaDoc.data().corPrimaria || '#2ecc71') : '#2ecc71';
      const corFora  = foraDoc.exists ? (foraDoc.data().corPrimaria || '#e74c3c') : '#e74c3c';

      // data e hora
      const dt = jogo.dataInicio?.toDate ? jogo.dataInicio.toDate() : new Date();
      const dataTxt = dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      const horaTxt = dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

      // contagem de torcidas (para termômetro — sem barra grande)
      let torcidaCasa = 0, torcidaFora = 0;
      try{
        const tSnap = await db.collection("torcidas").where("jogoId","==",jogoId).get();
        tSnap.forEach(td=>{
          const t = td.data();
          if (t.timeId === jogo.timeCasaId) torcidaCasa++;
          else if (t.timeId === jogo.timeForaId) torcidaFora++;
        });
      }catch{}

      const total = torcidaCasa + torcidaFora;
      const pctCasa = total ? Math.round((torcidaCasa/total)*100) : 50;
      const pctFora = 100 - pctCasa;

      const jaTorcendo = Boolean(torcidasUser[jogoId]);

      const col = document.createElement('div'); col.className = "col-12 col-md-6 col-lg-4";
      col.innerHTML = `
        <div class="yl-match h-100">
          <div class="yl-match-header">
            <div class="yl-team-side">
              <span class="yl-dot" style="background:${corCasa}"></span>
              <span>${nomeCasa}</span>
              ${termoHTML(pctCasa, corCasa)}
            </div>
            <div class="yl-meta">
              ${badgeStatus(jogo)}
              <span class="yl-badge">${dataTxt} · ${horaTxt}</span>
            </div>
            <div class="yl-team-side" style="justify-content:flex-end">
              ${termoHTML(pctFora, corFora)}
              <span>${nomeFora}</span>
              <span class="yl-dot" style="background:${corFora}"></span>
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
  }catch(e){
    logError(`carregarJogosPeriodo(${periodo})`, e);
    const el = document.getElementById(containerId);
    if(el) el.innerHTML = `<p class="text-danger">Erro ao carregar partidas.</p>`;
  }
}

async function inicializarListas(){
  await carregarJogosPeriodo('hoje','listaHoje');
  await carregarJogosPeriodo('amanha','listaAmanha');
  await carregarJogosPeriodo('ontem','listaOntem');
}

/* ========================= Torcer ========================= */
async function torcer(jogoId, timeEscolhidoId){
  try{
    const user = auth.currentUser; if(!user) return;
    const userRef = db.collection("usuarios").doc(user.uid);
    const doc = await userRef.get(); const dados = doc.data() || {};

    if (dados.torcidas && dados.torcidas[jogoId]){ alert("Você já escolheu seu time para este jogo."); return; }

    const creditosAtuais = (dados.creditos ?? dados.creditosDisponiveis ?? 0);
    if (creditosAtuais < 1){ alert("Você não tem créditos suficientes para torcer."); return; }

    await userRef.update({
      creditos: creditosAtuais - 1,
      [`torcidas.${jogoId}`]: timeEscolhidoId
    });

    await db.collection("torcidas").doc(`${jogoId}_${user.uid}`).set({
      uid: user.uid, jogoId, timeId: timeEscolhidoId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    window.location.href = `painel-jogo.html?id=${jogoId}`;
  }catch(e){ logError("torcer", e); alert("Não foi possível registrar sua torcida."); }
}

window.torcer = torcer; // expõe pro HTML
