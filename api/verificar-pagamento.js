// API para verificar status do pagamento
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

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // ✅ NOVO: Validar se token existe
  if (!MP_ACCESS_TOKEN) {
    console.error('ERRO CRÍTICO: MP_ACCESS_TOKEN não configurado');
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  try {
    // Aceitar paymentId via query ou body
    const paymentId = req.query.paymentId || req.body?.paymentId;

    if (!paymentId) {
      return res.status(400).json({ error: 'ID do pagamento não informado' });
    }

    // ✅ NOVO: Validar formato do paymentId (apenas números)
    if (!/^\d+$/.test(paymentId)) {
      return res.status(400).json({ error: 'ID do pagamento inválido' });
    }

    // Buscar pagamento no Mercado Pago
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'Pagamento não encontrado' });
      }
      console.error('Erro MP:', response.status);
      return res.status(500).json({ error: 'Erro ao verificar pagamento' });
    }

    const payment = await response.json();

    // ✅ NOVO: Retornar apenas dados necessários (não expor tudo)
    return res.status(200).json({
      id: payment.id,
      status: payment.status,
      status_detail: payment.status_detail,
      external_reference: payment.external_reference,
      transaction_amount: payment.transaction_amount,
      date_approved: payment.date_approved,
      payment_method_id: payment.payment_method_id
    });

  } catch (error) {
    console.error('Erro:', error.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
