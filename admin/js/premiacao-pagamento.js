// premiacao-pagamento.js
// Executa o pagamento de créditos para o usuário

function pagarPremio(userId) {
    const input = document.getElementById("valor_" + userId);
    const valorPremio = parseFloat(input.value);

    const userRef = db.collection("usuarios").doc(userId);
    db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) throw "Usuário não encontrado";

        const dados = userDoc.data();
        const creditosAtuais = dados.creditos || 0;
        const novosCreditos = creditosAtuais + valorPremio;

        transaction.update(userRef, {
            creditos: novosCreditos,
            ultimaPremiacao: firebase.firestore.Timestamp.now()
        });
    }).then(() => {
        alert("Pagamento realizado com sucesso!");
    }).catch((error) => {
        console.error("Erro ao pagar prêmio: ", error);
        alert("Falha ao executar pagamento.");
    });
}
