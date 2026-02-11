// Webhook do Mercado Pago
// Vercel Serverless Function
// ✅ COMPLETO: Firebase Admin SDK integrado + logs de atividade

import admin from 'firebase-admin';

// Inicializar Firebase Admin (apenas uma vez)
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error('❌ Erro ao inicializar Firebase Admin:', e.message);
  }
}

const dbAdmin = admin.firestore();
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  if (!MP_ACCESS_TOKEN) {
    console.error('ERRO CRÍTICO: MP_ACCESS_TOKEN não configurado');
    return res.status(500).json({ error: 'Erro de configuração' });
  }

  try {
    const { type, data } = req.body;
    console.log('📩 Webhook recebido:', type, data?.id);

    // Só processar notificações de pagamento
    if (type !== 'payment') {
      return res.status(200).json({ message: 'Tipo ignorado' });
    }

    const paymentId = data?.id;
    if (!paymentId) {
      return res.status(400).json({ error: 'ID do pagamento não informado' });
    }

    // 1. Verificar se já processamos (evitar duplicidade)
    const jaProcessado = await dbAdmin.collection('pagamentos_mp').doc(String(paymentId)).get();
    if (jaProcessado.exists) {
      console.log('⚠️ Pagamento já processado:', paymentId);
      return res.status(200).json({ success: true, jaProcessado: true });
    }

    // 2. Buscar detalhes no Mercado Pago
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });

    if (!response.ok) {
      console.error('Erro ao buscar pagamento:', response.status);
      return res.status(500).json({ error: 'Erro ao verificar pagamento' });
    }

    const payment = await response.json();
    console.log('💳 Pagamento:', payment.id, 'Status:', payment.status, 'Valor: R$', payment.transaction_amount);

    // Só processar aprovados
    if (payment.status !== 'approved') {
      return res.status(200).json({ message: 'Pagamento não aprovado', status: payment.status });
    }

    // 3. Extrair dados da referência externa
    // Formato: pacoteId_creditos_bonus_userId_timestamp
    const externalRef = payment.external_reference;
    if (!externalRef) {
      console.error('❌ Referência externa não encontrada');
      return res.status(400).json({ error: 'Referência não encontrada' });
    }

    const parts = externalRef.split('_');
    if (parts.length < 5) {
      console.error('❌ Formato de referência inválido:', externalRef);
      return res.status(400).json({ error: 'Referência inválida' });
    }

    const pacoteId = parts[0];
    const creditosNum = parseInt(parts[1]) || 0;
    const bonusNum = parseInt(parts[2]) || 0;
    // userId pode conter underscores, timestamp é o último elemento
    const timestamp = parts[parts.length - 1];
    const userId = parts.slice(3, parts.length - 1).join('_');
    const totalCreditos = creditosNum + bonusNum;

    if (!userId || totalCreditos <= 0) {
      console.error('❌ Dados inválidos - userId:', userId, 'creditos:', totalCreditos);
      return res.status(400).json({ error: 'Dados inválidos na referência' });
    }

    // 4. Verificar se usuário existe
    const userDoc = await dbAdmin.collection('usuarios').doc(userId).get();
    if (!userDoc.exists) {
      console.error('❌ Usuário não encontrado:', userId);
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    const saldoAnterior = userDoc.data()?.creditos || 0;

    // 5. Creditar via batch atômico
    const batch = dbAdmin.batch();

    // Creditar usuário
    batch.update(dbAdmin.collection('usuarios').doc(userId), {
      creditos: admin.firestore.FieldValue.increment(totalCreditos),
      creditosPagos: admin.firestore.FieldValue.increment(creditosNum),
      creditosBonus: admin.firestore.FieldValue.increment(bonusNum)
    });

    // Registrar pagamento (evita duplicidade futura)
    batch.set(dbAdmin.collection('pagamentos_mp').doc(String(paymentId)), {
      usuarioId: userId,
      creditos: creditosNum,
      bonus: bonusNum,
      totalCreditos: totalCreditos,
      valorPago: payment.transaction_amount,
      pacoteId: pacoteId,
      status: 'aprovado',
      externalReference: externalRef,
      metodo: payment.payment_method_id || 'desconhecido',
      origem: 'webhook',
      processadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    // Registrar transação
    batch.set(dbAdmin.collection('transacoes').doc(), {
      usuarioId: userId,
      tipo: 'credito',
      valor: totalCreditos,
      descricao: `Compra de ${creditosNum} créditos${bonusNum > 0 ? ` + ${bonusNum} bônus` : ''} (webhook)`,
      paymentId: String(paymentId),
      data: admin.firestore.FieldValue.serverTimestamp()
    });

    // 6. Log de atividade (extrato)
    batch.set(dbAdmin.collection('logs_atividade').doc(), {
      userId: userId,
      tipo: 'compra',
      valor: totalCreditos,
      saldoAnterior: saldoAnterior,
      saldoPosterior: saldoAnterior + totalCreditos,
      descricao: `Compra MP: ${creditosNum} cr${bonusNum > 0 ? ` + ${bonusNum} bônus` : ''} — R$ ${payment.transaction_amount}`,
      metadata: {
        paymentId: String(paymentId),
        pacoteId,
        creditosBase: creditosNum,
        bonus: bonusNum,
        valorPago: payment.transaction_amount,
        metodo: payment.payment_method_id,
        origem: 'webhook'
      },
      criadoEm: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();

    console.log(`✅ Webhook processou: ${userId} +${totalCreditos} cr (saldo ${saldoAnterior} → ${saldoAnterior + totalCreditos}) | PaymentID: ${paymentId}`);

    return res.status(200).json({
      success: true,
      message: 'Pagamento processado via webhook',
      userId,
      creditos: totalCreditos
    });

  } catch (error) {
    console.error('❌ Erro no webhook:', error.message, error.stack);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
