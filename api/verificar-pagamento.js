// API para verificar status de pagamento no Mercado Pago
// Vercel Serverless Function

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'APP_USR-8919987061484072-010706-f9c396940d958d2cb52f0390ac718977-3118399366';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { preferenceId } = req.query;

    // CRÍTICO: Só permite busca por preferenceId para segurança
    if (!preferenceId) {
      return res.status(400).json({ 
        error: 'preferenceId é obrigatório',
        approved: false 
      });
    }

    console.log('🔍 Verificando pagamento para preference:', preferenceId);

    // Buscar pagamentos associados a esta preferência específica
    const searchResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/search?preference_id=${preferenceId}&sort=date_created&criteria=desc`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Erro ao buscar pagamentos:', errorText);
      return res.status(200).json({ 
        approved: false,
        error: 'Erro ao buscar pagamentos'
      });
    }

    const searchData = await searchResponse.json();
    
    console.log(`📦 Encontrados ${searchData.results?.length || 0} pagamentos para preferenceId ${preferenceId}`);

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(200).json({
        approved: false,
        pending: true,
        message: 'Nenhum pagamento encontrado para esta preferência'
      });
    }

    // Verificar se algum pagamento foi APROVADO
    const approvedPayment = searchData.results.find(p => p.status === 'approved');
    
    if (approvedPayment) {
      console.log('✅ Pagamento APROVADO encontrado:', approvedPayment.id);
      return res.status(200).json({
        approved: true,
        status: 'approved',
        paymentId: String(approvedPayment.id),
        amount: approvedPayment.transaction_amount,
        paymentMethod: approvedPayment.payment_type_id,
        dateApproved: approvedPayment.date_approved
      });
    }

    // Verificar pagamento pendente
    const pendingPayment = searchData.results.find(p => 
      p.status === 'pending' || p.status === 'in_process'
    );

    if (pendingPayment) {
      console.log('⏳ Pagamento PENDENTE:', pendingPayment.id);
      return res.status(200).json({
        approved: false,
        pending: true,
        status: pendingPayment.status,
        paymentId: String(pendingPayment.id),
        message: 'Aguardando pagamento'
      });
    }

    // Pagamento rejeitado ou outro status
    const latestPayment = searchData.results[0];
    console.log('❌ Pagamento não aprovado:', latestPayment.status);
    return res.status(200).json({
      approved: false,
      rejected: latestPayment.status === 'rejected',
      status: latestPayment.status,
      statusDetail: latestPayment.status_detail,
      message: `Status: ${latestPayment.status}`
    });

  } catch (error) {
    console.error('❌ Erro:', error);
    return res.status(200).json({ 
      approved: false,
      error: 'Erro interno do servidor', 
      message: error.message 
    });
  }
}
