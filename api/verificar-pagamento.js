// API para verificar pagamentos pendentes do usuário
// Vercel Serverless Function
// ✅ CORRIGIDO: Busca pagamentos recentes por userId via external_reference

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

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  if (!MP_ACCESS_TOKEN) {
    console.error('ERRO CRÍTICO: MP_ACCESS_TOKEN não configurado');
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  try {
    // Aceitar paymentId OU userId
    const paymentId = req.query.paymentId || req.body?.paymentId;
    const userId = req.query.userId || req.body?.userId;

    // MODO 1: Buscar pagamento específico por ID
    if (paymentId) {
      if (!/^\d+$/.test(paymentId)) {
        return res.status(400).json({ error: 'ID do pagamento inválido' });
      }

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.status(404).json({ error: 'Pagamento não encontrado' });
        }
        return res.status(500).json({ error: 'Erro ao verificar pagamento' });
      }

      const payment = await response.json();

      return res.status(200).json({
        approved: payment.status === 'approved',
        id: payment.id,
        paymentId: payment.id,
        status: payment.status,
        status_detail: payment.status_detail,
        external_reference: payment.external_reference,
        externalReference: payment.external_reference,
        transaction_amount: payment.transaction_amount,
        date_approved: payment.date_approved,
        payment_method_id: payment.payment_method_id
      });
    }

    // MODO 2: Buscar pagamentos recentes por userId (via external_reference)
    if (userId) {
      // Buscar pagamentos aprovados recentes no Mercado Pago
      // A external_reference contém o userId: pacoteId_creditos_bonus_userId_timestamp
      const searchUrl = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10&status=approved`;

      const response = await fetch(searchUrl, {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      });

      if (!response.ok) {
        console.error('Erro ao buscar pagamentos:', response.status);
        return res.status(500).json({ error: 'Erro ao buscar pagamentos' });
      }

      const data = await response.json();
      const results = data.results || [];

      // Filtrar pagamentos que pertencem a este userId (via external_reference)
      const userPayments = results.filter(p => {
        if (!p.external_reference) return false;
        return p.external_reference.includes(userId);
      });

      if (userPayments.length === 0) {
        return res.status(200).json({
          approved: false,
          message: 'Nenhum pagamento aprovado encontrado para este usuário'
        });
      }

      // Retornar o pagamento mais recente
      const latest = userPayments[0];

      return res.status(200).json({
        approved: true,
        paymentId: latest.id,
        status: latest.status,
        externalReference: latest.external_reference,
        external_reference: latest.external_reference,
        transaction_amount: latest.transaction_amount,
        date_approved: latest.date_approved,
        // Retornar todos os pagamentos encontrados
        allPayments: userPayments.map(p => ({
          paymentId: p.id,
          status: p.status,
          externalReference: p.external_reference,
          amount: p.transaction_amount,
          date: p.date_approved || p.date_created
        }))
      });
    }

    // Nenhum parâmetro fornecido
    return res.status(400).json({ error: 'Informe paymentId ou userId' });

  } catch (error) {
    console.error('Erro:', error.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
