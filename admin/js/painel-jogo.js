firebase.initializeApp({
    apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
    authDomain: "painel-yellup.firebaseapp.com",
    projectId: "painel-yellup"
});
const db = firebase.firestore();

const urlParams = new URLSearchParams(window.location.search);
const jogoId = urlParams.get("id");
let timeAId = "", timeBId = "";

db.collection("jogos").doc(jogoId).get().then(doc => {
    const data = doc.data();
    document.getElementById("tituloJogo").textContent = `${data.timeA} vs ${data.timeB}`;
    document.getElementById("inicioJogo").textContent = new Date(data.dataHora._seconds * 1000).toLocaleString("pt-BR");
    document.getElementById("entradaJogo").textContent = `${data.creditoEntrada} crédito(s)`;
    timeAId = data.timeAId;
    timeBId = data.timeBId;
    escutarChats();
});

function escutarChats() {
    escutarChat("geral", "chatGeral");
    escutarChat("timeA", "chatTimeA");
    escutarChat("timeB", "chatTimeB");
}

function escutarChat(tipo, divId) {
    db.collection("chats_jogo")
        .where("jogoId", "==", jogoId)
        .where("tipo", "==", tipo)
        .orderBy("criadoEm")
        .onSnapshot(snapshot => {
            const div = document.getElementById(divId);
            div.innerHTML = "";
            snapshot.forEach(doc => {
                const msg = doc.data();
                const linha = document.createElement("div");
                if (msg.mensagem?.startsWith("[PERGUNTA]")) {
                    linha.className = "pergunta";
                    linha.innerHTML = `<div class='timer-bar'></div> ${msg.mensagem}`;
                } else {
                    linha.textContent = msg.mensagem;
                }
                div.appendChild(linha);
            });
        });
}

function enviarMensagem(tipo) {
    const input = document.getElementById("input" + tipo.charAt(0).toUpperCase() + tipo.slice(1));
    const texto = input.value;
    if (!texto.trim()) return;
    db.collection("chats_jogo").add({
        jogoId,
        tipo,
        mensagem: "[ADMIN] " + texto,
        criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = "";
}

function sortearPergunta(timeLabel) {
    const timeId = timeLabel === "A" ? timeAId : timeBId;
    const tipo = timeLabel === "A" ? "timeA" : "timeB";
    db.collection("perguntas").where("timeId", "==", timeId).get().then(snapshot => {
        const perguntas = snapshot.docs.map(doc => doc.data());
        if (perguntas.length === 0) return alert("Sem perguntas para esse time.");
        const pergunta = perguntas[Math.floor(Math.random() * perguntas.length)].pergunta;
        db.collection("chats_jogo").add({
            jogoId,
            tipo,
            mensagem: "[PERGUNTA] " + pergunta,
            criadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
    });
}
