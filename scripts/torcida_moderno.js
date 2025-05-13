import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

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

function atualizarBarras(a, b) {
  const total = a + b;
  const percA = total ? Math.round((a / total) * 100) : 0;
  const percB = total ? Math.round((b / total) * 100) : 0;

  document.getElementById("porcentagemA").textContent = percA + "%";
  document.getElementById("porcentagemB").textContent = percB + "%";
  document.getElementById("barraA").style.width = percA + "%";
  document.getElementById("barraB").style.width = percB + "%";
}

async function carregar() {
  const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId));
  const snapshot = await getDocs(q);

  let a = 0, b = 0;
  snapshot.forEach(doc => {
    const d = doc.data();
    if (d.timeTorcido === "A") a++;
    if (d.timeTorcido === "B") b++;
  });

  atualizarBarras(a, b);
}

window.torcer = async function (time) {
  const user = auth.currentUser;
  if (!user) return alert("Faça login antes de torcer.");

  const uid = user.uid;
  const q = query(collection(db, "torcidas"), where("jogoId", "==", jogoId), where("uid", "==", uid));
  const snap = await getDocs(q);

  if (!snap.empty) {
    const anterior = snap.docs[0].data().timeTorcido;
    if (anterior === time) return alert("Você já torceu por esse time.");
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
  await carregar();
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("userEmail").textContent = user.email;
  }
});

window.logout = () => {
  signOut(auth).then(() => location.reload());
};

carregar();