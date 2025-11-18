// ===================================
// 🔥 FIREBASE CONFIGURATION
// ===================================
const firebaseConfig = {
  apiKey: "AIzaSyBnovRVr4yFSLD24MbKICPHqmTTS6K0i4E",
  authDomain: "yellup-8f97a.firebaseapp.com",
  projectId: "yellup-8f97a",
  storageBucket: "yellup-8f97a.firebasestorage.app",
  messagingSenderId: "343470541606",
  appId: "1:343470541606:web:6b4c65d999f61e74f2b6fb"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Services
const db = firebase.firestore();
const auth = firebase.auth();

// ===================================
// 🔐 CONFIGURAR PERSISTÊNCIA LOCAL
// ===================================
// IMPORTANTE: Isso mantém o usuário logado mesmo após fechar o navegador
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .then(() => {
    console.log("✅ Persistência de autenticação configurada (LOCAL)");
  })
  .catch((error) => {
    console.error("❌ Erro ao configurar persistência:", error);
  });

// ===================================
// 📊 LOG DE ESTADO DE AUTENTICAÇÃO
// ===================================
auth.onAuthStateChanged((user) => {
  if (user) {
    console.log("✅ Usuário autenticado:", user.uid);
    console.log("📧 Email:", user.email);
  } else {
    console.log("❌ Nenhum usuário autenticado");
  }
});

console.log("🔥 Firebase inicializado com sucesso!");

