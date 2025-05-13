import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

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
const jogoId = "NO2daW1tWuSYRxYmHfc4";

async function carregarRanking() {
  const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId));
  const snapshot = await getDocs(q);

  let totalA = 0;
  let totalB = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.timeTorcido === "A") totalA++;
    if (data.timeTorcido === "B") totalB++;
  });

  const tbody = document.querySelector("#rankingTable tbody");
  tbody.innerHTML = `
    <tr><td>Time A</td><td>${totalA}</td></tr>
    <tr><td>Time B</td><td>${totalB}</td></tr>
  `;
}

carregarRanking();