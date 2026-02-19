// API para criar pagamento no Mercado Pago
// Vercel Serverless Function
// v3: Suporte a Passes + Creditos

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  if (!MP_ACCESS_TOKEN) {
    console.error('ERRO CRITICO: MP_ACCESS_TOKEN nao configurado');
    return res.status(500).json({ error: 'Erro de configuracao do servidor' });
  }

  try {
    const { pacoteId, creditos, bonus, preco, userId, userEmail, userName } = req.body;

    // Validacao basica
    if (!pacoteId || !preco || !userId) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    const precoNum = parseFloat(preco);
    if (isNaN(precoNum) || precoNum <= 0 || precoNum > 10000) {
      return res.status(400).json({ error: 'Valor de preco invalido' });
    }

    const creditosNum = parseInt(creditos) || 0;
    const bonusNum = parseInt(bonus) || 0;

    // Detectar se eh passe ou creditos
    const isPasse = String(pacoteId).startsWith('passe_');

    // Para creditos, quantidade deve ser > 0
    if (!isPasse && (creditosNum <= 0 || creditosNum > 100000)) {
      return res.status(400).json({ error: 'Quantidade de creditos invalida' });
    }

    // External reference (max 256 chars)
    const externalRef = pacoteId + '_' + creditosNum + '_' + bonusNum + '_' + userId + '_' + Date.now();

    // Dominio base
    const host = req.headers.host || 'yellup.vercel.app';
    const baseUrl = 'https://' + host;

    // Pagina de retorno dinamica
    const returnPage = isPasse ? 'loja-passes.html' : 'loja-creditos.html';

    // Titulo e descricao dinamicos
    var titulo, descricao;
    if (isPasse) {
      var nomes = {
        'passe_semanal': 'Passe Semanal (7 dias)',
        'passe_mensal': 'Passe Mensal (30 dias)',
        'passe_anual': 'Passe Anual (365 dias)'
      };
      titulo = 'Yellup - ' + (nomes[pacoteId] || pacoteId);
      descricao = 'Passe de acesso ilimitado Yellup';
    } else {
      titulo = 'Yellup - ' + creditosNum + ' Creditos';
      descricao = 'Pacote de ' + creditosNum + ' creditos para jogar no Yellup';
    }

    // Criar preferencia de pagamento
    var preference = {
      items: [
        {
          id: 'pacote_' + pacoteId,
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
        success: baseUrl + '/usuarios/' + returnPage + '?status=success&ref=' + externalRef,
        failure: baseUrl + '/usuarios/' + returnPage + '?status=failure&ref=' + externalRef,
        pending: baseUrl + '/usuarios/' + returnPage + '?status=pending&ref=' + externalRef
      },
      auto_return: 'approved',
      notification_url: baseUrl + '/api/webhook-mp',
      statement_descriptor: 'YELLUP'
    };

    console.log('Criando preferencia - userId:', userId, 'pacote:', pacoteId, 'preco:', precoNum, 'tipo:', isPasse ? 'passe' : 'creditos');

    var response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN
      },
      body: JSON.stringify(preference)
    });

    var data = await response.json();

    if (!response.ok) {
      console.error('Erro MP Status:', response.status);
      console.error('Erro MP Resposta:', JSON.stringify(data));
      return res.status(500).json({
        error: 'Erro ao criar pagamento',
        detail: data.message || data.error || 'Erro desconhecido'
      });
    }

    console.log('Preferencia criada:', data.id);

    return res.status(200).json({
      success: true,
      preferenceId: data.id,
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point
    });

  } catch (error) {
    console.error('Erro interno:', error.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
