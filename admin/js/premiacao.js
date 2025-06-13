// Inicializa conexão com Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "SUA-CHAVE",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.appspot.com",
  messagingSenderId: "SEUID",
  appId: "SUA-ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Função principal de ranking
async function gerarRanking() {
    const inicio = document.getElementById("dataInicio").value;
    const fim = document.getElementById("dataFim").value;
    const tipo = document.getElementById("tipoPremiacao").value;
    const limite = parseInt(document.getElementById("limite").value);

    const data1 = Timestamp.fromDate(new Date(inicio));
    const data2 = Timestamp.fromDate(new Date(fim));

    let usuariosRef = collection(db, "usuarios");
    let filtro = query(usuariosRef, where("dataCadastro", ">=", data1), where("dataCadastro", "<=", data2));

    const snapshot = await getDocs(filtro);
    let dados = [];

    snapshot.forEach(doc => {
        const user = doc.data();
        if (tipo === 'time') {
            // aqui você pode filtrar o timeId se desejar futuramente
            if (!user.timeId) return;
        }
        dados.push(user);
    });

    dados.sort((a, b) => b.pontuacao - a.pontuacao);
    dados = dados.slice(0, limite);

    const tbody = document.getElementById("resultado");
    tbody.innerHTML = "";

    dados.forEach((user, i) => {
        const linha = document.createElement("tr");
        linha.innerHTML = `
            <td>${i + 1}</td>
            <td>${user.nome || user.email}</td>
            <td>${user.pontuacao}</td>
            <td><input type="number" value="0"></td>
            <td><button>Pagar</button></td>
        `;
        tbody.appendChild(linha);
    });
}
