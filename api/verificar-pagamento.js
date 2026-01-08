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
    const { userId, preferenceId } = req.query;

    if (!userId && !preferenceId) {
      return res.status(400).json({ 
        error: 'userId ou preferenceId é obrigatório',
        approved: false 
      });
    }

    let searchUrl;
    
    if (preferenceId) {
      searchUrl = `https://api.mercadopago.com/v1/payments/search?preference_id=${preferenceId}&sort=date_created&criteria=desc`;
    } else {
      // Buscar pagamentos dos últimos 7 dias
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      searchUrl = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&begin_date=${sevenDaysAgo.toISOString()}&end_date=${new Date().toISOString()}`;
    }

    console.log('🔍 Buscando pagamentos:', searchUrl);

    const searchResponse = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      }
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('Erro ao buscar pagamentos:', errorText);
      return res.status(200).json({ 
        approved: false,
        error: 'Erro ao buscar pagamentos'
      });
    }

    const searchData = await searchResponse.json();
    let payments = searchData.results || [];
    
    console.log(`📦 Encontrados ${payments.length} pagamentos`);

    // Se buscou por userId, filtrar os que contém o userId na external_reference
    if (userId && !preferenceId) {
      payments = payments.filter(p => 
        p.external_reference && p.external_reference.includes(userId)
      );
      console.log(`📦 ${payments.length} pagamentos do usuário ${userId}`);
    }

    if (payments.length === 0) {
      return res.status(200).json({
        approved: false,
        pending: true,
        message: 'Nenhum pagamento encontrado'
      });
    }

    // Verificar se algum pagamento foi APROVADO
    const approvedPayment = payments.find(p => p.status === 'approved');
    
    if (approvedPayment) {
      console.log('✅ Pagamento APROVADO:', approvedPayment.id);
      return res.status(200).json({
        approved: true,
        status: 'approved',
        paymentId: String(approvedPayment.id),
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
      console.log('⏳ Pagamento PENDENTE:', pendingPayment.id);
      return res.status(200).json({
        approved: false,
        pending: true,
        status: pendingPayment.status,
        paymentId: String(pendingPayment.id),
        message: 'Aguardando pagamento'
      });
    }

    // Nenhum aprovado ou pendente
    return res.status(200).json({
      approved: false,
      message: 'Nenhum pagamento aprovado encontrado'
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
