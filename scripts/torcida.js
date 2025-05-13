import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SUA_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_BUCKET",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const jogoId = "NO2daW1tWuSYRxYmHfc4";

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    alert("Erro ao logar: " + error.message);
  }
});

window.onload = carregar;

async function carregar() {
  const jogoRef = doc(db, "jogos", jogoId);
  const jogoSnap = await getDoc(jogoRef);
  if (!jogoSnap.exists()) return;

  const jogo = jogoSnap.data();
  document.getElementById("statusJogo").textContent = jogo.nome;
  document.getElementById("timeA").textContent = "Time A";
  document.getElementById("timeB").textContent = "Time B";

  await atualizar();
}

async function atualizar() {
  const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId));
  const snap = await getDocs(q);

  let a = 0, b = 0;
  snap.forEach(doc => {
    const d = doc.data();
    if (d.timeTorcido === "A") a++;
    if (d.timeTorcido === "B") b++;
  });

  const total = a + b;
  const percA = total ? Math.round((a / total) * 100) : 0;
  const percB = total ? Math.round((b / total) * 100) : 0;

  document.getElementById("porcentagemA").textContent = percA + "%";
  document.getElementById("porcentagemB").textContent = percB + "%";
}

window.torcer = async function (time) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return alert("Você precisa estar logado para torcer!");

    const uid = user.uid;
    const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId), where("uid", "==", uid));
    const snap = await getDocs(q);

    if (!snap.empty) {
      const anterior = snap.docs[0].data().timeTorcido;
      if (anterior === time) {
        alert("Você já torceu por esse time.");
        return;
      }
      const confirmar = confirm(`Você já torceu pelo Time ${anterior}. Deseja mudar para o Time ${time}?`);
      if (!confirmar) return;
    }

    await addDoc(collection(db, "torcidas"), {
      jogoId,
      timeTorcido: time,
      uid,
      timestamp: new Date()
    });

    alert("Torcida registrada!");
    await atualizar();
  });
}