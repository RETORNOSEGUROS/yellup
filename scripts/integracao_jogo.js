import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const jogoId = "NO2daW1tWuSYRxYmHfc4";

async function carregarDados() {
  const jogoRef = doc(db, "jogos", jogoId);
  const jogoSnap = await getDoc(jogoRef);
  if (!jogoSnap.exists()) return;

  const jogo = jogoSnap.data();
  document.getElementById("nomeJogo").textContent = `${jogo.timeA_nome} vs ${jogo.timeB_nome}`;
  document.getElementById("nomeTimeA").textContent = jogo.timeA_nome;
  document.getElementById("nomeTimeB").textContent = jogo.timeB_nome;
  document.getElementById("pontosA").textContent = jogo.pontosA ?? 0;
  document.getElementById("pontosB").textContent = jogo.pontosB ?? 0;

  const torcidasQ = query(collection(db, "torcidas"), where("jogoId", "==", jogoId));
  const torcidasSnap = await getDocs(torcidasQ);

  let a = 0, b = 0;
  torcidasSnap.forEach(doc => {
    const t = doc.data();
    if (t.timeTorcido === "A") a++;
    if (t.timeTorcido === "B") b++;
  });

  document.getElementById("torcidaA").textContent = a;
  document.getElementById("torcidaB").textContent = b;

  const total = a + b;
  document.getElementById("barraA").style.width = (total ? (a / total) * 100 : 0) + "%";
  document.getElementById("barraB").style.width = (total ? (b / total) * 100 : 0) + "%";
}

onAuthStateChanged(auth, async user => {
  if (!user) return;
  document.getElementById("userEmail")?.innerText = user.email;

  const userRef = doc(db, "usuarios", user.uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const u = userSnap.data();
    document.getElementById("creditos").textContent = u.creditos ?? 0;
  }
});

carregarDados();