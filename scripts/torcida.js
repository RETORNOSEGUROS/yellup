
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.firebasestorage.app",
  messagingSenderId: "608347210297",
  appId: "1:608347210297:web:75092713724e617c7203e8",
  measurementId: "G-SYZ16X31KQ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const jogoId = "NO2daW1WuSYRxYmHfc4";

async function carregarTorcidas() {
  const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId));
  const snapshot = await getDocs(q);

  let torcedoresA = 0, torcedoresB = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.timeTorcido === "A") torcedoresA++;
    if (data.timeTorcido === "B") torcedoresB++;
  });

  const total = torcedoresA + torcedoresB;
  const percA = total ? Math.round((torcedoresA / total) * 100) : 0;
  const percB = total ? Math.round((torcedoresB / total) * 100) : 0;

  document.getElementById("porcentagemA").textContent = `${percA}%`;
  document.getElementById("porcentagemB").textContent = `${percB}%`;
  document.getElementById("barraA").style.width = `${percA}%`;
  document.getElementById("barraB").style.width = `${percB}%`;

  const jogoDoc = await getDoc(doc(db, "jogos", jogoId));
  if (jogoDoc.exists()) {
    const jogo = jogoDoc.data();
    document.getElementById("nomeJogo").textContent = jogo.nome;
    document.getElementById("timeA").textContent = `Time A`;
    document.getElementById("timeB").textContent = `Time B`;
  }
}

carregarTorcidas();

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

const provider = new GoogleAuthProvider();

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("userInfo").style.display = "block";
  } catch (error) {
    alert("Erro ao logar: " + error.message);
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("userInfo").style.display = "block";
  }
});

// Declaração única do provider fora de bloco
const provider = new GoogleAuthProvider();

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("userInfo").style.display = "block";
  } catch (error) {
    console.warn("Erro ao logar: " + error.message);
    // Simular login com UID fixo
    window.simulatedUser = { uid: "uid_teste_simulado", email: "teste@yellup.app" };
    alert("Login simulado ativado para testes.");
    carregarEstadoSimulado();
  }
});

function carregarEstadoSimulado() {
  document.getElementById("userEmail").textContent = simulatedUser.email;
  document.getElementById("loginBtn").style.display = "none";
  document.getElementById("userInfo").style.display = "block";
}

onAuthStateChanged(auth, async (user) => {
  if (!user && typeof simulatedUser !== "undefined") {
    user = simulatedUser;
  }

  if (user) {
    document.getElementById("userEmail").textContent = user.email;
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("userInfo").style.display = "block";

    try {
      const q = query(collection(db, "torcidas"),
        where("jogoId", "==", jogoId),
        where("uid", "==", user.uid)
      );
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const voto = snapshot.docs[0].data().timeTorcido;

        const jogoDoc = await getDoc(doc(db, "jogos", jogoId));
        if (jogoDoc.exists()) {
          const jogo = jogoDoc.data();
          const nomeTime = voto === "A" ? (jogo.timeA_nome || "Time A") : (jogo.timeB_nome || "Time B");
          document.getElementById("torcidaStatus").textContent = `Você já torceu pelo ${nomeTime}`;
        }
      }
    } catch (error) {
      console.error("Erro ao verificar torcida existente:", error);
    }
  }
}

window.torcer = async function (timeNovo) {
  let user = auth.currentUser;
  if (!user && typeof simulatedUser !== "undefined") {
    user = simulatedUser;
  }

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
    const docExistente = snapshot.docs[0];
    const votoAtual = docExistente.data().timeTorcido;

    if (votoAtual === timeNovo) {
      alert("Você já torceu por esse time.");
      return;
    }

    const jogoDoc = await getDoc(doc(db, "jogos", jogoId));
    let nomeAtual = votoAtual;
    let nomeNovo = timeNovo;
    if (jogoDoc.exists()) {
      const jogo = jogoDoc.data();
      nomeAtual = votoAtual === "A" ? (jogo.timeA_nome || "Time A") : (jogo.timeB_nome || "Time B");
      nomeNovo = timeNovo === "A" ? (jogo.timeA_nome || "Time A") : (jogo.timeB_nome || "Time B");
    }

    const confirmar = confirm(`Você já torceu pelo ${nomeAtual}. Deseja trocar seu voto para ${nomeNovo}?`);
    if (!confirmar) return;

    await deleteDoc(doc(db, "torcidas", docExistente.id));
  }

  await addDoc(collection(db, "torcidas"), {
    jogoId: jogoId,
    timeTorcido: timeNovo,
    uid: uid,
    timestamp: new Date()
  });

  alert("Voto registrado com sucesso!");
  location.reload();
};
