/**
 * YELLUP - Painel de Jogo ao Vivo
 * Versão 2.0 - Atualizada com:
 * - Sistema de perguntas aleatórias
 * - Jogadas grátis (3 por dia)
 * - Player de rádio
 * - Patrocinadores
 * 
 * Última atualização: 17/01/2025
 */

const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
let uid = null;
let timeTorcida = null;
let respostaEnviada = false;
let perguntaAtual = null;
let jogo = null;
let temporizadorResposta = null;

// ✅ NOVO: Inicializar services
let perguntaService;
let patrocinadorService;
let radioService;

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) return (window.location.href = "/usuarios/index.html");
  uid = user.uid;

  // ✅ NOVO: Inicializar services
  perguntaService = new PerguntaService(db, firebase.auth());
  patrocinadorService = new PatrocinadorService(db);
  radioService = new RadioService(db);

  const userDoc = await db.collection("usuarios").doc(uid).get();
  const dados = userDoc.data();
  const nome = dados.apelido || dados.usuario || dados.usuarioUnico || "Torcedor";
  const creditos = dados.creditos ?? dados.creditosDisponiveis ?? 0;
  timeTorcida = dados.torcidas?.[jogoId];
  
  if (!timeTorcida) {
    alert("Você não escolheu um time para torcer.");
    return window.location.href = "painel.html";
  }

  document.getElementById("infoUsuario").innerText = `👤 ${nome} | 💳 Créditos: ${creditos}`;

  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  jogo = jogoDoc.data();

  const timeA = await db.collection("times").doc(jogo.timeCasaId).get();
  const timeB = await db.collection("times").doc(jogo.timeForaId).get();

  const dadosA = timeA.data();
  const dadosB = timeB.data();

  const nomeA = dadosA.nome;
  const nomeB = dadosB.nome;

  // Cores completas (3 tons)
  const corA1 = dadosA.primaria || dadosA.corPrimaria || "#28a745";
  const corA2 = dadosA.secundaria || dadosA.corSecundaria || corA1;
  const corA3 = dadosA.terciaria || dadosA.corTerciaria || corA1;
  const corB1 = dadosB.primaria || dadosB.corPrimaria || "#dc3545";
  const corB2 = dadosB.secundaria || dadosB.corSecundaria || corB1;
  const corB3 = dadosB.terciaria || dadosB.corTerciaria || corB1;

  // Aplica nomes
  document.getElementById("tituloJogo").innerText = `${nomeA} x ${nomeB}`;
  document.getElementById("timeA").innerText = nomeA;
  document.getElementById("timeB").innerText = nomeB;

  // Aplica gradiente nos nomes
  document.getElementById("timeA").style.background = `linear-gradient(45deg, ${corA1}, ${corA2}, ${corA3})`;
  document.getElementById("timeB").style.background = `linear-gradient(45deg, ${corB1}, ${corB2}, ${corB3})`;

  // Variáveis CSS para barras
  document.documentElement.style.setProperty("--cor-timeA", corA1);
  document.documentElement.style.setProperty("--cor-timeB", corB1);
  document.documentElement.style.setProperty("--corA1", corA1);
  document.documentElement.style.setProperty("--corB1", corB1);
  document.documentElement.style.setProperty("--corA2", corA2);
  document.documentElement.style.setProperty("--corB2", corB2);

  document.getElementById("inicioJogo").innerText = formatarData(jogo.dataInicio.toDate());
  document.getElementById("fimJogo").innerText = formatarData(jogo.dataFim.toDate());

  atualizarTempoRestante(jogo.dataFim.toDate());
  setInterval(() => atualizarTempoRestante(jogo.dataFim.toDate()), 1000);

  // APLICAR GRADIENTES NOS TÍTULOS DOS CHATS
  const chatTorcidaTitle = document.querySelector(".chat-col:nth-child(1) h6");
  const chatGeralTitle = document.querySelector(".chat-col:nth-child(2) h6");
  
  if (chatTorcidaTitle) {
    chatTorcidaTitle.classList.add("chat-title");
    let corT1, corT2, corT3;
    if (timeTorcida === jogo.timeCasaId) {
      corT1 = corA1;
      corT2 = corA2;
      corT3 = corA3;
    } else {
      corT1 = corB1;
      corT2 = corB2;
      corT3 = corB3;
    }
    chatTorcidaTitle.style.background = `linear-gradient(45deg, ${corT1}, ${corT2}, ${corT3})`;
  }
  
  if (chatGeralTitle) {
    chatGeralTitle.classList.add("chat-title");
    chatGeralTitle.style.background = `linear-gradient(45deg, ${corA1}, ${corB2}, ${corB3})`;
  }

  // ✅ NOVO: Inicializar recursos novos
  await atualizarJogadasGratis();
  await atualizarInfoPerguntas();
  
  // Renderizar patrocinadores
  await patrocinadorService.renderizar('patrocinador-topo', 'banner', 'carousel');
  await patrocinadorService.renderizar('patrocinador-banner', 'banner', 'banner');
  await patrocinadorService.renderizar('patrocinador-rodape', 'rodape', 'logo');
  
  // Renderizar player de rádio
  await radioService.renderizarPlayer('radio-player-container', jogoId);

  calcularTorcida();
  calcularPontuacao();
  iniciarChat();
  montarRanking();
});

