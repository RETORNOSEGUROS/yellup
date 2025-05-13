
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, getDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8",
  measurementId: "G-SYZ16X31KQ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth();
const provider = new GoogleAuthProvider();

const jogoId = "NO2daW1tWuSYRxYmHfc4";

async function carregarJogo() {
  const jogoDoc = await getDoc(doc(db, "jogos", jogoId));
  if (jogoDoc.exists()) {
    const jogo = jogoDoc.data();
    document.getElementById("nomeJogo").textContent = jogo.nome;
    document.getElementById("timeA").textContent = "Time A";
    document.getElementById("timeB").textContent = "Time B";
  }
}

async function carregarTorcidas() {
  const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId));
  const snapshot = await getDocs(q);
  let torcedoresA = 0, torcedoresB = 0;

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.timeTorcido === "A") torcedoresA++;
    if (data.timeTorcido === "B") torcedoresB++;
  });

  const total = torcedoresA + torcedoresB;
  const percA = total ? Math.round((torcedoresA / total) * 100) : 0;
  const percB = total ? Math.round((torcedoresB / total) * 100) : 0;

  document.getElementById("porcentagemA").textContent = `${percA}%`;
  document.getElementById("porcentagemB").textContent = `${percB}%`;
}

window.torcer = async function (time) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      alert("Você precisa estar logado para torcer!");
      return;
    }

    const uid = user.uid;

    const q = query(collection(db, "torcidas"),
      where("jogoId", "==", jogoId),
      where("uid", "==", uid)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      alert("Você já torceu neste jogo.");
      return;
    }

    await addDoc(collection(db, "torcidas"), {
      jogoId: jogoId,
      timeTorcido: time,
      uid: uid,
      timestamp: new Date()
    });

    alert("Torcida registrada com sucesso!");
    location.reload();
  });
};

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.log("Logado como:", user.email);
  } catch (error) {
    alert("Erro ao logar: " + error.message);
  }
});

carregarJogo();
carregarTorcidas();
