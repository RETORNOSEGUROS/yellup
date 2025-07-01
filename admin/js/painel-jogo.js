let perguntasUsadas = { casa: [], fora: [] };
const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let timeCasaId = "";
let timeForaId = "";
let nomeCasa = "Time A";
let nomeFora = "Time B";
let bloqueioChat = false;
const filaMensagens = { geral: [], timeA: [], timeB: [] };
let pontosPorTime = { casa: 0, fora: 0 };
let ordemTravada = false;

let ordemPerguntas = { casa: [], fora: [] };
let indiceAtual = { casa: 0, fora: 0 };

async function carregarJogo() {
  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  if (!jogoDoc.exists) return;

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

  document.getElementById("btnPerguntaCasa").textContent = `+ Sortear Pergunta ${nomeCasa}`;
  document.getElementById("btnPerguntaFora").textContent = `+ Sortear Pergunta ${nomeFora}`;

  escutarChats();
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
    snapshot.docChanges().forEach(change => {
      if (change.type === "added") {
        const msg = change.doc.data();
        if (msg.tipo === "pergunta" && msg.perguntaId && msg.alternativas) {
          exibirPerguntaNoChat(div, msg, false, divId.includes("TimeA") ? "casa" : "fora");
        } else {
          const linha = document.createElement("div");
          const hora = msg.criadoEm?.toDate()?.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' }) || "--:--";
          linha.textContent = `[${hora}] ${msg.admin ? "[ADMIN] " : ""}${msg.texto}`;
          div.appendChild(linha);
        }
        div.scrollTop = div.scrollHeight;
      }
    });
  });
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

function embaralhar(lista) {
  return lista.sort(() => Math.random() - 0.5);
}

async function buscarPerguntasPorTimeId(timeId) {
  const snapshot = await db.collection("perguntas").where("timeId", "==", timeId).get();
  const perguntas = [];
  snapshot.forEach(doc => perguntas.push({ id: doc.id, ...doc.data() }));
  return perguntas;
}

async function embaralharOrdemPerguntas() {
  if (ordemTravada) {
    alert("A ordem já foi travada e não pode mais ser alterada.");
    return;
  }

  const perguntasCasa = await buscarPerguntasPorTimeId(timeCasaId);
  const perguntasFora = await buscarPerguntasPorTimeId(timeForaId);

  ordemPerguntas.casa = embaralhar(perguntasCasa);
  ordemPerguntas.fora = embaralhar(perguntasFora);

  indiceAtual.casa = 0;
  indiceAtual.fora = 0;

  exibirOrdemNaTabela('casa');
  exibirOrdemNaTabela('fora');
}

async function travarOrdemPerguntas() {
  await salvarOrdemNoFirestore();
  ordemTravada = true;

  const btn = document.querySelector("button[onclick='embaralharOrdemPerguntas()']");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "✅ Ordem Travada";
  }

  alert("✅ Ordem de perguntas travada.");
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
    status.textContent = perguntasUsadas[lado] && perguntasUsadas[lado].includes(p.id) ? '✔' : '';

    linha.appendChild(texto);
    linha.appendChild(correta);
    linha.appendChild(pontos);
    linha.appendChild(status);
    container.appendChild(linha);
  });
}

async function registrarPerguntaComoUsada(lado, perguntaId) {
  const ref = db.collection("jogos").doc(jogoId).collection("perguntas_enviadas").doc(lado);
  const docSnap = await ref.get();
  let ids = [];
  if (docSnap.exists) {
    ids = docSnap.data().ids || [];
  }
  if (!ids.includes(perguntaId)) {
    ids.push(perguntaId);
    await ref.set({ ids });
  }
}

async function enviarProximaPergunta(lado) {
  const lista = ordemPerguntas[lado];
  const idx = indiceAtual[lado];

  if (!lista || idx >= lista.length) {
    alert("Todas as perguntas já foram usadas.");
    return;
  }

  const pergunta = lista[idx];
  await registrarPerguntaComoUsada(lado, pergunta.id);
  perguntasUsadas[lado].push(pergunta.id);
  indiceAtual[lado]++;
  exibirOrdemNaTabela(lado);

  const chatRef = `chats_jogo/${jogoId}/${lado}`;
  const divId = lado === "casa" ? "chatTimeA" : "chatTimeB";

  await db.collection(chatRef).add({
    tipo: "pergunta",
    perguntaId: pergunta.id,
    texto: pergunta.pergunta,
    alternativas: pergunta.alternativas,
    correta: pergunta.correta,
    pontuacao: pergunta.pontuacao || 1,
    criadoEm: new Date()
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

async function carregarOrdemSalva() {
  const jogoDoc = await db.collection("jogos").doc(jogoId).get();
  if (!jogoDoc.exists) return false;

  const dados = jogoDoc.data();
  if (dados.ordemPerguntasCasa && dados.ordemPerguntasFora) {
    const perguntasCasa = await buscarPerguntasPorTimeId(timeCasaId);
    const perguntasFora = await buscarPerguntasPorTimeId(timeForaId);

    ordemPerguntas.casa = dados.ordemPerguntasCasa.map(id => perguntasCasa.find(p => p.id === id)).filter(Boolean);
    ordemPerguntas.fora = dados.ordemPerguntasFora.map(id => perguntasFora.find(p => p.id === id)).filter(Boolean);

    indiceAtual.casa = dados.indicePerguntaCasa || 0;
    indiceAtual.fora = dados.indicePerguntaFora || 0;

    ordemTravada = true;

    const btn = document.querySelector("button[onclick='embaralharOrdemPerguntas()']");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "✅ Ordem Travada";
    }

    return true;
  }

  return false;
}

async function carregarPerguntasEnviadas() {
  const snapCasa = await db.collection("jogos").doc(jogoId).collection("perguntas_enviadas").doc("casa").get();
  const snapFora = await db.collection("jogos").doc(jogoId).collection("perguntas_enviadas").doc("fora").get();

  if (snapCasa.exists) {
    const usados = snapCasa.data().ids || [];
    perguntasUsadas.casa = usados;
    usados.forEach(id => {
      const index = ordemPerguntas.casa.findIndex(p => p.id === id);
      if (index >= 0) indiceAtual.casa = Math.max(indiceAtual.casa, index + 1);
    });
  }

  if (snapFora.exists) {
    const usados = snapFora.data().ids || [];
    perguntasUsadas.fora = usados;
    usados.forEach(id => {
      const index = ordemPerguntas.fora.findIndex(p => p.id === id);
      if (index >= 0) indiceAtual.fora = Math.max(indiceAtual.fora, index + 1);
    });
  }

  exibirOrdemNaTabela("casa");
  exibirOrdemNaTabela("fora");
}

async function salvarOrdemNoFirestore() {
  const jogoRef = db.collection("jogos").doc(jogoId);
  await jogoRef.update({
    ordemPerguntasCasa: ordemPerguntas.casa.map(p => p.id),
    ordemPerguntasFora: ordemPerguntas.fora.map(p => p.id),
    indicePerguntaCasa: 0,
    indicePerguntaFora: 0
  });
}

// ✅ Função principal com ordem correta
async function iniciarSistema() {
  await carregarJogo();                        // 1. Pega dados do jogo e times
  await carregarOrdemSalva();                 // 2. Carrega ordem travada (se houver)
  await carregarPerguntasEnviadas();          // 3. Marca ✔ perguntas já usadas
  await carregarPontosDoFirestore();          // 4. Recupera pontos dos times
  atualizarPlacar();                          // 5. Mostra na tela
}

iniciarSistema();
