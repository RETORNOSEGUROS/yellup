// premiacao-v2.js

// Referência ao Firestore (não redefinimos db aqui, pois já vem do firebase-init.js)
const usuariosRef = db.collection('usuarios');
const respostasRef = db.collection('respostas');

// Função para gerar o ranking de premiação
async function gerarRanking() {
    const dataInicio = document.getElementById('dataInicio').value;
    const dataFim = document.getElementById('dataFim').value;
    const tipoPremiacao = document.getElementById('tipoPremiacao').value;
    const limiteRanking = parseInt(document.getElementById('limiteRanking').value) || 50;

    const dtInicio = new Date(`${dataInicio}T00:00:00`);
    const dtFim = new Date(`${dataFim}T23:59:59`);

    const usuariosSnapshot = await usuariosRef.get();
    const usuariosMap = new Map();

    usuariosSnapshot.forEach(doc => {
        const user = doc.data();
        usuariosMap.set(doc.id, {
            nome: user.nome || doc.id,
            timeId: user.timeId || '',
            pontuacao: 0
        });
    });

    const respostasSnapshot = await respostasRef
        .where('data', '>=', dtInicio)
        .where('data', '<=', dtFim)
        .get();

    respostasSnapshot.forEach(doc => {
        const resp = doc.data();
        const userData = usuariosMap.get(resp.userId);
        if (!userData) return;

        // Acumular somente se for do tipo selecionado
        if (tipoPremiacao === 'time') {
            if (resp.timeIdPergunta === userData.timeId) {
                userData.pontuacao += (resp.pontos || 0);
            }
        } else {
            userData.pontuacao += (resp.pontos || 0);
        }
    });

    const ranking = Array.from(usuariosMap.entries())
        .map(([userId, data]) => ({ userId, ...data }))
        .filter(u => u.pontuacao > 0)
        .sort((a, b) => b.pontuacao - a.pontuacao)
        .slice(0, limiteRanking);

    renderizarTabela(ranking);
}

// Função para renderizar o ranking na tela
function renderizarTabela(ranking) {
    const tbody = document.querySelector('table tbody');
    tbody.innerHTML = '';

    ranking.forEach((user, index) => {
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${user.nome}</td>
            <td>${user.pontuacao}</td>
            <td><input type="number" id="credito-${user.userId}" value="0" min="0" style="width:80px"></td>
            <td><button onclick="pagarCreditos('${user.userId}')">Pagar</button></td>
        `;

        tbody.appendChild(tr);
    });
}

// Função para pagar créditos individualmente
async function pagarCreditos(userId) {
    const input = document.getElementById(`credito-${userId}`);
    const creditos = parseInt(input.value);
    if (isNaN(creditos) || creditos <= 0) {
        alert("Informe um valor válido.");
        return;
    }

    const userDoc = usuariosRef.doc(userId);
    const doc = await userDoc.get();
    if (!doc.exists) {
        alert("Usuário não encontrado.");
        return;
    }

    const dadosUser = doc.data();
    const creditosAtuais = dadosUser.creditos || 0;
    await userDoc.update({
        creditos: creditosAtuais + creditos
    });

    await db.collection('transacoes').add({
        userId,
        creditos,
        data: new Date(),
        tipo: 'premiacao'
    });

    alert("Créditos pagos com sucesso.");
}
