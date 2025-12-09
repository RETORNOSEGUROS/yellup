<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - Jogos | Yellup</title>
    <script src="https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.22.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore-compat.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            display: flex;
        }

        /* Sidebar */
        .sidebar {
            width: 260px;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(10px);
            border-right: 1px solid rgba(255, 255, 255, 0.1);
            padding: 20px 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }

        .sidebar-header {
            padding: 0 20px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 20px;
        }

        .sidebar-header h2 {
            color: #FFD700;
            font-size: 28px;
        }

        .sidebar-header span {
            font-size: 12px;
            background: #e74c3c;
            color: white;
            padding: 2px 8px;
            border-radius: 10px;
        }

        .nav-section { margin-bottom: 20px; }

        .nav-section-title {
            color: rgba(255, 255, 255, 0.5);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            padding: 0 20px;
            margin-bottom: 10px;
        }

        .sidebar a {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 20px;
            color: rgba(255, 255, 255, 0.7);
            text-decoration: none;
            transition: all 0.3s;
            border-left: 3px solid transparent;
        }

        .sidebar a:hover, .sidebar a.active {
            background: rgba(255, 215, 0, 0.1);
            color: #FFD700;
            border-left-color: #FFD700;
        }

        .sidebar a .icon { font-size: 18px; width: 24px; text-align: center; }

        /* Main Content */
        .main {
            flex: 1;
            margin-left: 260px;
            padding: 30px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }

        .header h1 { color: white; font-size: 28px; }

        .btn {
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s;
            border: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn-primary {
            background: linear-gradient(135deg, #FFD700, #FFA500);
            color: #1a1a2e;
        }

        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(255, 215, 0, 0.3); }

        .btn-danger { background: rgba(231, 76, 60, 0.2); border: 1px solid #e74c3c; color: #e74c3c; }
        .btn-danger:hover { background: #e74c3c; color: white; }

        .btn-success { background: rgba(46, 204, 113, 0.2); border: 1px solid #2ecc71; color: #2ecc71; }
        .btn-success:hover { background: #2ecc71; color: white; }

        .btn-info { background: rgba(52, 152, 219, 0.2); border: 1px solid #3498db; color: #3498db; }
        .btn-info:hover { background: #3498db; color: white; }

        .btn-warning { background: rgba(241, 196, 15, 0.2); border: 1px solid #f1c40f; color: #f1c40f; }
        .btn-warning:hover { background: #f1c40f; color: #1a1a2e; }

        .btn-sm { padding: 6px 12px; font-size: 12px; }

        /* Stats */
        .stats-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
        }

        .stat-card .icon { font-size: 32px; margin-bottom: 10px; }
        .stat-card .value { font-size: 28px; font-weight: 700; color: white; }
        .stat-card .label { color: rgba(255, 255, 255, 0.6); font-size: 14px; }

        /* Filters */
        .filters-bar {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            align-items: center;
        }

        .filter-select, .filter-input {
            padding: 12px 20px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 14px;
        }

        .filter-select option { background: #1a1a2e; color: white; }
        .filter-input:focus, .filter-select:focus { outline: none; border-color: #FFD700; }

        /* Table */
        .table-container {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            overflow: hidden;
        }

        table { width: 100%; border-collapse: collapse; }

        th {
            background: rgba(0, 0, 0, 0.3);
            color: #FFD700;
            padding: 15px;
            text-align: left;
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
        }

        td {
            padding: 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            color: white;
            font-size: 14px;
        }

        tr:hover { background: rgba(255, 255, 255, 0.03); }

        .jogo-cell {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .time-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
        }

        .time-badge .escudo {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .vs-badge {
            font-weight: 700;
            color: #FFD700;
        }

        .status-badge {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }

        .status-ao_vivo { background: rgba(231, 76, 60, 0.2); color: #e74c3c; }
        .status-agendado { background: rgba(241, 196, 15, 0.2); color: #f1c40f; }
        .status-finalizado { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }

        .actions { display: flex; gap: 8px; flex-wrap: wrap; }

        /* Pagination */
        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
            margin-top: 20px;
            color: white;
        }

        .pagination button {
            padding: 10px 20px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            border-radius: 8px;
            cursor: pointer;
        }

        .pagination button:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Modal */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 20px;
        }

        .modal.active { display: flex; }

        .modal-content {
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 30px;
            width: 100%;
            max-width: 700px;
            max-height: 90vh;
            overflow-y: auto;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
        }

        .modal-header h2 { color: #FFD700; }

        .modal-close {
            background: rgba(231, 76, 60, 0.2);
            border: 1px solid #e74c3c;
            color: #e74c3c;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
        }

        .modal-close:hover { background: #e74c3c; color: white; }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .form-group label {
            color: rgba(255, 255, 255, 0.8);
            font-size: 14px;
            font-weight: 500;
        }

        .form-group input, .form-group select {
            padding: 12px 15px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 14px;
        }

        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: #FFD700;
        }

        .form-group select option { background: #1a1a2e; }

        .time-selector {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 20px;
        }

        .time-selector select {
            flex: 1;
            padding: 15px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 14px;
        }

        .time-selector .vs {
            font-size: 24px;
            font-weight: 700;
            color: #FFD700;
        }

        .loading {
            text-align: center;
            color: rgba(255, 255, 255, 0.6);
            padding: 40px;
        }

        /* Patrocinadores */
        .patrocinadores-section {
            margin-top: 25px;
            padding-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .patrocinadores-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .patrocinadores-header h3 {
            color: #FFD700;
            font-size: 16px;
        }

        .patrocinador-item {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 15px;
            margin-bottom: 15px;
            position: relative;
        }

        .patrocinador-item .btn-remove {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(231, 76, 60, 0.2);
            border: 1px solid #e74c3c;
            color: #e74c3c;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 14px;
        }

        .patrocinador-item .btn-remove:hover {
            background: #e74c3c;
            color: white;
        }

        .patrocinador-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }

        .patrocinador-grid .form-group.full {
            grid-column: span 2;
        }

        .logo-preview {
            width: 60px;
            height: 60px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            margin-top: 5px;
        }

        .logo-preview img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }

        .logo-preview .emoji-logo {
            font-size: 30px;
        }

        .patrocinador-count {
            background: rgba(46, 204, 113, 0.2);
            color: #2ecc71;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .sidebar { display: none; }
            .main { margin-left: 0; }
            .stats-row { grid-template-columns: repeat(2, 1fr); }
            .form-row { grid-template-columns: 1fr; }
            .patrocinador-grid { grid-template-columns: 1fr; }
            .patrocinador-grid .form-group.full { grid-column: span 1; }
        }
    </style>
</head>
<body>
    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-header">
            <h2>Yellup</h2>
            <span>ADMIN</span>
        </div>

        <div class="nav-section">
            <div class="nav-section-title">Principal</div>
            <a href="index.html"><span class="icon">📊</span> Dashboard</a>
            <a href="usuarios.html"><span class="icon">👥</span> Usuários</a>
            <a href="jogos.html" class="active"><span class="icon">🎮</span> Jogos</a>
            <a href="perguntas.html"><span class="icon">❓</span> Perguntas</a>
        </div>

        <div class="nav-section">
            <div class="nav-section-title">Modos de Jogo</div>
            <a href="torneios.html"><span class="icon">🏅</span> Torneios</a>
            <a href="embates.html"><span class="icon">⚔️</span> Embates PvP</a>
            <a href="ligas.html"><span class="icon">🏆</span> Teste de Ligas</a>
        </div>

        <div class="nav-section">
            <div class="nav-section-title">Comunidade</div>
            <a href="chat.html"><span class="icon">💬</span> Chat Global</a>
            <a href="amizades.html"><span class="icon">🤝</span> Amizades</a>
            <a href="notificacoes.html"><span class="icon">🔔</span> Notificações</a>
        </div>

        <div class="nav-section">
            <div class="nav-section-title">Financeiro</div>
            <a href="creditos.html"><span class="icon">💰</span> Créditos</a>
            <a href="transacoes.html"><span class="icon">💳</span> Transações</a>
            <a href="indicacoes.html"><span class="icon">🔗</span> Indicações</a>
        </div>

        <div class="nav-section">
            <div class="nav-section-title">Sistema</div>
            <a href="times.html"><span class="icon">⚽</span> Times</a>
            <a href="configuracoes.html"><span class="icon">⚙️</span> Configurações</a>
        </div>
    </div>

    <!-- Main Content -->
    <div class="main">
        <div class="header">
            <h1>🎮 Gerenciar Jogos</h1>
            <button class="btn btn-primary" onclick="abrirModal()">➕ Novo Jogo</button>
        </div>

        <!-- Stats -->
        <div class="stats-row">
            <div class="stat-card">
                <div class="icon">📅</div>
                <div class="value" id="statTotal">0</div>
                <div class="label">Total de Jogos</div>
            </div>
            <div class="stat-card">
                <div class="icon">🔴</div>
                <div class="value" id="statAoVivo">0</div>
                <div class="label">Ao Vivo Agora</div>
            </div>
            <div class="stat-card">
                <div class="icon">📆</div>
                <div class="value" id="statAgendados">0</div>
                <div class="label">Agendados</div>
            </div>
            <div class="stat-card">
                <div class="icon">✅</div>
                <div class="value" id="statFinalizados">0</div>
                <div class="label">Finalizados</div>
            </div>
        </div>

        <!-- Filters -->
        <div class="filters-bar">
            <select class="filter-select" id="filtroStatus" onchange="filtrarJogos()">
                <option value="">Todos os Status</option>
                <option value="ao_vivo">🔴 Ao Vivo</option>
                <option value="agendado">📆 Agendado</option>
                <option value="finalizado">✅ Finalizado</option>
            </select>
            <select class="filter-select" id="filtroTime" onchange="filtrarJogos()">
                <option value="">Todos os Times</option>
            </select>
            <input type="date" class="filter-input" id="filtroDataInicio" onchange="filtrarJogos()">
            <input type="date" class="filter-input" id="filtroDataFim" onchange="filtrarJogos()">
            <button class="btn btn-info" onclick="exportarCSV()">📥 Exportar</button>
        </div>

        <!-- Table -->
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Jogo</th>
                        <th>Data/Hora</th>
                        <th>Patrocinadores</th>
                        <th>Jogadores</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody id="listaJogos">
                    <tr><td colspan="6" class="loading">Carregando jogos...</td></tr>
                </tbody>
            </table>
        </div>

        <!-- Pagination -->
        <div class="pagination">
            <button onclick="paginaAnterior()" id="btnAnterior" disabled>← Anterior</button>
            <span id="paginaInfo">Página 1</span>
            <button onclick="proximaPagina()" id="btnProxima">Próxima →</button>
        </div>
    </div>

    <!-- Modal Novo/Editar Jogo -->
    <div class="modal" id="modalJogo">
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="modalTitulo">➕ Novo Jogo</h2>
                <button class="modal-close" onclick="fecharModal()">✕</button>
            </div>

            <input type="hidden" id="jogoId">

            <div class="time-selector">
                <select id="timeCasa">
                    <option value="">Selecione o time da casa</option>
                </select>
                <span class="vs">VS</span>
                <select id="timeVisitante">
                    <option value="">Selecione o visitante</option>
                </select>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label>📅 Data e Hora de Início</label>
                    <input type="datetime-local" id="dataInicio">
                </div>
                <div class="form-group">
                    <label>🏁 Data e Hora de Fim</label>
                    <input type="datetime-local" id="dataFim">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label>📊 Status</label>
                    <select id="status">
                        <option value="agendado">📆 Agendado</option>
                        <option value="ao_vivo">🔴 Ao Vivo</option>
                        <option value="finalizado">✅ Finalizado</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>🏆 Liga/Campeonato</label>
                    <input type="text" id="liga" placeholder="Ex: Brasileirão Série A">
                </div>
            </div>

            <!-- Patrocinadores -->
            <div class="patrocinadores-section">
                <div class="patrocinadores-header">
                    <h3>📢 Patrocinadores da Partida</h3>
                    <button class="btn btn-success btn-sm" onclick="adicionarPatrocinador()">➕ Adicionar</button>
                </div>
                <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin-bottom: 15px;">
                    A cada 5 respostas, o usuário verá um patrocinador. Ao clicar no link, ganha os créditos.
                </p>
                <div id="patrocinadoresContainer">
                    <!-- Patrocinadores serão adicionados aqui -->
                </div>
            </div>

            <div style="display: flex; gap: 15px; margin-top: 25px;">
                <button class="btn btn-primary" onclick="salvarJogo()" style="flex: 1;">💾 Salvar Jogo</button>
                <button class="btn btn-danger" onclick="fecharModal()">Cancelar</button>
            </div>
        </div>
    </div>

    <script>
        // Firebase Config
        const firebaseConfig = {
            apiKey: "AIzaSyC5ZrkEy7KuCFJOtPvI7-P-JcA0MF4im5c",
            authDomain: "painel-yellup.firebaseapp.com",
            projectId: "painel-yellup",
            storageBucket: "painel-yellup.appspot.com",
            messagingSenderId: "608347210297",
            appId: "1:608347210297:web:75092713724e617c7203e8"
        };

        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();

        // Verificar autenticação
        firebase.auth().onAuthStateChanged(user => {
            if (!user || user.email !== "admin@yellup.com") {
                window.location.href = "login.html";
            } else {
                carregarTimes();
                carregarJogos();
            }
        });

        // Variáveis
        let todosJogos = [];
        let jogosFiltrados = [];
        let todosTimes = [];
        let timesMap = {};
        let paginaAtual = 1;
        const porPagina = 10;

        async function carregarTimes() {
            try {
                const snap = await db.collection('times').orderBy('nome').get();
                todosTimes = [];
                snap.forEach(doc => {
                    const t = { id: doc.id, ...doc.data() };
                    todosTimes.push(t);
                    timesMap[doc.id] = t;
                });

                // Popular selects
                const selectCasa = document.getElementById('timeCasa');
                const selectVisitante = document.getElementById('timeVisitante');
                const selectFiltro = document.getElementById('filtroTime');

                let options = '<option value="">Selecione...</option>';
                todosTimes.forEach(t => {
                    options += `<option value="${t.id}">${t.nome}</option>`;
                });

                selectCasa.innerHTML = options;
                selectVisitante.innerHTML = options;
                selectFiltro.innerHTML = '<option value="">Todos os Times</option>' + options.replace('<option value="">Selecione...</option>', '');

            } catch (error) {
                console.error('Erro ao carregar times:', error);
            }
        }

        async function carregarJogos() {
            try {
                const snap = await db.collection('jogos').orderBy('dataInicio', 'desc').get();
                todosJogos = [];
                let aoVivo = 0, agendados = 0, finalizados = 0;

                snap.forEach(doc => {
                    const j = { id: doc.id, ...doc.data() };
                    todosJogos.push(j);

                    if (j.status === 'ao_vivo') aoVivo++;
                    else if (j.status === 'agendado') agendados++;
                    else if (j.status === 'finalizado') finalizados++;
                });

                // Atualizar stats
                document.getElementById('statTotal').textContent = todosJogos.length;
                document.getElementById('statAoVivo').textContent = aoVivo;
                document.getElementById('statAgendados').textContent = agendados;
                document.getElementById('statFinalizados').textContent = finalizados;

                jogosFiltrados = [...todosJogos];
                renderizarJogos();

            } catch (error) {
                console.error('Erro ao carregar jogos:', error);
            }
        }

        function renderizarJogos() {
            const tbody = document.getElementById('listaJogos');
            
            if (jogosFiltrados.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="loading">Nenhum jogo encontrado</td></tr>';
                return;
            }

            const inicio = (paginaAtual - 1) * porPagina;
            const pagina = jogosFiltrados.slice(inicio, inicio + porPagina);
            let html = '';

            pagina.forEach(j => {
                const timeCasa = timesMap[j.timeCasaId] || { nome: 'Time', primaria: '#666' };
                const timeFora = timesMap[j.timeForaId] || { nome: 'Time', primaria: '#666' };

                const dataInicio = j.dataInicio?.toDate ? j.dataInicio.toDate() : new Date(j.dataInicio);
                const dataFim = j.dataFim?.toDate ? j.dataFim.toDate() : new Date(j.dataFim);

                const patrocinadores = j.patrocinadores || [];
                const qtdPatrocinadores = patrocinadores.length;

                html += `
                    <tr>
                        <td>
                            <div class="jogo-cell">
                                <div class="time-badge">
                                    <span class="escudo" style="background: ${timeCasa.primaria}"></span>
                                    ${timeCasa.nome}
                                </div>
                                <span class="vs-badge">VS</span>
                                <div class="time-badge">
                                    <span class="escudo" style="background: ${timeFora.primaria}"></span>
                                    ${timeFora.nome}
                                </div>
                            </div>
                        </td>
                        <td>
                            <div>📅 ${dataInicio.toLocaleDateString('pt-BR')}</div>
                            <div style="font-size: 12px; opacity: 0.7;">
                                ⏰ ${dataInicio.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})} 
                                → ${dataFim.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
                            </div>
                        </td>
                        <td>
                            <span class="patrocinador-count">
                                📢 ${qtdPatrocinadores} patrocinador${qtdPatrocinadores !== 1 ? 'es' : ''}
                            </span>
                        </td>
                        <td>${j.participantes || 0} 👥</td>
                        <td>
                            <span class="status-badge status-${j.status}">
                                ${j.status === 'ao_vivo' ? '🔴 Ao Vivo' : j.status === 'agendado' ? '📆 Agendado' : '✅ Finalizado'}
                            </span>
                        </td>
                        <td>
                            <div class="actions">
                                <button class="btn btn-info btn-sm" onclick="editarJogo('${j.id}')">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="excluirJogo('${j.id}')">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            tbody.innerHTML = html;
            atualizarPaginacao();
        }

        function filtrarJogos() {
            const status = document.getElementById('filtroStatus').value;
            const timeId = document.getElementById('filtroTime').value;
            const dataInicio = document.getElementById('filtroDataInicio').value;
            const dataFim = document.getElementById('filtroDataFim').value;

            jogosFiltrados = todosJogos.filter(j => {
                if (status && j.status !== status) return false;
                if (timeId && j.timeCasaId !== timeId && j.timeForaId !== timeId) return false;

                if (dataInicio && j.dataInicio?.toDate) {
                    const jogoData = j.dataInicio.toDate();
                    const filtroData = new Date(dataInicio);
                    if (jogoData < filtroData) return false;
                }

                if (dataFim && j.dataInicio?.toDate) {
                    const jogoData = j.dataInicio.toDate();
                    const filtroData = new Date(dataFim);
                    filtroData.setHours(23, 59, 59);
                    if (jogoData > filtroData) return false;
                }

                return true;
            });

            paginaAtual = 1;
            renderizarJogos();
        }

        function atualizarPaginacao() {
            const totalPaginas = Math.ceil(jogosFiltrados.length / porPagina);
            document.getElementById('paginaInfo').textContent = `Página ${paginaAtual} de ${totalPaginas || 1}`;
            document.getElementById('btnAnterior').disabled = paginaAtual <= 1;
            document.getElementById('btnProxima').disabled = paginaAtual >= totalPaginas;
        }

        function paginaAnterior() {
            if (paginaAtual > 1) { paginaAtual--; renderizarJogos(); }
        }

        function proximaPagina() {
            const totalPaginas = Math.ceil(jogosFiltrados.length / porPagina);
            if (paginaAtual < totalPaginas) { paginaAtual++; renderizarJogos(); }
        }

        // Modal functions
        function abrirModal() {
            document.getElementById('modalTitulo').textContent = '➕ Novo Jogo';
            document.getElementById('jogoId').value = '';
            document.getElementById('timeCasa').value = '';
            document.getElementById('timeVisitante').value = '';
            document.getElementById('dataInicio').value = '';
            document.getElementById('dataFim').value = '';
            document.getElementById('status').value = 'agendado';
            document.getElementById('liga').value = '';
            document.getElementById('patrocinadoresContainer').innerHTML = '';
            document.getElementById('modalJogo').classList.add('active');
        }

        function fecharModal() {
            document.getElementById('modalJogo').classList.remove('active');
        }

        function editarJogo(id) {
            const j = todosJogos.find(x => x.id === id);
            if (!j) return;

            document.getElementById('modalTitulo').textContent = '✏️ Editar Jogo';
            document.getElementById('jogoId').value = id;
            document.getElementById('timeCasa').value = j.timeCasaId || '';
            document.getElementById('timeVisitante').value = j.timeForaId || '';
            document.getElementById('status').value = j.status || 'agendado';
            document.getElementById('liga').value = j.liga || j.campeonato || '';

            if (j.dataInicio?.toDate) {
                const d = j.dataInicio.toDate();
                document.getElementById('dataInicio').value = d.toISOString().slice(0, 16);
            }
            if (j.dataFim?.toDate) {
                const d = j.dataFim.toDate();
                document.getElementById('dataFim').value = d.toISOString().slice(0, 16);
            }

            // Carregar patrocinadores
            document.getElementById('patrocinadoresContainer').innerHTML = '';
            if (j.patrocinadores && j.patrocinadores.length > 0) {
                j.patrocinadores.forEach(p => adicionarPatrocinador(p));
            }

            document.getElementById('modalJogo').classList.add('active');
        }

        // ===================================
        // PATROCINADORES
        // ===================================
        function adicionarPatrocinador(dados = null) {
            const container = document.getElementById('patrocinadoresContainer');
            const div = document.createElement('div');
            div.className = 'patrocinador-item';
            
            const nome = dados?.nome || '';
            const logo = dados?.logo || '🎁';
            const logoUrl = dados?.logoUrl || '';
            const url = dados?.url || '';
            const creditos = dados?.creditos || 5;
            const descricao = dados?.descricao || '';

            div.innerHTML = `
                <button class="btn-remove" onclick="this.parentElement.remove()">✕</button>
                <div class="patrocinador-grid">
                    <div class="form-group">
                        <label>Nome do Patrocinador</label>
                        <input type="text" class="pat-nome" placeholder="Ex: Empresa ABC" value="${nome}">
                    </div>
                    <div class="form-group">
                        <label>Créditos ao Visitar</label>
                        <input type="number" class="pat-creditos" placeholder="5" value="${creditos}" min="1">
                    </div>
                    <div class="form-group full">
                        <label>URL do Site</label>
                        <input type="url" class="pat-url" placeholder="https://www.empresa.com.br" value="${url}">
                    </div>
                    <div class="form-group">
                        <label>Emoji do Logo</label>
                        <input type="text" class="pat-logo" placeholder="🎁" value="${logo}" maxlength="4">
                        <div class="logo-preview">
                            <span class="emoji-logo">${logo || '🎁'}</span>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>OU URL da Imagem</label>
                        <input type="url" class="pat-logoUrl" placeholder="https://..." value="${logoUrl}">
                    </div>
                    <div class="form-group full">
                        <label>Descrição (opcional)</label>
                        <input type="text" class="pat-descricao" placeholder="Visite nosso site!" value="${descricao}">
                    </div>
                </div>
            `;

            // Atualizar preview do emoji
            const emojiInput = div.querySelector('.pat-logo');
            const preview = div.querySelector('.emoji-logo');
            emojiInput.addEventListener('input', () => {
                preview.textContent = emojiInput.value || '🎁';
            });

            container.appendChild(div);
        }

        function coletarPatrocinadores() {
            const items = document.querySelectorAll('.patrocinador-item');
            const patrocinadores = [];

            items.forEach(item => {
                const nome = item.querySelector('.pat-nome').value.trim();
                const creditos = parseInt(item.querySelector('.pat-creditos').value) || 5;
                const url = item.querySelector('.pat-url').value.trim();
                const logo = item.querySelector('.pat-logo').value.trim() || '🎁';
                const logoUrl = item.querySelector('.pat-logoUrl').value.trim();
                const descricao = item.querySelector('.pat-descricao').value.trim();

                if (nome) {
                    patrocinadores.push({ nome, creditos, url, logo, logoUrl, descricao });
                }
            });

            return patrocinadores;
        }

        async function salvarJogo() {
            const id = document.getElementById('jogoId').value;
            const timeCasaId = document.getElementById('timeCasa').value;
            const timeForaId = document.getElementById('timeVisitante').value;

            if (!timeCasaId || !timeForaId) {
                alert('Selecione os dois times!');
                return;
            }

            if (timeCasaId === timeForaId) {
                alert('Selecione times diferentes!');
                return;
            }

            const dataInicioVal = document.getElementById('dataInicio').value;
            const dataFimVal = document.getElementById('dataFim').value;

            if (!dataInicioVal || !dataFimVal) {
                alert('Preencha as datas de início e fim!');
                return;
            }

            const dados = {
                timeCasaId,
                timeForaId,
                status: document.getElementById('status').value,
                liga: document.getElementById('liga').value || 'Partida',
                patrocinadores: coletarPatrocinadores(),
                dataInicio: new Date(dataInicioVal),
                dataFim: new Date(dataFimVal)
            };

            try {
                if (id) {
                    await db.collection('jogos').doc(id).update(dados);
                    alert('✅ Jogo atualizado!');
                } else {
                    dados.participantes = 0;
                    dados.dataCriacao = firebase.firestore.FieldValue.serverTimestamp();
                    dados.premiado = false;
                    await db.collection('jogos').add(dados);
                    alert('✅ Jogo criado!');
                }
                fecharModal();
                carregarJogos();
            } catch (error) {
                console.error('Erro:', error);
                alert('❌ Erro ao salvar: ' + error.message);
            }
        }

        async function excluirJogo(id) {
            if (!confirm('Tem certeza que deseja excluir este jogo?')) return;

            try {
                await db.collection('jogos').doc(id).delete();
                alert('🗑️ Jogo excluído!');
                carregarJogos();
            } catch (error) {
                alert('❌ Erro: ' + error.message);
            }
        }

        function exportarCSV() {
            let csv = 'Time Casa,Time Visitante,Data Início,Data Fim,Patrocinadores,Jogadores,Status\n';
            jogosFiltrados.forEach(j => {
                const casa = timesMap[j.timeCasaId]?.nome || 'N/A';
                const fora = timesMap[j.timeForaId]?.nome || 'N/A';
                const dataI = j.dataInicio?.toDate?.().toLocaleString('pt-BR') || 'N/A';
                const dataF = j.dataFim?.toDate?.().toLocaleString('pt-BR') || 'N/A';
                const qtdPat = j.patrocinadores?.length || 0;
                csv += `"${casa}","${fora}","${dataI}","${dataF}",${qtdPat},${j.participantes || 0},"${j.status}"\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'jogos_yellup.csv';
            a.click();
        }
    </script>
</body>
</html>
