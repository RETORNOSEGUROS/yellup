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

    // External reference simples (máx 256 caracteres)
    const externalRef = `${pacoteId}_${creditos}_${bonus || 0}_${userId}_${Date.now()}`;

    // Criar preferência de pagamento no Mercado Pago
    const preference = {
      items: [
        {
          id: `pacote_${pacoteId}`,
          title: `Yellup - ${creditos} Créditos`,
          description: `Pacote de ${creditos} créditos para jogar no Yellup`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: parseFloat(preco)
        }
      ],
      payer: {
        email: userEmail || 'cliente@yellup.com',
        name: userName || 'Cliente Yellup'
      },
      // Referência externa simplificada
      external_reference: externalRef,
      // Habilitar todos os métodos de pagamento incluindo PIX
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 1,
        default_payment_method_id: 'pix'
      },
      back_urls: {
        success: `https://yellup.vercel.app/usuarios/loja-creditos.html?status=success&ref=${externalRef}`,
        failure: `https://yellup.vercel.app/usuarios/loja-creditos.html?status=failure&ref=${externalRef}`,
        pending: `https://yellup.vercel.app/usuarios/loja-creditos.html?status=pending&ref=${externalRef}`
      },
      auto_return: 'approved',
      notification_url: 'https://yellup.vercel.app/api/webhook-mp',
      statement_descriptor: 'YELLUP',
      // Expiração de 30 minutos
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };

    console.log('Criando preferência:', JSON.stringify(preference, null, 2));

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

    console.log('Preferência criada:', data.id);

    return res.status(200).json({
      success: true,
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point
    });

  } catch (error) {
    console.error('Erro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
}
