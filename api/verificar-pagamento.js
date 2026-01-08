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

    if (!preferenceId) {
      return res.status(400).json({ error: 'preferenceId é obrigatório' });
    }

    console.log('🔍 Verificando pagamento para preference:', preferenceId);

    // Buscar pagamentos associados a esta preferência
    const searchResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/search?preference_id=${preferenceId}&sort=date_created&criteria=desc`,
      {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      }
    );

    if (!searchResponse.ok) {
      console.error('Erro ao buscar pagamentos');
      return res.status(500).json({ error: 'Erro ao buscar pagamentos' });
    }

    const searchData = await searchResponse.json();
    
    console.log(`📦 Encontrados ${searchData.results?.length || 0} pagamentos`);

    if (!searchData.results || searchData.results.length === 0) {
      // Verificar se a preferência existe e se expirou
      const prefResponse = await fetch(
        `https://api.mercadopago.com/checkout/preferences/${preferenceId}`,
        {
          headers: {
            'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
          }
        }
      );

      if (prefResponse.ok) {
        const prefData = await prefResponse.json();
        const expirationDate = new Date(prefData.expiration_date_to);
        
        if (expirationDate < new Date()) {
          return res.status(200).json({
            approved: false,
            expired: true,
            message: 'Pagamento expirado'
          });
        }
      }

      return res.status(200).json({
        approved: false,
        pending: true,
        message: 'Nenhum pagamento encontrado'
      });
    }

    // Verificar se algum pagamento foi aprovado
    const approvedPayment = searchData.results.find(p => p.status === 'approved');
    
    if (approvedPayment) {
      console.log('✅ Pagamento aprovado encontrado:', approvedPayment.id);
      return res.status(200).json({
        approved: true,
        paymentId: String(approvedPayment.id),
        status: 'approved',
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
      return res.status(200).json({
        approved: false,
        pending: true,
        paymentId: String(pendingPayment.id),
        status: pendingPayment.status,
        message: 'Pagamento pendente'
      });
    }

    // Pagamento rejeitado ou outro status
    const latestPayment = searchData.results[0];
    return res.status(200).json({
      approved: false,
      rejected: latestPayment.status === 'rejected',
      status: latestPayment.status,
      statusDetail: latestPayment.status_detail,
      message: `Status: ${latestPayment.status}`
    });

  } catch (error) {
    console.error('❌ Erro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
}