function formatarData(data) {
  return data.toLocaleString("pt-BR", { hour: '2-digit', minute: '2-digit' });
}

function atualizarTempoRestante(fim) {
  const agora = new Date();
  const diff = Math.max(0, fim - agora);
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  document.getElementById("tempoRestante").innerText = `${min}m ${sec}s`;
}

async function calcularTorcida() {
  const usuarios = await db.collection("usuarios").get();
  let a = 0, b = 0;
  usuarios.forEach(doc => {
    const t = doc.data().torcidas?.[jogoId];
    if (t === jogo.timeCasaId) a++;
    if (t === jogo.timeForaId) b++;
  });
  const total = a + b;
  const pa = total ? Math.round((a / total) * 100) : 0;
  const pb = total ? 100 - pa : 0;
  document.getElementById("torcidaA").innerText = a;
  document.getElementById("torcidaB").innerText = b;
  document.getElementById("porcentagemA").innerText = `${pa}%`;
  document.getElementById("porcentagemB").innerText = `${pb}%`;

  document.getElementById("barraTorcidaA").style.width = `${pa}%`;
  document.getElementById("barraTorcidaB").style.width = `${pb}%`;
}

// ✅ ATUALIZADO: Sistema de perguntas aleatórias
async function responderPergunta() {
  try {
    // Verifica jogadas grátis
    const jogadasGratis = await perguntaService.verificarJogadasGratis();
    
    // Verifica créditos
    const userDoc = await db.collection("usuarios").doc(uid).get();
    const creditos = userDoc.data()?.creditos ?? 0;
    
    if (!jogadasGratis.temGratis && creditos < 1) {
      alert("Você não tem créditos suficientes! Compre mais créditos ou aguarde o reset diário das jogadas grátis.");
      return;
    }
    
    // ✅ NOVO: Buscar pergunta ALEATÓRIA
    const perguntas = await perguntaService.buscarPerguntasAleatorias(jogoId, 1);
    
    if (perguntas.length === 0) {
      alert("Parabéns! Você já respondeu todas as perguntas disponíveis para este jogo! 🎉");
      return;
    }
    
    const pergunta = perguntas[0];
    mostrarPergunta(pergunta);
    
  } catch (error) {
    console.error("Erro ao buscar pergunta:", error);
    alert("Erro ao carregar pergunta. Tente novamente!");
  }
}

