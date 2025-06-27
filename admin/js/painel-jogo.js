// admin/js/painel-jogo.js
import { db } from '../../firebase-init.js';
import { doc, getDoc, collection, addDoc, serverTimestamp, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';

const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");

const spanTitulo = document.getElementById("tituloJogo");
const spanInicio = document.getElementById("dataInicio");
const spanEntrada = document.getElementById("valorEntrada");

const chatBox = document.getElementById("chatBox");
const inputMensagem = document.getElementById("inputMensagem");
const btnEnviar = document.getElementById("btnEnviar");

// Dados do Jogo
async function carregarJogo() {
  const docRef = doc(db, "jogos", jogoId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return;
  const jogo = snap.data();
  spanTitulo.innerText = `${jogo.timeCasa?.nome || 'Time A'} vs ${jogo.timeFora?.nome || 'Time B'}`;
  spanInicio.innerText = new Date(jogo.dataInicio?.seconds * 1000).toLocaleString();
  spanEntrada.innerText = `${jogo.valorEntrada || 0} crédito(s)`;
}

// Enviar Mensagem
btnEnviar.addEventListener("click", async () => {
  const texto = inputMensagem.value.trim();
  if (!texto) return;
  await addDoc(collection(db, `chats_jogo/${jogoId}/geral`), {
    texto,
    admin: true,
    criadoEm: serverTimestamp(),
  });
  inputMensagem.value = "";
});

// Ouvir mensagens do chat geral
function ouvirChatGeral() {
  const q = query(collection(db, `chats_jogo/${jogoId}/geral`), orderBy("criadoEm", "asc"));
  onSnapshot(q, (snap) => {
    chatBox.innerHTML = "";
    snap.forEach(doc => {
      const msg = doc.data();
      const el = document.createElement("div");
      el.textContent = (msg.admin ? "[ADMIN] " : "") + msg.texto;
      chatBox.appendChild(el);
    });
  });
}

carregarJogo();
ouvirChatGeral();
