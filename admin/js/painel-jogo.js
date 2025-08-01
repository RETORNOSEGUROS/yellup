// [INÍCIO DO ARQUIVO]
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let timeCasaId = "";
let timeForaId = "";
let nomeCasa = "Time A";
let nomeFora = "Time B";
let bloqueioChat = false;
const filaMensagens = { geral: [], timeA: [], timeB: [] };
let pontosPorTime = { casa: 0, fora: 0 };

async function carregarJogo() {
  console.log("🟢 Iniciando painel do jogo...");

  try {
    const jogoDoc = await db.collection("jogos").doc(jogoId).get();
    if (!jogoDoc.exists) {
      console.warn("⚠️ Jogo não encontrado.");
      return;
    }

    const jogo = jogoDoc.data();
    timeCasaId = jogo.timeCasaId;
    timeForaId = jogo.timeForaId;

    const timeCasaSnap = await db.collection("times").doc(timeCasaId).get();
    const timeForaSnap = await db.collection("times").doc(timeForaId).get();

    nomeCasa = timeCasaSnap.exists ? timeCasaSnap.data().nome : "Time A";
    nomeFora = timeForaSnap.exists ? timeForaSnap.data().nome : "Time B";

    document.getElementById("titulo-jogo").textContent = `${nomeCasa} vs ${nomeFora}`;
    document.getElementById("inicio-jogo").textContent = jogo.dataInicio?.toDate().toLocaleString("pt-BR") || "-";
    document.getElementById("entrada-jogo").textContent = jogo.valorEntrada ? `${jogo.valorEntrada} crédito(s)` : "-";

    document.querySelector("h3[data-time='A']").textContent = `🔵 Torcida do ${nomeCasa}`;
    document.querySelector("h3[data-time='B']").textContent = `🔴 Torcida do ${nomeFora}`;

    escutarChats();
    await carregarPontosDoFirestore();
    await carregarOuCriarOrdemDePerguntas();
    atualizarPlacar();
  } catch (e) {
    console.error("❌ Erro ao carregar jogo:", e);
  }
}

async function carregarPontosDoFirestore() {
  const snapshot = await db.collection("respostas")
    .where("jogoId", "==", jogoId)
    .where("correta", "==", true)
    .get();

  pontosPorTime = { casa: 0, fora: 0 };

  snapshot.forEach(doc => {
    const r = doc.data();
    if (r.timeTorcida === timeCasaId) pontosPorTime.casa += r.pontos || 0;
    if (r.timeTorcida === timeForaId) pontosPorTime.fora += r.pontos || 0;
  });
}