function mostrarPergunta(p) {
  perguntaAtual = p;
  respostaEnviada = false;
  
  document.getElementById("textoPergunta").innerText = p.pergunta || p.texto || "Pergunta não encontrada";
  document.getElementById("opcoesRespostas").innerHTML = "";
  document.getElementById("mensagemResultado").innerText = "";

  // Suporta ambos formatos: opcoes[] ou alternativas{}
  const opcoes = p.opcoes || [];
  const alternativas = p.alternativas || {};
  
  if (opcoes.length > 0) {
    // Formato novo: opcoes[]
    opcoes.forEach((textoOpcao, index) => {
      const btn = document.createElement("button");
      btn.className = "list-group-item list-group-item-action";
      btn.innerText = textoOpcao;
      btn.onclick = () => responder(index, p.respostaCorreta, p.pontos || p.pontuacao || 10, p.id);
      document.getElementById("opcoesRespostas").appendChild(btn);
    });
  } else {
    // Formato antigo: alternativas{}
    ["A", "B", "C", "D"].forEach(letra => {
      const textoAlt = alternativas[letra] || "Indefinido";
      const btn = document.createElement("button");
      btn.className = "list-group-item list-group-item-action";
      btn.innerText = textoAlt;
      btn.onclick = () => responder(letra, p.correta, p.pontuacao || 10, p.id);
      document.getElementById("opcoesRespostas").appendChild(btn);
    });
  }

  iniciarContador();
}

function iniciarContador() {
  const barra = document.getElementById("barra");
  if (!barra) return;
  
  barra.style.display = "block";
  barra.style.animation = "none";
  barra.offsetHeight; // força reflow
  barra.style.animation = "barraTempo 9s linear forwards";

  temporizadorResposta = setTimeout(() => {
    if (!respostaEnviada) {
      document.getElementById("mensagemResultado").innerText = "⏱️ Tempo esgotado!";
      desabilitarOpcoes();
      pararContador();
    }
  }, 9000);
}

function pararContador() {
  if (temporizadorResposta) clearTimeout(temporizadorResposta);
  temporizadorResposta = null;
  const barra = document.getElementById("barra");
  if (barra) {
    barra.style.animation = "none";
    barra.offsetHeight;
    barra.style.display = "none";
  }
}

function desabilitarOpcoes() {
  document.querySelectorAll("#opcoesRespostas button").forEach(btn => btn.disabled = true);
}

// ✅ ATUALIZADO: Responder com jogadas grátis
async function responder(respostaUsuario, respostaCorreta, pontos, perguntaId) {
  if (respostaEnviada) return;
  respostaEnviada = true;
  pararContador();
  
  // Determina se acertou (suporta ambos formatos)
  let acertou = false;
  if (typeof respostaUsuario === 'number') {
    // Formato novo (index)
    acertou = (respostaUsuario === respostaCorreta);
  } else {
    // Formato antigo (letra)
    acertou = (respostaUsuario === respostaCorreta);
  }
  
  const mensagemResultado = document.getElementById("mensagemResultado");
  
  if (acertou) {
    mensagemResultado.innerHTML = `✅ <strong style="color: var(--yl-success);">Resposta correta! +${pontos} pontos</strong>`;
  } else {
    const respostaTexto = typeof respostaCorreta === 'number' 
      ? `opção ${respostaCorreta + 1}` 
      : respostaCorreta;
    mensagemResultado.innerHTML = `❌ <strong style="color: var(--yl-danger);">Errado!</strong> Resposta correta: ${respostaTexto}`;
  }

  try {
    // ✅ NOVO: Registrar resposta no histórico
    await perguntaService.registrarResposta(jogoId, perguntaId, acertou, pontos);
    
    // Verificar se usa jogada grátis ou crédito
    const jogadasGratis = await perguntaService.verificarJogadasGratis();
    
    if (jogadasGratis.temGratis) {
      // ✅ NOVO: Usar jogada grátis
      await perguntaService.consumirJogadaGratis();
      mensagemResultado.innerHTML += '<br><small style="color: var(--yl-accent);">🎁 Usou jogada grátis</small>';
      await atualizarJogadasGratis();
    } else {
      // Descontar crédito (antigo)
      await db.collection("usuarios").doc(uid).update({
        creditos: firebase.firestore.FieldValue.increment(-1)
      });
      
      // Atualizar créditos em tempo real
      const infoUsuario = document.getElementById("infoUsuario");
      const regex = /💳 Créditos: (\d+)/;
      const atual = parseInt(infoUsuario.innerText.match(regex)?.[1] || "0", 10);
      infoUsuario.innerText = infoUsuario.innerText.replace(regex, `💳 Créditos: ${Math.max(0, atual - 1)}`);
    }

    // Adicionar pontuação se acertou
    if (acertou) {
      await db.collection("usuarios").doc(uid).update({
        [`pontuacoes.${jogoId}`]: firebase.firestore.FieldValue.increment(pontos),
        xp: firebase.firestore.FieldValue.increment(pontos)
      });
    }

    // ✅ NOVO: Atualizar info de perguntas
    await atualizarInfoPerguntas();

    calcularPontuacao();
    montarRanking();
    desabilitarOpcoes();
    
  } catch (error) {
    console.error("Erro ao registrar resposta:", error);
    alert("Erro ao salvar resposta. Tente novamente!");
  }
}

