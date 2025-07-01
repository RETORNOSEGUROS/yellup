// painel-jogo.js COMPLETO - estrutura mantida, marcação da alternativa correta baseada na letra do Firestore

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get('id');
let dadosJogo = null;

function carregarDadosJogo() {
  if (!jogoId) return;

  db.collection('jogos').doc(jogoId).get().then((doc) => {
    if (doc.exists) {
      dadosJogo = doc.data();
      document.querySelector('h1').innerHTML = `🎮 ${dadosJogo.timeCasaNome} vs ${dadosJogo.timeVisitanteNome}`;
      document.querySelector('#inicio').innerHTML = `🕓 Início: ${dadosJogo.data}`;
      document.querySelector('#entrada').innerHTML = `💳 Entrada: ${dadosJogo.creditos} crédito(s)`;
    }
  });
}

function exibirPerguntaNoChat(div, pergunta, animar = false) {
  const bloco = document.createElement("div");
  bloco.className = "pergunta-bloco";
  bloco.setAttribute("data-id", pergunta.perguntaId || pergunta.id || "");

  const texto = pergunta.pergunta || pergunta.texto || "Pergunta sem texto";

  const alternativasObj = pergunta.alternativas || {};
  const letras = Object.keys(alternativasObj).sort();

  const corretaLetra = (pergunta.correta || "").toUpperCase();

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

  letras.forEach(letra => {
    const altTexto = alternativasObj[letra];
    const item = document.createElement("li");
    item.textContent = `${letra}) ${altTexto}`;
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

  if (animar) {
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
        items.forEach(item => {
          const letra = item.dataset.letra;

          item.style.cursor = "default";
          item.style.color = "#999";
          item.style.fontWeight = "normal";
          item.style.textDecoration = "none";

          if (letra === corretaLetra) {
            item.style.background = "#d4edda";
            item.style.color = "#155724";
            item.style.borderColor = "#c3e6cb";
            item.style.fontWeight = "bold";
          }

          if (letra === selecionadoLetra && letra !== corretaLetra) {
            item.style.background = "#f8d7da";
            item.style.color = "#721c24";
            item.style.borderColor = "#f5c6cb";
            item.style.textDecoration = "line-through";
          }
        });
      }
    }, 1000);

    const items = lista.querySelectorAll("li");
    items.forEach(item => {
      item.style.cursor = "pointer";
      item.onclick = () => {
        if (tempo > 0) {
          selecionadoLetra = item.dataset.letra;
          items.forEach(li => li.style.fontWeight = "normal");
          item.style.fontWeight = "bold";
        }
      };
    });
  }
}

function sortearPerguntaPorTime(timeId, destinoChatId) {
  console.log("Buscando perguntas para timeId:", timeId);

  db.collection("perguntas")
    .where("timeId", "==", timeId)
    .get()
    .then((querySnapshot) => {
      const perguntas = [];
      querySnapshot.forEach((doc) => perguntas.push({ id: doc.id, ...doc.data() }));

      if (perguntas.length === 0) {
        alert("Nenhuma pergunta encontrada para este time.");
        return;
      }

      const pergunta = perguntas[Math.floor(Math.random() * perguntas.length)];

      const div = document.getElementById(destinoChatId);
      exibirPerguntaNoChat(div, pergunta, true);
    })
    .catch((error) => {
      console.error("Erro ao buscar perguntas:", error);
      alert("Erro ao buscar perguntas. Verifique o console.");
    });
}

document.getElementById("sortear-time-a").addEventListener("click", () => {
  if (!dadosJogo || !dadosJogo.timeCasaId) return;
  sortearPerguntaPorTime(dadosJogo.timeCasaId, "chat-casa");
});

document.getElementById("sortear-time-b").addEventListener("click", () => {
  if (!dadosJogo || !dadosJogo.timeVisitanteId) return;
  sortearPerguntaPorTime(dadosJogo.timeVisitanteId, "chat-visitante");
});

window.onload = carregarDadosJogo;
