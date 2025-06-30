document.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const jogoId = urlParams.get("id");

    if (!jogoId) {
        alert("ID do jogo não encontrado na URL.");
        return;
    }

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

    const doc = await db.collection("jogos").doc(jogoId).get();
    if (!doc.exists) {
        alert("Jogo não encontrado.");
        return;
    }

    const jogo = doc.data();
    document.getElementById("titulo").innerText = `${jogo.timeCasa} vs ${jogo.timeFora}`;
    document.getElementById("inicio").innerText = `Início: ${jogo.inicio}`;
    document.getElementById("entrada").innerText = `Entrada: ${jogo.creditos} crédito(s)`;

    let perguntasTimeA = [];
    let perguntasTimeB = [];

    const carregarPerguntas = async () => {
        console.log("Buscando perguntas para timeId A:", jogo.timeIdCasa);
        console.log("Buscando perguntas para timeId B:", jogo.timeIdFora);

        const queryA = await db.collection("perguntas").where("timeId", "==", jogo.timeIdCasa).get();
        perguntasTimeA = queryA.docs.map(doc => doc.data());

        const queryB = await db.collection("perguntas").where("timeId", "==", jogo.timeIdFora).get();
        perguntasTimeB = queryB.docs.map(doc => doc.data());

        if (perguntasTimeA.length === 0 && perguntasTimeB.length === 0) {
            alert("Nenhuma das torcidas possui perguntas cadastradas.");
        }
    };

    await carregarPerguntas();

    const sortearPergunta = (lista) => {
        const index = Math.floor(Math.random() * lista.length);
        return lista[index];
    };

    const enviarPergunta = async (pergunta, chatPath) => {
        const mensagem = `[PERGUNTA] ${pergunta.pergunta}`;
        await db.collection("chats_jogo").add({
            jogoId: jogoId,
            mensagem,
            criadoEm: new Date().toISOString(),
            tipo: "pergunta",
            timeId: pergunta.timeId,
            timeNome: pergunta.timeNome,
            chat: chatPath
        });
    };

    document.getElementById("sortearTimeA").onclick = async () => {
        if (perguntasTimeA.length === 0) {
            alert("Nenhuma pergunta disponível para o Time A.");
            return;
        }
        const pergunta = sortearPergunta(perguntasTimeA);
        console.log("Pergunta sorteada A:", pergunta.pergunta);
        await enviarPergunta(pergunta, "torcida_A");
        alert("Pergunta enviada para torcida do Time A.");
    };

    document.getElementById("sortearTimeB").onclick = async () => {
        if (perguntasTimeB.length === 0) {
            alert("Nenhuma pergunta disponível para o Time B.");
            return;
        }
        const pergunta = sortearPergunta(perguntasTimeB);
        console.log("Pergunta sorteada B:", pergunta.pergunta);
        await enviarPergunta(pergunta, "torcida_B");
        alert("Pergunta enviada para torcida do Time B.");
    };
});
