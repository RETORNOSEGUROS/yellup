
const firebaseConfig = {
    apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
    authDomain: "painel-yellup.firebaseapp.com",
    projectId: "painel-yellup",
    storageBucket: "painel-yellup.appspot.com",
    messagingSenderId: "608347210297",
    appId: "1:608347210297:web:75092713724e617c7203e8",
    measurementId: "G-SYZ16X31KQ"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        alert("Você precisa estar logado para acessar esta página.");
        window.location.href = "index.html";
        return;
    }

    try {
        const userDoc = await db.collection("usuarios").doc(user.uid).get();
        if (!userDoc.exists) throw new Error("Usuário não encontrado no banco de dados.");

        const data = userDoc.data();
        document.getElementById("usuarioNome").textContent = data.nome || user.email;
        document.getElementById("usuarioTime").textContent = data.timeId || "Não informado";
        document.getElementById("usuarioCreditos").textContent = data.creditos ?? 0;
    } catch (error) {
        console.error("Erro ao buscar dados do usuário:", error);
        alert("Erro ao carregar dados. Tente novamente.");
    }
});

function logout() {
    auth.signOut().then(() => {
        window.location.href = "index.html";
    });
}
