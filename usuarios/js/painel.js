/* painel.js — link de convite + torcida robusta + status derivado + apelido
   Requer: firebase compat + firebase-init.js (auth, db)
*/

function $(id){ return document.getElementById(id); }
function setText(id, v){ const el=$(id); if(el) el.textContent=v; }
function logError(ctx, e){ console.error(`[PAINEL] ${ctx}:`, e); }

/* ============ Auth / Usuário ============ */
auth.onAuthStateChanged(async (user)=>{
  try{
    if(!user){ location.href="index.html"; return; }
    const uid=user.uid;

    const uSnap=await db.collection("usuarios").doc(uid).get();
    const u=uSnap.data()||{};

    // Saudação priorizando apelido
    const nome = u.apelido || u.usuario || u.usuarioUnico || u.nome || user.displayName || "Usuário";
    setText("nomeUsuario", nome);

    // Créditos / Pontuação real
    setText("creditos", String(u.creditos ?? u.creditosDisponiveis ?? 0));
    let pontos=0;
    if (u.pontuacoes && typeof u.pontuacoes==='object'){
      try{ pontos = Object.values(u.pontuacoes).reduce((a,b)=>a+(Number(b)||0),0); }catch{}
    } else { pontos = (u.pontuacao ?? u.pontuacaoAcumulada ?? 0); }
    setText("pontuacao", String(pontos));

    // Avatar
    const avatar=(u.avatarUrl && String(u.avatarUrl).trim()) ? u.avatarUrl : "/usuarios/img/avatar-fallback.png";
    const avatarImg=$("avatarImg"); if(avatarImg) avatarImg.src=avatar;

    // Time do coração
    if(u.timeId){
      try{
        const tRef=await db.collection("times").doc(u.timeId).get();
        setText("timeCoracao", tRef.exists ? (tRef.data()?.nome || "—") : "—");
      }catch{ setText("timeCoracao","—"); }
    } else setText("timeCoracao","—");

    // LINK DE CONVITE (corrigido)
    const link = `https://yellup.vercel.app/usuarios/cadastro.html?indicador=${uid}`;
    const linkInput = $("linkConvite"); if(linkInput) linkInput.value = link;
    window.copiarLink = async function(){
      try{
        if(navigator.clipboard){ await navigator.clipboard.writeText(linkInput.value); alert("Link copiado!"); }
        else { linkInput.select(); document.execCommand("copy"); alert("Link copiado!"); }
      }catch(e){ alert("Não foi possível copiar o link."); }
    };

    await inicializarListas();
  }catch(e){ logError("onAuthStateChanged", e); }
});

/* ============ Datas ============ */
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

/* ============ Status derivado (usa dataFim se status estiver errado) ============ */
function statusDerivado(jogo){
  const raw=(jogo.status||"").toLowerCase();
  const now=new Date();
  const ini=jogo.dataInicio?.toDate ? jogo.dataInicio.toDate() : null;
  const fim=jogo.dataFim?.toDate     ? jogo.dataFim.toDate()     : null;

  if (["encerrado","finalizado","fim"].includes(raw)) return "ENCERRADO";
  if (fim && fim < now) return "ENCERRADO";
  if (ini && ini <= now && (!fim || fim > now)) return "LIVE";
  return "AGENDADO";
}

/* ============ Torcida: contador “à prova de esquema” ============ */
/* Procura por 4 nomes para o campo do jogo e 4 nomes para o campo do time.
   Soma: 1) coleção raiz "torcidas", 2) subcoleção "jogos/{id}/torcidas",
   3) agregados no doc do jogo (torcidaCasaCount/torcidaForaCount).
*/
const JOGO_KEYS = ["jogoId","idJogo","partidaId","idPartida"];
const TIME_KEYS = ["timeId","timeEscolhidoId","time","timeEscolhido"];

async function contarRaizTorcidas(jogoId, casaId, foraId){
  let casa=0, fora=0;
  for(const jk of JOGO_KEYS){
    try{
      const snap = await db.collection("torcidas").where(jk,"==",jogoId).get();
      if(!snap.empty){
        snap.forEach(doc=>{
          const t = doc.data();
          const tid = TIME_KEYS.map(k=>t[k]).find(v=>!!v);
          if(tid===casaId) casa++;
          else if(tid===foraId) fora++;
        });
      }
    }catch(e){ /* ignora consulta não indexada */ }
  }
  return {casa, fora};
}

async function contarSubcolecao(jogoId, casaId, foraId){
  let casa=0, fora=0;
  try{
    const sub = await db.collection("jogos").doc(jogoId).collection("torcidas").get();
    if(!sub.empty){
      sub.forEach(doc=>{
        const t = doc.data();
        const tid = TIME_KEYS.map(k=>t[k]).find(v=>!!v);
        if(tid===casaId) casa++;
        else if(tid===foraId) fora++;
      });
    }
  }catch(e){}
  return {casa, fora};
}

async function contarTorcida(jogoId, casaId, foraId, agregados){
  // 0) agregados no doc (se existirem)
  const aCasa=Number(agregados?.torcidaCasaCount||0);
  const aFora=Number(agregados?.torcidaForaCount||0);
  if (aCasa || aFora) return {casa:aCasa, fora:aFora};

  // 1) raiz com OR “manual” de chaves
  const r = await contarRaizTorcidas(jogoId, casaId, foraId);

  // 2) subcoleção
  const s = await contarSubcolecao(jogoId, casaId, foraId);

  return {casa: r.casa + s.casa, fora: r.fora + s.fora};
}

/* ============ Render de partidas ============ */
async function carregarJogosPeriodo(periodo, containerId){
  try{
    const box=$(containerId); if(!box) return;
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

      // Times
      const casaDoc=await db.collection("times").doc(jogo.timeCasaId).get();
      const foraDoc=await db.collection("times").doc(jogo.timeForaId).get();
      const nomeCasa=casaDoc.exists?(casaDoc.data().nome||"Time A"):"Time A";
      const nomeFora=foraDoc.exists?(foraDoc.data().nome||"Time B"):"Time B";
      const corCasa =casaDoc.exists?(casaDoc.data().corPrimaria||'#2ecc71'):'#2ecc71';
      const corFora =foraDoc.exists?(foraDoc.data().corPrimaria||'#e74c3c'):'#e74c3c';

      // Data/Hora e Status
      const dt=jogo.dataInicio?.toDate?jogo.dataInicio.toDate():new Date();
      const dataTxt=dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
      const horaTxt=dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      const status=statusDerivado(jogo);

      // Torcida (robusta)
      const {casa:cntCasa, fora:cntFora} = await contarTorcida(jogoId, jogo.timeCasaId, jogo.timeForaId, jogo);

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

          <!-- Linha 2: torcida ESQ | data·hora | torcida DIR -->
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
    logError(`carregarJogosPeriodo(${periodo})`, e);
    const box=$(containerId);
    if(box) box.innerHTML=`<p class="text-danger">Erro ao carregar partidas.</p>`;
  }
}

async function inicializarListas(){
  await carregarJogosPeriodo('hoje','listaHoje');
  await carregarJogosPeriodo('amanha','listaAmanha');
  await carregarJogosPeriodo('ontem','listaOntem');
}

/* ============ Torcer (sem mudanças) ============ */
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
