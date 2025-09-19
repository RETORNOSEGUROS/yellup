/* painel.js — torcida robusta + status derivado + apelido
   Requer: firebase compat + firebase-init.js (auth, db)
*/

function setText(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function logError(ctx,e){ console.error(`[PAINEL] ${ctx}:`, e); }

/* ============ Auth / Usuário ============ */
auth.onAuthStateChanged(async (user)=>{
  try{
    if(!user){ location.href="index.html"; return; }
    const uid=user.uid;
    const uSnap=await db.collection("usuarios").doc(uid).get();
    const u=uSnap.data()||{};

    // >>> usa apelido primeiro
    const nome = u.apelido || u.usuario || u.usuarioUnico || u.nome || user.displayName || "Usuário";
    setText("nomeUsuario", nome);

    // créditos / pontos
    const creditos=(u.creditos??u.creditosDisponiveis??0);
    setText("creditos", String(creditos));

    // pontuação real: soma do mapa 'pontuacoes' se existir
    let pontos=0;
    if (u.pontuacoes && typeof u.pontuacoes==='object'){
      try{ pontos=Object.values(u.pontuacoes).reduce((a,b)=>a+(Number(b)||0),0); }catch{}
    } else { pontos=(u.pontuacao??u.pontuacaoAcumulada??0); }
    setText("pontuacao", String(pontos));

    // avatar
    const avatar=(u.avatarUrl && String(u.avatarUrl).trim())?u.avatarUrl:"/usuarios/img/avatar-fallback.png";
    const avatarImg=document.getElementById("avatarImg"); if(avatarImg) avatarImg.src=avatar;

    // time do coração
    if(u.timeId){
      try{
        const tRef=await db.collection("times").doc(u.timeId).get();
        setText("timeCoracao", tRef.exists ? (tRef.data()?.nome || "—") : "—");
      }catch{ setText("timeCoracao","—"); }
    }else setText("timeCoracao","—");

    await inicializarListas();
  }catch(e){ logError("onAuthStateChanged",e); }
});

/* ============ Util: datas e consulta ============ */
function getRange(p){
  const s=new Date(); s.setHours(0,0,0,0);
  const e=new Date(); e.setHours(23,59,59,999);
  if(p==='amanha'){ s.setDate(s.getDate()+1); e.setDate(e.getDate()+1); }
  if(p==='ontem'){  s.setDate(s.getDate()-1); e.setDate(e.getDate()-1); }
  return {start:s,end:e};
}
async function queryJogosPorData(start,end){
  try{
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end)
      .orderBy("dataInicio","asc").get();
  }catch{
    return await db.collection("jogos")
      .where("dataInicio", ">=", start)
      .where("dataInicio", "<=", end).get();
  }
}

/* ============ Status derivado (fim garante ENCERRADO) ============ */
function statusDerivado(jogo){
  const raw=(jogo.status||"").toLowerCase();
  const now=new Date();
  const ini=jogo.dataInicio?.toDate?jogo.dataInicio.toDate():null;
  const fim=jogo.dataFim?.toDate?jogo.dataFim.toDate():null;

  if (["encerrado","finalizado","fim"].includes(raw)) return "ENCERRADO";
  if (fim && fim < now) return "ENCERRADO";
  if (ini && ini <= now && (!fim || fim > now)) return "LIVE";
  return "AGENDADO";
}

/* ============ Contagem de torcida (robusta) ============ */
/* cobre:
   - coleção raiz "torcidas" (campos timeId OU timeEscolhidoId)
   - subcoleção "jogos/{id}/torcidas"
   - agregados no doc do jogo (torcidaCasaCount/torcidaForaCount)
*/
async function contarTorcida(jogoId, casaId, foraId, agregados){
  // 0) agregados no doc
  const aCasa=Number(agregados?.torcidaCasaCount||0);
  const aFora=Number(agregados?.torcidaForaCount||0);
  if (aCasa || aFora) return {casa:aCasa, fora:aFora};

  let casa=0, fora=0;

  // 1) raiz
  try{
    const snap=await db.collection("torcidas").where("jogoId","==",jogoId).get();
    snap.forEach(td=>{
      const t=td.data();
      const tid = t.timeId || t.timeEscolhidoId;    // <-- cobre ambos
      if(tid===casaId) casa++;
      else if(tid===foraId) fora++;
    });
  }catch{}

  // 2) subcoleção
  if(casa===0 && fora===0){
    try{
      const sub=await db.collection("jogos").doc(jogoId).collection("torcidas").get();
      sub.forEach(td=>{
        const t=td.data();
        const tid = t.timeId || t.timeEscolhidoId;
        if(tid===casaId) casa++;
        else if(tid===foraId) fora++;
      });
    }catch{}
  }

  return {casa, fora};
}

