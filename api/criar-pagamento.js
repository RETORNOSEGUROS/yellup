// API para criar pagamento no Mercado Pago
// Vercel Serverless Function
// ✅ v2: Melhor log de erros + domínio correto

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

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

  if (!MP_ACCESS_TOKEN) {
    console.error('ERRO CRÍTICO: MP_ACCESS_TOKEN não configurado nas variáveis de ambiente');
    return res.status(500).json({ error: 'Erro de configuração do servidor. Contate o suporte.' });
  }

  try {
    const { pacoteId, creditos, bonus, preco, userId, userEmail, userName } = req.body;

    // Validação
    if (!pacoteId || !preco || !userId) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    const precoNum = parseFloat(preco);
    const creditosNum = parseInt(creditos) || 0;
    const isPasse = String(pacoteId).startsWith('passe_');
    
    if (isNaN(precoNum) || precoNum <= 0 || precoNum > 10000) {
      return res.status(400).json({ error: 'Valor de preço inválido' });
    }
    
    // Créditos só são obrigatórios para compra de créditos (não passes)
    if (!isPasse && (isNaN(creditosNum) || creditosNum <= 0 || creditosNum > 100000)) {
      return res.status(400).json({ error: 'Quantidade de créditos inválida' });
    }

    // External reference (máx 256 caracteres)
    const externalRef = `${pacoteId}_${creditosNum}_${bonus || 0}_${userId}_${Date.now()}`;

    // Detectar domínio base (usa o host da requisição)
    const host = req.headers.host || 'yellup.vercel.app';
    const baseUrl = `https://${host}`;

    // Página de retorno: loja-passes ou loja-creditos
    const returnPage = isPasse ? 'loja-passes.html' : 'loja-creditos.html';

    // Título dinâmico
    const tituloPasse = {
      'passe_semanal': 'Yellup - Passe Semanal (7 dias)',
      'passe_mensal': 'Yellup - Passe Mensal (30 dias)',
      'passe_anual': 'Yellup - Passe Anual (365 dias)'
    };
    const titulo = isPasse
      ? (tituloPasse[pacoteId] || `Yellup - ${pacoteId}`)
      : `Yellup - ${creditosNum} Créditos`;
    const descricao = isPasse
      ? `Passe de acesso ilimitado Yellup`
      : `Pacote de ${creditosNum} créditos para jogar no Yellup`;

    // Detectar domínio base (usa o host da requisição)
    const host = req.headers.host || 'yellup.vercel.app';
    const baseUrl = `https://${host}`;

    // Criar preferência de pagamento
    const preference = {
      items: [
        {
          id: `pacote_${pacoteId}`,
          title: titulo,
          description: descricao,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: precoNum
        }
      ],
      payer: {
        email: userEmail || 'cliente@yellup.com',
        name: userName || 'Cliente Yellup'
      },
      external_reference: externalRef,
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 12
      },
      back_urls: {
        success: `${baseUrl}/usuarios/${returnPage}?status=success&ref=${externalRef}`,
        failure: `${baseUrl}/usuarios/${returnPage}?status=failure&ref=${externalRef}`,
        pending: `${baseUrl}/usuarios/${returnPage}?status=pending&ref=${externalRef}`
      },
      auto_return: 'approved',
      notification_url: `${baseUrl}/api/webhook-mp`,
      statement_descriptor: 'YELLUP'
    };

    console.log('📦 Criando preferência para userId:', userId, 'pacote:', pacoteId, 'preço:', precoNum);

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
      // ✅ Log detalhado do erro do Mercado Pago
      console.error('❌ Erro MP Status:', response.status);
      console.error('❌ Erro MP Resposta:', JSON.stringify(data));
      return res.status(500).json({ 
        error: 'Erro ao criar pagamento',
        detail: data.message || data.error || 'Erro desconhecido do Mercado Pago'
      });
    }

    console.log('✅ Preferência criada:', data.id);

    return res.status(200).json({
      success: true,
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point
    });

  } catch (error) {
    console.error('❌ Erro interno:', error.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
