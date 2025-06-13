const db = firebase.firestore();

async function pagarCredito(userId, creditosPagar) {
  try {
    // Busca o usuário no banco
    const userRef = db.collection("usuarios").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      alert("Usuário não encontrado!");
      return;
    }

    const userData = userSnap.data();
    const creditosAtuais = userData.creditos || 0;

    // Atualiza os créditos do usuário
    const novosCreditos = creditosAtuais + creditosPagar;
    await userRef.update({ creditos: novosCreditos });

    // Registra a transação no histórico de pagamentos
    await db.collection("transacoes").add({
      userId: userId,
      nome: userData.nome || "",
      creditos: creditosPagar,
      data: new Date()
    });

    alert("Créditos pagos com sucesso!");
  } catch (error) {
    console.error("Erro ao pagar créditos:", error);
    alert("Ocorreu um erro ao registrar o pagamento.");
  }
}