// ✅ NOVO: Atualizar contador de jogadas grátis
async function atualizarJogadasGratis() {
  try {
    const info = await perguntaService.verificarJogadasGratis();
    const qtdEl = document.getElementById("qtdGratis");
    if (qtdEl) {
      qtdEl.textContent = info.quantidade;
      qtdEl.style.color = info.quantidade > 0 ? 'var(--yl-accent)' : 'var(--yl-danger)';
    }
  } catch (error) {
    console.error("Erro ao atualizar jogadas grátis:", error);
  }
}

// ✅ NOVO: Atualizar info de perguntas
async function atualizarInfoPerguntas() {
  try {
    const stats = await perguntaService.obterEstatisticas(jogoId);
    const respondidasEl = document.getElementById("perguntasRespondidas");
    const disponiveisEl = document.getElementById("perguntasDisponiveis");
    
    if (respondidasEl) respondidasEl.textContent = stats.respondidas;
    if (disponiveisEl) disponiveisEl.textContent = stats.disponiveis;
  } catch (error) {
    console.error("Erro ao atualizar info perguntas:", error);
  }
}

async function calcularPontuacao() {
  try {
    // Buscar pontuações por time
    const usuarios = await db.collection("usuarios").get();
    let a = 0, b = 0;
    
    usuarios.forEach(doc => {
      const user = doc.data();
      const pontos = user.pontuacoes?.[jogoId] || 0;
      const timeUser = user.torcidas?.[jogoId];
      
      if (timeUser === jogo.timeCasaId) a += pontos;
      if (timeUser === jogo.timeForaId) b += pontos;
    });
    
    const total = a + b;
    const pa = total ? Math.round((a / total) * 100) : 50;
    const pb = total ? 100 - pa : 50;
    
    document.getElementById("pontosA").innerText = a;
    document.getElementById("pontosB").innerText = b;
    document.getElementById("porcentagemPontosA").innerText = `${pa}%`;
    document.getElementById("porcentagemPontosB").innerText = `${pb}%`;

    document.getElementById("barraPontosA").style.width = `${pa}%`;
    document.getElementById("barraPontosB").style.width = `${pb}%`;
  } catch (error) {
    console.error("Erro ao calcular pontuação:", error);
  }
}

