// API para criar pagamento no Mercado Pago
// Vercel Serverless Function

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'APP_USR-8919987061484072-010706-f9c396940d958d2cb52f0390ac718977-3118399366';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const { pacoteId, creditos, bonus, preco, userId, userEmail, userName } = req.body;

    if (!pacoteId || !preco || !userId) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    // Criar preferência de pagamento no Mercado Pago
    const preference = {
      items: [
        {
          id: `pacote_${pacoteId}`,
          title: `Yellup - ${creditos} Créditos${bonus > 0 ? ` + ${bonus} Bônus` : ''}`,
          description: `Pacote de ${creditos + bonus} créditos para jogar no Yellup`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: preco
        }
      ],
      payer: {
        email: userEmail || 'cliente@yellup.com'
      },
      external_reference: JSON.stringify({
        pacoteId,
        creditos,
        bonus,
        userId,
        timestamp: Date.now()
      }),
      back_urls: {
        success: 'https://yellup.vercel.app/usuarios/loja-creditos.html',
        failure: 'https://yellup.vercel.app/usuarios/loja-creditos.html',
        pending: 'https://yellup.vercel.app/usuarios/loja-creditos.html'
      },
      auto_return: 'approved',
      notification_url: 'https://yellup.vercel.app/api/webhook-mp',
      statement_descriptor: 'YELLUP',
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 horas
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(preference)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Erro MP:', data);
      return res.status(500).json({ error: 'Erro ao criar pagamento', details: data });
    }

    return res.status(200).json({
      success: true,
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point
    });

  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