function enviarMensagem(tipo) {
  const input = document.getElementById(`input${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);
  const texto = input.value.trim();
  if (!texto) return;

  if (bloqueioChat) {
    filaMensagens[tipo].push(texto);
  } else {
    enviaMsgAgora(tipo, texto);
  }

  input.value = "";
}

function enviaMsgAgora(tipo, texto) {
  const caminho = tipo === "geral" ? `chats_jogo/${jogoId}/geral`
    : tipo === "timeA" ? `chats_jogo/${jogoId}/casa`
    : `chats_jogo/${jogoId}/fora`;

  db.collection(caminho).add({
    texto,
    admin: true,
    criadoEm: new Date()
  });
}

function escutarChats() {
  escutarChat(`chats_jogo/${jogoId}/geral`, "chatGeral");
  escutarChat(`chats_jogo/${jogoId}/casa`, "chatTimeA");
  escutarChat(`chats_jogo/${jogoId}/fora`, "chatTimeB");
}

function escutarChat(caminho, divId) {
  db.collection(caminho).orderBy("criadoEm").onSnapshot(snapshot => {
    const div = document.getElementById(divId);
    div.innerHTML = "";
    snapshot.forEach(doc => {
      const msg = doc.data();

      if (msg.tipo === "pergunta" && msg.perguntaId && msg.alternativas) {
        div.innerHTML = "";
        exibirPerguntaNoChat(div, msg, false, divId.includes("TimeA") ? "casa" : "fora");
      } else {
        const linha = document.createElement("div");
        const hora = msg.criadoEm?.toDate()?.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' }) || "--:--";
        linha.textContent = `[${hora}] ${msg.admin ? "[ADMIN] " : ""}${msg.texto}`;
        div.appendChild(linha);
      }
    });
    div.scrollTop = div.scrollHeight;
  });
}

async function buscarPerguntasPorTimeId(timeId) {
  const snapshot = await db.collection("perguntas").where("timeId", "==", timeId).get();
  const perguntas = [];
  snapshot.forEach(doc => perguntas.push({ id: doc.id, ...doc.data() }));
  return perguntas;
}

async function sortearPerguntaTime(lado) {
  const timeId = lado === "casa" ? timeCasaId : timeForaId;
  const chatRef = `chats_jogo/${jogoId}/${lado}`;
  const divId = lado === "casa" ? "chatTimeA" : "chatTimeB";

  const todas = await buscarPerguntasPorTimeId(timeId);
  const usadasSnap = await db.collection(`jogos/${jogoId}/perguntas_sorteadas`).get();
  const usadasIds = usadasSnap.docs.map(doc => doc.id);

  const disponiveis = todas.filter(p => !usadasIds.includes(p.id));
  if (disponiveis.length === 0) {
    alert("Todas as perguntas desse time já foram usadas neste jogo.");
    return;
  }

  const pergunta = disponiveis[Math.floor(Math.random() * disponiveis.length)];

  // Marca como usada no jogo atual
  await db.collection(`jogos/${jogoId}/perguntas_sorteadas`).doc(pergunta.id).set({
    timeId,
    sorteadaEm: new Date()
  });

  await db.collection(chatRef).add({
    tipo: "pergunta",
    perguntaId: pergunta.perguntaId || pergunta.id,
    texto: pergunta.pergunta,
    alternativas: pergunta.alternativas,
    correta: pergunta.correta,
    pontuacao: pergunta.pontuacao || 1,
    criadoEm: new Date()
  });

  await db.collection(`jogos/${jogoId}/perguntas_enviadas`).doc(pergunta.perguntaId || pergunta.id).set({
    perguntaId: pergunta.perguntaId || pergunta.id,
    time: lado,
    enviadaEm: new Date()
  });

  exibirPerguntaNoChat(document.getElementById(divId), pergunta, true, lado);
}

function exibirPerguntaNoChat(div, pergunta, animar = false, lado = "casa") {
  const bloco = document.createElement("div");
  bloco.className = "pergunta-bloco";
  bloco.setAttribute("data-id", pergunta.perguntaId || pergunta.id || "");

  const texto = pergunta.pergunta || pergunta.texto || "Pergunta sem texto";
  let alternativas = Object.entries(pergunta.alternativas || {});
  const corretaLetra = (pergunta.correta || "").toUpperCase();
  const pontuacao = pergunta.pontuacao || 1;

  const perguntaEl = document.createElement("p");
  perguntaEl.innerHTML = `<b>❓ ${texto}</b>`;
  bloco.appendChild(perguntaEl);

  const lista = document.createElement("ul");
  lista.style.display = "flex";
  lista.style.flexWrap = "wrap";
  lista.style.gap = "15px";
  lista.style.listStyleType = "none";
  lista.style.padding = "0";
  lista.style.marginTop = "10px";

  alternativas.forEach(([letra, texto]) => {
    const item = document.createElement("li");
    item.textContent = texto;
    item.dataset.letra = letra;
    item.style.border = "1px solid #ccc";
    item.style.padding = "8px 12px";
    item.style.borderRadius = "8px";
    item.style.background = "#f9f9f9";
    item.style.cursor = "default";
    lista.appendChild(item);
  });

  bloco.appendChild(lista);
  div.innerHTML = "";
  div.appendChild(bloco);
  div.scrollTop = div.scrollHeight;

  if (animar && alternativas.length) {
    bloqueioChat = true;
    let tempo = 9;
    let selecionadoLetra = null;
    const timer = document.createElement("p");
    timer.textContent = `⏳ ${tempo}s restantes`;
    bloco.appendChild(timer);

    const intervalo = setInterval(() => {
      tempo--;
      timer.textContent = `⏳ ${tempo}s restantes`;

      if (tempo <= 0) {
        clearInterval(intervalo);
        timer.remove();

        const items = lista.querySelectorAll("li");
        items.forEach(el => {
          el.style.cursor = "default";
          el.style.color = "#999";
          el.style.fontWeight = "normal";
          el.style.textDecoration = "none";

          if (el.dataset.letra === corretaLetra) {
            el.style.background = "#d4edda";
            el.style.color = "#155724";
            el.style.borderColor = "#c3e6cb";
            el.style.fontWeight = "bold";
          }

          if (el.dataset.letra === selecionadoLetra && el.dataset.letra !== corretaLetra) {
            el.style.background = "#f8d7da";
            el.style.color = "#721c24";
            el.style.borderColor = "#f5c6cb";
            el.style.textDecoration = "line-through";
          }
        });

        if (selecionadoLetra && !bloco.getAttribute("data-respondido")) {
          bloco.setAttribute("data-respondido", "true");
          const acertou = selecionadoLetra === corretaLetra;
          const pontos = acertou ? pontuacao : 0;

          db.collection("respostas").add({
            jogoId,
            perguntaId: pergunta.perguntaId || pergunta.id,
            userId: "admin_teste",
            timeTorcida: lado === "casa" ? timeCasaId : timeForaId,
            resposta: selecionadoLetra,
            correta: acertou,
            pontos,
            data: new Date()
          });

          pontosPorTime[lado] += pontos;
          atualizarPlacar();
        }

        bloqueioChat = false;
        ["geral", "timeA", "timeB"].forEach(tipo => {
          filaMensagens[tipo].forEach(msg => enviaMsgAgora(tipo, msg));
          filaMensagens[tipo] = [];
        });
      }
    }, 1000);

    const items = lista.querySelectorAll("li");
    items.forEach(el => {
      el.style.cursor = "pointer";
      el.onclick = () => {
        if (tempo > 0) {
          selecionadoLetra = el.dataset.letra;
          items.forEach(li => li.style.fontWeight = "normal");
          el.style.fontWeight = "bold";
        }
      };
    });
  }
}

function atualizarPlacar() {
  const total = pontosPorTime.casa + pontosPorTime.fora;
  const pctCasa = total > 0 ? Math.round((pontosPorTime.casa / total) * 100) : 0;
  const pctFora = total > 0 ? 100 - pctCasa : 0;

  let placarEl = document.getElementById("placar-times");
  if (!placarEl) {
    placarEl = document.createElement("div");
    placarEl.id = "placar-times";
    placarEl.style.fontWeight = "bold";
    placarEl.style.marginBottom = "10px";
    placarEl.style.fontSize = "16px";
    document.body.insertBefore(placarEl, document.body.children[3]);
  }

  placarEl.textContent = `🏆 ${nomeCasa}: ${pontosPorTime.casa} pts (${pctCasa}%) | ${nomeFora}: ${pontosPorTime.fora} pts (${pctFora}%)`;
}


// NOVAS VARIÁVEIS DE CONTROLE DE ORDEM
let ordemPerguntas = { casa: [], fora: [] };
let ordemJaSalva = false;
let indiceAtual = { casa: 0, fora: 0 };

function embaralhar(lista) {
  return lista.sort(() => Math.random() - 0.5);
}

async function embaralharOrdemPerguntas() {
  const perguntasCasa = await buscarPerguntasPorTimeId(timeCasaId);
  const perguntasFora = await buscarPerguntasPorTimeId(timeForaId);

  ordemPerguntas.casa = perguntasCasa.sort(() => Math.random() - 0.5);
  ordemPerguntas.fora = perguntasFora.sort(() => Math.random() - 0.5);

  indiceAtual.casa = 0;
  indiceAtual.fora = 0;

  const ref = db.collection(`jogos/${jogoId}/perguntas_ordenadas`);
  const batch = db.batch();

  ordemPerguntas.casa.forEach((p, index) => {
    const docRef = ref.doc(`${p.id}_casa`);
    batch.set(docRef, {
      time: "casa",
      perguntaId: p.id,
      pergunta: p.pergunta,
      alternativas: p.alternativas,
      correta: p.correta,
      pontuacao: p.pontuacao || 1,
      ordem: index
    });
  });

  ordemPerguntas.fora.forEach((p, index) => {
    const docRef = ref.doc(`${p.id}_fora`);
    batch.set(docRef, {
      time: "fora",
      perguntaId: p.id,
      pergunta: p.pergunta,
      alternativas: p.alternativas,
      correta: p.correta,
      pontuacao: p.pontuacao || 1,
      ordem: index
    });
  });

  await batch.commit();

  ordemJaSalva = true;
  document.getElementById("btnEmbaralhar").style.display = "none";

  exibirOrdemNaTabela('casa');
  exibirOrdemNaTabela('fora');
}


function exibirOrdemNaTabela(lado) {
  const container = document.getElementById(`tabela-${lado}`);
  if (!container) return;

  container.innerHTML = '';
  ordemPerguntas[lado].forEach((p, index) => {
    const linha = document.createElement("tr");
    const texto = document.createElement("td");
    const correta = document.createElement("td");
    const pontos = document.createElement("td");
    const status = document.createElement("td");

    texto.textContent = p.pergunta;
    correta.textContent = p.alternativas[p.correta] || '-';
    pontos.textContent = p.pontuacao || 1;
    status.textContent = index < indiceAtual[lado] ? '✔' : '';

    linha.appendChild(texto);
    linha.appendChild(correta);
    linha.appendChild(pontos);
    linha.appendChild(status);
    container.appendChild(linha);
  });
}

async function enviarProximaPergunta(lado) {
  const lista = ordemPerguntas[lado];
  const idx = indiceAtual[lado];

  if (!lista || idx >= lista.length) {
    alert("Todas as perguntas já foram usadas.");
    return;
  }

  const pergunta = lista[idx];
  indiceAtual[lado]++;
  exibirOrdemNaTabela(lado);

  const chatRef = `chats_jogo/${jogoId}/${lado}`;
  const divId = lado === "casa" ? "chatTimeA" : "chatTimeB";

  await db.collection(chatRef).add({
    tipo: "pergunta",
    perguntaId: pergunta.perguntaId || pergunta.id,
    texto: pergunta.pergunta,
    alternativas: pergunta.alternativas,
    correta: pergunta.correta,
    pontuacao: pergunta.pontuacao || 1,
    criadoEm: new Date()
  });

  await db.collection(`jogos/${jogoId}/perguntas_enviadas`).doc(pergunta.perguntaId || pergunta.id).set({
    perguntaId: pergunta.perguntaId || pergunta.id,
    time: lado,
    enviadaEm: new Date()
  });

  exibirPerguntaNoChat(document.getElementById(divId), pergunta, true, lado);
}

carregarJogo();
// [FIM DO ARQUIVO]


async function carregarOuCriarOrdemDePerguntas() {
  const ref = db.collection(`jogos/${jogoId}/perguntas_ordenadas`);
  const snap = await ref.get();

  if (!snap.empty) {
    ordemJaSalva = true;
    const perguntas = { casa: [], fora: [] };
    snap.forEach(doc => {
      const data = doc.data();
      if (data.time === 'casa') perguntas.casa.push(data);
      if (data.time === 'fora') perguntas.fora.push(data);
    });
    ordemPerguntas.casa = perguntas.casa;
    ordemPerguntas.fora = perguntas.fora;

    if (document.getElementById("btnEmbaralhar")) {
      document.getElementById("btnEmbaralhar").style.display = "none";
    }
  } else {
    if (document.getElementById("btnEmbaralhar")) {
      document.getElementById("btnEmbaralhar").style.display = "inline-block";
    }
  }

  const enviadasSnap = await db.collection(`jogos/${jogoId}/perguntas_enviadas`).get();
  const enviadas = { casa: new Set(), fora: new Set() };
  enviadasSnap.forEach(doc => {
    const data = doc.data();
    if (data.time === 'casa') enviadas.casa.add(data.perguntaId);
    if (data.time === 'fora') enviadas.fora.add(data.perguntaId);
  });

  indiceAtual.casa = ordemPerguntas.casa.findIndex(p => !enviadas.casa.has(p.perguntaId));
  indiceAtual.fora = ordemPerguntas.fora.findIndex(p => !enviadas.fora.has(p.perguntaId));
  if (indiceAtual.casa === -1) indiceAtual.casa = ordemPerguntas.casa.length;
  if (indiceAtual.fora === -1) indiceAtual.fora = ordemPerguntas.fora.length;

  exibirOrdemNaTabela('casa');
  exibirOrdemNaTabela('fora');
}
