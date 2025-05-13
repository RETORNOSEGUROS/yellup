
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7F-SEU-VALOR-REAL",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "75092713724",
  appId: "1:75092713724:web:EXEMPLOID"
};
  apiKey: "SUA_API_KEY",
  authDomain: "painel-yellup.firebaseapp.com",
  projectId: "painel-yellup",
  storageBucket: "painel-yellup.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const jogoId = "NO2daW1WuSYRxYmHfc4"; // Fixado por agora

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
