<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <title>Cadastro de Jogos</title>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-firestore.js"></script>
    <script src="../js/firebase-init.js"></script>
    <script src="../js/jogos.js"></script>

    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; }
        .container { background: #fff; padding: 30px; margin: 30px auto; width: 400px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        h2 { text-align: center; }
        label { margin-top: 15px; display: block; }
        input, select { width: 100%; padding: 10px; margin-top: 5px; }
        button { margin-top: 20px; padding: 15px; width: 100%; background: #28a745; color: #fff; border: none; border-radius: 5px; font-weight: bold; }
        button:hover { background: #218838; }
        table { width: 100%; border-collapse: collapse; margin-top: 40px; }
        th, td { padding: 10px; border: 1px solid #ccc; text-align: center; }
        .patrocinador-item input { width: 90%; margin: 5px 0; }
    </style>
</head>

<body>
    <div class="container">
        <h2>Cadastro de Jogos</h2>

        <label>Time Casa:</label>
        <select id="timeCasa"></select>

        <label>Time Visitante:</label>
        <select id="timeVisitante"></select>

        <label>Data Início:</label>
        <input type="datetime-local" id="dataInicio">

        <label>Data Fim:</label>
        <input type="datetime-local" id="dataFim">

        <label>Valor Entrada (créditos):</label>
        <input type="number" id="valorEntrada" value="25">

        <label>Status:</label>
        <select id="status">
            <option value="agendado">Agendado</option>
            <option value="ao_vivo">Ao Vivo</option>
            <option value="finalizado">Finalizado</option>
        </select>

        <h3>Patrocinadores</h3>
        <div id="patrocinadoresContainer"></div>
        <button id="btnAdicionarPatrocinador" type="button">+ Adicionar Patrocinador</button>

        <button id="salvarJogo" type="button">Salvar Jogo</button>

        <h3>Jogos Cadastrados</h3>
        <table>
            <thead>
                <tr>
                    <th>Casa</th>
                    <th>Visitante</th>
                    <th>Início</th>
                    <th>Entrada</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody id="listaJogos"></tbody>
        </table>
    </div>
</body>
</html>
