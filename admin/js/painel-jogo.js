const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

let timeCasaId = "";
let timeForaId = "";
let nomeCasa = "Time A";
let nomeFora = "Time B";

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

  escutarChats();
}

function enviarMensagem(tipo) {
  const input = document.getElementById(`input${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`);
  const texto = input.value.trim();
  if (!texto) return;

  const caminho = tipo === "geral" ? `chats_jogo/${jogoId}/geral`
    : tipo === "timeA" ? `chats_jogo/${jogoId}/casa`
    : `chats_jogo/${jogoId}/fora`;

  db.collection(caminho).add({
    texto,
    admin: true,
    criadoEm: new Date()
  });

  input.value = "";
}

function escutarChats() {
  escutarChat(`chats_jogo/${jogoId}/geral`, "chatGeral");
  escutarChat(`chats_jogo/${jogoId}/casa`, "chatTimeA");
  escutarChat(`chats_jogo/${jogoId}/fora`, "chatTimeB");
}

function escutarChat(caminho, divId) {
  db.collection(caminho).orderBy("criadoEm").onSnapshot(snapshot => {
    const div = document.getElementById(divId);
    snapshot.forEach(doc => {
      const msg = doc.data();
      if (msg.tipo === "pergunta" && msg.perguntaId && msg.alternativas) {
        if (msg.criadoEm && msg.criadoEm.toDate) {
          const agora = new Date();
          const segundos = (agora - msg.criadoEm.toDate()) / 1000;
          const animar = segundos < 2;

          const existe = div.querySelector(`[data-id="${msg.perguntaId}"]`);
          if (!existe) {
            exibirPerguntaNoChat(div, msg, animar);
          }
        }
      } else {
        const linha = document.createElement("div");
        linha.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
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

  const perguntas = await buscarPerguntasPorTimeId(timeId);
  if (perguntas.length === 0) {
    alert("Esse time não possui perguntas cadastradas.");
    return;
  }

  const pergunta = perguntas[Math.floor(Math.random() * perguntas.length)];

  await db.collection(chatRef).add({
    tipo: "pergunta",
    perguntaId: pergunta.id,
    texto: pergunta.pergunta,
    alternativas: pergunta.alternativas,
    correta: pergunta.correta,
    criadoEm: new Date()
  });

  exibirPerguntaNoChat(document.getElementById(divId), pergunta, true);
}

function exibirPerguntaNoChat(div, pergunta, animar = false) {
  const bloco = document.createElement("div");
  bloco.className = "pergunta-bloco";
  bloco.setAttribute("data-id", pergunta.perguntaId || pergunta.id || "");

  const texto = pergunta.pergunta || pergunta.texto || "Pergunta sem texto";

  let alternativas = [];
  if (Array.isArray(pergunta.alternativas)) {
    alternativas = pergunta.alternativas;
  } else if (typeof pergunta.alternativas === "object") {
    alternativas = Object.keys(pergunta.alternativas).map(letra => pergunta.alternativas[letra]);
  }

  // Converte correta: aceita 'A', 'B', 'C', ..., ou índice numérico
  const correta = (() => {
    if (typeof pergunta.correta === "number") return pergunta.correta;
    if (typeof pergunta.correta === "string") {
      const letra = pergunta.correta.toUpperCase();
      return ["A", "B", "C", "D", "E"].indexOf(letra);
    }
    return -1;
  })();

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

  alternativas.forEach((alt, i) => {
    const item = document.createElement("li");
    item.textContent = `${String.fromCharCode(65 + i)}) ${alt}`;
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
    let tempo = 9;
    let selecionado = -1;
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
        items.forEach((el, i) => {
          el.style.cursor = "default";
          el.style.color = "#999";
          el.style.fontWeight = "normal";
          el.style.textDecoration = "none";

          if (i === correta) {
            el.style.background = "#d4edda";
            el.style.color = "#155724";
            el.style.borderColor = "#c3e6cb";
            el.style.fontWeight = "bold";
          }

          if (i === selecionado && i !== correta) {
            el.style.background = "#f8d7da";
            el.style.color = "#721c24";
            el.style.borderColor = "#f5c6cb";
            el.style.textDecoration = "line-through";
          }
        });
      }
    }, 1000);

    const items = lista.querySelectorAll("li");
    items.forEach((el, idx) => {
      el.style.cursor = "pointer";
      el.onclick = () => {
        if (tempo > 0) {
          selecionado = idx;
          items.forEach(li => li.style.fontWeight = "normal");
          el.style.fontWeight = "bold";
        }
      };
    });
  }
}

carregarJogo();
