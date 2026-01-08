// Webhook para receber notificações do Mercado Pago
// Vercel Serverless Function

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'APP_USR-8919987061484072-010706-f9c396940d958d2cb52f0390ac718977-3118399366';

// Firebase Admin SDK (se configurado) ou vamos usar REST API
const FIREBASE_PROJECT_ID = 'painel-yellup';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Mercado Pago pode enviar GET para validação
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Webhook Yellup ativo' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    console.log('📩 Webhook recebido:', JSON.stringify(req.body));
    console.log('📩 Query params:', JSON.stringify(req.query));

    const { type, data, action } = req.body;
    
    // O Mercado Pago também pode enviar via query params
    const topic = req.query.topic || type;
    const paymentId = req.query.id || data?.id;

    // Verificar se é uma notificação de pagamento
    if (topic === 'payment' || type === 'payment') {
      
      if (!paymentId) {
        console.log('⚠️ Notificação sem ID de pagamento');
        return res.status(200).json({ received: true });
      }

      // Buscar detalhes do pagamento no Mercado Pago
      const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      });

      if (!paymentResponse.ok) {
        console.error('❌ Erro ao buscar pagamento:', paymentId);
        return res.status(200).json({ received: true, error: 'Pagamento não encontrado' });
      }

      const payment = await paymentResponse.json();
      
      console.log('💰 Pagamento encontrado:', {
        id: payment.id,
        status: payment.status,
        external_reference: payment.external_reference
      });

      // Verificar se o pagamento foi aprovado
      if (payment.status === 'approved') {
        
        // Extrair dados da referência externa (novo formato: pacoteId_creditos_bonus_userId_timestamp)
        let referenceData;
        const extRef = payment.external_reference || '';
        
        // Tentar primeiro o novo formato (string separada por _)
        const parts = extRef.split('_');
        if (parts.length >= 4) {
          referenceData = {
            pacoteId: parseInt(parts[0]) || 0,
            creditos: parseInt(parts[1]) || 0,
            bonus: parseInt(parts[2]) || 0,
            userId: parts[3],
            timestamp: parts[4] || ''
          };
        } else {
          // Fallback para formato antigo (JSON)
          try {
            referenceData = JSON.parse(extRef);
          } catch (e) {
            console.error('❌ Erro ao parsear external_reference:', extRef);
            return res.status(200).json({ received: true, error: 'Referência inválida' });
          }
        }

        const { userId, creditos, bonus, pacoteId } = referenceData;

        if (!userId || !creditos) {
          console.error('❌ Dados incompletos na referência');
          return res.status(200).json({ received: true, error: 'Dados incompletos' });
        }

        // Créditos comprados vão para creditosPagos (entram no pool de premiação)
        const creditosComprados = creditos; // Créditos pagos
        
        // Verificar se já processamos este pagamento (evitar duplicação)
        const checkUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pagamentos_mp/${paymentId}`;
        const checkResponse = await fetch(checkUrl);
        
        if (checkResponse.ok) {
          console.log('⚠️ Pagamento já processado:', paymentId);
          return res.status(200).json({ received: true, already_processed: true });
        }

        // Registrar o pagamento como processado
        const registerUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pagamentos_mp?documentId=${paymentId}`;
        await fetch(registerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              paymentId: { stringValue: String(paymentId) },
              userId: { stringValue: userId },
              creditos: { integerValue: creditosComprados },
              valor: { doubleValue: payment.transaction_amount },
              status: { stringValue: 'approved' },
              processedAt: { timestampValue: new Date().toISOString() },
              pacoteId: { integerValue: pacoteId || 0 }
            }
          })
        });

        console.log(`✅ Pagamento ${paymentId} processado: +${creditosComprados} créditos pagos para ${userId}`);

        // Retornar sucesso
        // NOTA: A atualização dos créditos do usuário será feita pelo cliente
        // quando ele voltar para a página de sucesso, verificando o pagamento
        
        return res.status(200).json({ 
          received: true, 
          processed: true,
          userId,
          creditos: creditosComprados
        });
      }

      // Pagamento não aprovado
      console.log(`⏳ Pagamento ${paymentId} status: ${payment.status}`);
      return res.status(200).json({ received: true, status: payment.status });
    }

    // Outros tipos de notificação
    console.log('📩 Notificação ignorada, tipo:', topic || type);
    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    // Sempre retornar 200 para o MP não ficar reenviando
    return res.status(200).json({ received: true, error: error.message });
  }
}
