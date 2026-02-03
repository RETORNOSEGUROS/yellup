// Webhook do Mercado Pago
// Vercel Serverless Function
// ✅ CORRIGIDO: Token apenas via variável de ambiente

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // ✅ NOVO: Validar se token existe
  if (!MP_ACCESS_TOKEN) {
    console.error('ERRO CRÍTICO: MP_ACCESS_TOKEN não configurado');
    return res.status(500).json({ error: 'Erro de configuração' });
  }

  try {
    const { type, data } = req.body;

    console.log('Webhook recebido:', type, data?.id);

    // Só processar notificações de pagamento
    if (type !== 'payment') {
      return res.status(200).json({ message: 'Tipo ignorado' });
    }

    const paymentId = data?.id;
    if (!paymentId) {
      return res.status(400).json({ error: 'ID do pagamento não informado' });
    }

    // Buscar detalhes do pagamento no Mercado Pago
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      }
    });

    if (!response.ok) {
      console.error('Erro ao buscar pagamento:', response.status);
      return res.status(500).json({ error: 'Erro ao verificar pagamento' });
    }

    const payment = await response.json();

    console.log('Pagamento:', payment.id, 'Status:', payment.status);

    // Só processar pagamentos aprovados
    if (payment.status !== 'approved') {
      return res.status(200).json({ message: 'Pagamento não aprovado', status: payment.status });
    }

    // Extrair dados da referência externa
    // Formato: pacoteId_creditos_bonus_userId_timestamp
    const externalRef = payment.external_reference;
    if (!externalRef) {
      console.error('Referência externa não encontrada');
      return res.status(400).json({ error: 'Referência não encontrada' });
    }

    const parts = externalRef.split('_');
    if (parts.length < 5) {
      console.error('Formato de referência inválido:', externalRef);
      return res.status(400).json({ error: 'Referência inválida' });
    }

    const [pacoteId, creditos, bonus, odias, ...rest] = parts;
    const userId = rest.slice(0, -1).join('_') || parts[3]; // userId pode ter underscores
    const creditosNum = parseInt(creditos) || 0;
    const bonusNum = parseInt(bonus) || 0;
    const totalCreditos = creditosNum + bonusNum;

    console.log('Creditando:', totalCreditos, 'créditos para usuário:', userId);

    // ✅ IMPORTANTE: Aqui você deve chamar o Firebase Admin SDK
    // Como estamos na Vercel, você precisa inicializar o Firebase Admin
    // Veja o arquivo firebase-admin-init.js para a configuração

    // Exemplo de como seria a chamada:
    // const admin = require('./firebase-admin-init');
    // await admin.firestore().collection('usuarios').doc(userId).update({
    //   creditos: admin.firestore.FieldValue.increment(totalCreditos),
    //   creditosPagos: admin.firestore.FieldValue.increment(creditosNum)
    // });

    // Registrar transação
    // await admin.firestore().collection('transacoes').add({
    //   tipo: 'compra',
    //   userId,
    //   creditos: totalCreditos,
    //   valor: payment.transaction_amount,
    //   paymentId: payment.id,
    //   status: 'aprovado',
    //   data: admin.firestore.FieldValue.serverTimestamp()
    // });

    return res.status(200).json({ 
      success: true, 
      message: 'Pagamento processado',
      userId,
      creditos: totalCreditos
    });

  } catch (error) {
    console.error('Erro no webhook:', error.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