/* ============ Render ============ */
async function carregarJogosPeriodo(periodo, containerId){
  try{
    const box=document.getElementById(containerId); if(!box) return;
    box.innerHTML=`<p class="text-white-50">Carregando...</p>`;

    const {start,end}=getRange(periodo);
    const snap=await queryJogosPorData(start,end);
    if(snap.empty){ box.innerHTML=`<p class="text-white-50">Sem partidas ${periodo==='ontem'?'ontem':periodo==='amanha'?'amanhã':'hoje'}.</p>`; return; }

    const uid=auth.currentUser?.uid;
    const uDoc=uid?(await db.collection("usuarios").doc(uid).get()):null;
    const torcidasUser=uDoc?.data()?.torcidas||{};

    const docs=snap.docs.sort((a,b)=>{
      const ta=a.data().dataInicio?.toDate()?.getTime()??0;
      const tb=b.data().dataInicio?.toDate()?.getTime()??0;
      return ta-tb;
    });

    box.innerHTML="";
    for(const d of docs){
      const jogo=d.data(); const jogoId=d.id;

      // times
      const casaDoc=await db.collection("times").doc(jogo.timeCasaId).get();
      const foraDoc=await db.collection("times").doc(jogo.timeForaId).get();
      const nomeCasa=casaDoc.exists?(casaDoc.data().nome||"Time A"):"Time A";
      const nomeFora=foraDoc.exists?(foraDoc.data().nome||"Time B"):"Time B";
      const corCasa =casaDoc.exists?(casaDoc.data().corPrimaria||'#2ecc71'):'#2ecc71';
      const corFora =foraDoc.exists?(foraDoc.data().corPrimaria||'#e74c3c'):'#e74c3c';

      const dt=jogo.dataInicio?.toDate?jogo.dataInicio.toDate():new Date();
      const dataTxt=dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      const horaTxt=dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      const status=statusDerivado(jogo);

      const {casa:cntCasa, fora:cntFora}=await contarTorcida(jogoId, jogo.timeCasaId, jogo.timeForaId, jogo);
      const jaTorcendo=Boolean(torcidasUser[jogoId]);

      const col=document.createElement('div'); col.className="col-12 col-md-6 col-lg-4";
      col.innerHTML=`
        <div class="yl-match h-100">
          <!-- Linha 1: nomes -->
          <div class="yl-row1">
            <div class="yl-team">
              <span class="yl-dot" style="background:${corCasa}"></span>
              <span>${nomeCasa}</span>
            </div>
            <div class="yl-center">
              ${status==="LIVE" ? `<span class="yl-badge yl-live">LIVE</span>` : `<span class="yl-badge">${status}</span>`}
            </div>
            <div class="yl-team right">
              <span>${nomeFora}</span>
              <span class="yl-dot" style="background:${corFora}"></span>
            </div>
          </div>

          <!-- Linha 2: torcida ESQ | data·hora centro | torcida DIR -->
          <div class="yl-row2">
            <span class="yl-count left"  style="border-color:${corCasa}; background:rgba(0,0,0,.2)">
              <span class="ico" style="background:${corCasa}"></span> ${cntCasa}
            </span>
            <div class="yl-center">
              <span class="yl-badge">${dataTxt}</span>
              <span class="yl-badge">${horaTxt}</span>
            </div>
            <span class="yl-count right" style="border-color:${corFora}; background:rgba(0,0,0,.2)">
              <span class="ico" style="background:${corFora}"></span> ${cntFora}
            </span>
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
      box.appendChild(col);
    }
  }catch(e){
    logError(`carregarJogosPeriodo(${periodo})`,e);
    const box=document.getElementById(containerId);
    if(box) box.innerHTML=`<p class="text-danger">Erro ao carregar partidas.</p>`;
  }
}

async function inicializarListas(){
  await carregarJogosPeriodo('hoje','listaHoje');
  await carregarJogosPeriodo('amanha','listaAmanha');
  await carregarJogosPeriodo('ontem','listaOntem');
}

/* ============ Torcer (inalterado) ============ */
async function torcer(jogoId, timeEscolhidoId){
  try{
    const user=auth.currentUser; if(!user) return;
    const userRef=db.collection("usuarios").doc(user.uid);
    const doc=await userRef.get(); const dados=doc.data()||{};
    if(dados.torcidas && dados.torcidas[jogoId]){ alert("Você já escolheu seu time para este jogo."); return; }

    const creditosAtuais=(dados.creditos??dados.creditosDisponiveis??0);
    if(creditosAtuais<1){ alert("Você não tem créditos suficientes para torcer."); return; }

    await userRef.update({ creditos: creditosAtuais-1, [`torcidas.${jogoId}`]: timeEscolhidoId });
    await db.collection("torcidas").doc(`${jogoId}_${user.uid}`).set({
      uid:user.uid, jogoId, timeId:timeEscolhidoId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});

    location.href=`painel-jogo.html?id=${jogoId}`;
  }catch(e){ logError("torcer",e); alert("Não foi possível registrar sua torcida."); }
}
window.torcer=torcer;