async function montarRanking() {
  try {
    const usuarios = await db.collection("usuarios").get();
    const ranking = [];
    
    usuarios.forEach(doc => {
      const user = doc.data();
      const timeUser = user.torcidas?.[jogoId];
      if (timeUser !== timeTorcida) return; // Só mostrar da mesma torcida
      
      const pontos = user.pontuacoes?.[jogoId] || 0;
      if (pontos > 0) {
        ranking.push({
          nome: user.apelido || user.usuario || user.usuarioUnico || "Anônimo",
          pontos: pontos,
          avatar: user.avatar || user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.usuario || 'U')}&background=random`
        });
      }
    });
    
    ranking.sort((a, b) => b.pontos - a.pontos);
    
    const rankingEl = document.getElementById("rankingPontuacao");
    if (!rankingEl) return;
    
    rankingEl.innerHTML = "";
    
    if (ranking.length === 0) {
      rankingEl.innerHTML = '<li class="list-group-item text-center" style="background: var(--yl-bg-secondary); color: var(--yl-text-secondary);">Nenhuma pontuação ainda</li>';
      return;
    }
    
    ranking.slice(0, 10).forEach((user, index) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex align-items-center gap-2";
      li.style.background = "var(--yl-bg-secondary)";
      li.style.color = "var(--yl-text-primary)";
      li.style.border = "1px solid var(--yl-stroke)";
      li.style.marginBottom = "5px";
      li.style.borderRadius = "8px";
      
      const posicao = index + 1;
      const medalha = posicao === 1 ? '🥇' : posicao === 2 ? '🥈' : posicao === 3 ? '🥉' : `${posicao}º`;
      
      li.innerHTML = `
        <strong style="min-width: 35px;">${medalha}</strong>
        <img src="${user.avatar}" alt="${user.nome}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
        <span style="flex: 1;">${user.nome}</span>
        <strong style="color: var(--yl-accent);">${user.pontos} pts</strong>
      `;
      
      rankingEl.appendChild(li);
    });
  } catch (error) {
    console.error("Erro ao montar ranking:", error);
  }
}

// ===== CHAT (mantém código original) =====
function iniciarChat() {
  escutarChat("time", timeTorcida);
  escutarChat("geral", null);
}

function escutarChat(tipo, filtroTime) {
  const containerId = tipo === "time" ? "chatTime" : "chatGeral";
  const query = filtroTime
    ? db.collection("chats").where("jogoId", "==", jogoId).where("timeId", "==", filtroTime).orderBy("timestamp", "desc").limit(50)
    : db.collection("chats").where("jogoId", "==", jogoId).orderBy("timestamp", "desc").limit(50);

  query.onSnapshot(snap => {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = "";
    const msgs = [];
    snap.forEach(doc => msgs.push({ id: doc.id, ...doc.data() }));
    msgs.reverse().forEach(msg => {
      const div = document.createElement("div");
      div.className = "chat-message";
      const avatar = msg.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.nome || 'U')}&background=random`;
      div.innerHTML = `
        <img src="${avatar}" alt="${msg.nome}">
        <div><strong>${msg.nome}:</strong> ${msg.mensagem}</div>
      `;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
  });
}

async function enviarMensagem(tipo) {
  const inputId = tipo === "time" ? "mensagemTime" : "mensagemGeral";
  const input = document.getElementById(inputId);
  const mensagem = input.value.trim();
  if (!mensagem) return;

  const userDoc = await db.collection("usuarios").doc(uid).get();
  const user = userDoc.data();
  const nome = user.apelido || user.usuario || user.usuarioUnico || "Anônimo";
  const avatar = user.avatar || user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=random`;

  await db.collection("chats").add({
    jogoId,
    timeId: tipo === "time" ? timeTorcida : null,
    userId: uid,
    nome,
    avatar,
    mensagem,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });

  input.value = "";
}

// Permitir envio com Enter
document.addEventListener('DOMContentLoaded', () => {
  const inputTime = document.getElementById("mensagemTime");
  const inputGeral = document.getElementById("mensagemGeral");
  
  if (inputTime) {
    inputTime.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') enviarMensagem('time');
    });
  }
  
  if (inputGeral) {
    inputGeral.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') enviarMensagem('geral');
    });
  }
});

console.log("✅ Painel de Jogo v2.0 carregado com sucesso!");
