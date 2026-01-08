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
    const { preferenceId, externalReference, userId } = req.query;

    console.log('🔍 Verificando pagamento:', { preferenceId, externalReference, userId });

    let searchUrl;
    
    // Priorizar busca por external_reference (mais confiável para PIX)
    if (externalReference) {
      searchUrl = `https://api.mercadopago.com/v1/payments/search?external_reference=${externalReference}&sort=date_created&criteria=desc`;
    } else if (preferenceId) {
      searchUrl = `https://api.mercadopago.com/v1/payments/search?preference_id=${preferenceId}&sort=date_created&criteria=desc`;
    } else if (userId) {
      // Buscar pagamentos recentes do usuário (últimos 30 dias)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      searchUrl = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${thirtyDaysAgo.toISOString()}&end_date=${new Date().toISOString()}`;
    } else {
      return res.status(400).json({ error: 'preferenceId, externalReference ou userId é obrigatório' });
    }

    console.log('🔗 URL de busca:', searchUrl);

    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      }
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Erro ao buscar pagamentos:', errorText);
      return res.status(500).json({ error: 'Erro ao buscar pagamentos', details: errorText });
    }

    const searchData = await searchResponse.json();
    
    console.log(`📦 Encontrados ${searchData.results?.length || 0} pagamentos`);

    if (!searchData.results || searchData.results.length === 0) {
      return res.status(200).json({
        approved: false,
        pending: true,
        message: 'Nenhum pagamento encontrado'
      });
    }

    // Se buscou por userId, filtrar os que contém o userId na external_reference
    let payments = searchData.results;
    if (userId && !externalReference && !preferenceId) {
      payments = payments.filter(p => 
        p.external_reference && p.external_reference.includes(userId)
      );
    }

    // Verificar se algum pagamento foi aprovado
    const approvedPayment = payments.find(p => p.status === 'approved');
    
    if (approvedPayment) {
      console.log('✅ Pagamento aprovado encontrado:', approvedPayment.id, approvedPayment.external_reference);
      return res.status(200).json({
        approved: true,
        paymentId: String(approvedPayment.id),
        status: 'approved',
        amount: approvedPayment.transaction_amount,
        paymentMethod: approvedPayment.payment_type_id,
        dateApproved: approvedPayment.date_approved,
        externalReference: approvedPayment.external_reference
      });
    }

    // Verificar pagamento pendente
    const pendingPayment = payments.find(p => 
      p.status === 'pending' || p.status === 'in_process'
    );

    if (pendingPayment) {
      return res.status(200).json({
        approved: false,
        pending: true,
        paymentId: String(pendingPayment.id),
        status: pendingPayment.status,
        message: 'Pagamento pendente',
        externalReference: pendingPayment.external_reference
      });
    }

    // Pagamento rejeitado ou outro status
    const latestPayment = payments[0];
    if (latestPayment) {
      return res.status(200).json({
        approved: false,
        rejected: latestPayment.status === 'rejected',
        status: latestPayment.status,
        statusDetail: latestPayment.status_detail,
        message: `Status: ${latestPayment.status}`,
        externalReference: latestPayment.external_reference
      });
    }

    return res.status(200).json({
      approved: false,
      message: 'Nenhum pagamento relevante encontrado'
    });

  } catch (error) {
    console.error('❌ Erro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
}
