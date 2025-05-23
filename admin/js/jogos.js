<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Dashboard Yellup Admin</title>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
  <script src="/admin/js/firebase-config.js"></script>
  <style>
    body { font-family: Arial; padding: 20px; }
    h2 { margin-bottom: 20px; }
    button { padding: 10px 20px; margin: 10px 10px 0 0; cursor: pointer; }
    a { text-decoration: none; }
  </style>
</head>
<body>
  <h2>Bem-vindo ao Painel Administrativo Yellup</h2>

  <div>
    <a href="/admin/usuarios.html"><button>Gerenciar Usuários</button></a>
    <a href="/admin/jogos.html"><button>Cadastrar Jogos</button></a>
    <a href="/admin/jogos-painel.html"><button>Ver Jogos</button></a>
    <a href="/admin/times.html"><button>Gerenciar Times</button></a>
    <a href="/admin/perguntas.html"><button>Criar Perguntas</button></a>
    <a href="/admin/financeiro.html"><button>Financeiro</button></a>
    <button onclick="logout()">Sair</button>
  </div>

  <script>
    firebase.auth().onAuthStateChanged(user => {
      if (!user) window.location.href = "/admin/login.html";
    });

    function logout() {
      firebase.auth().signOut().then(() => {
        window.location.href = "/admin/login.html";
      });
    }
  </script>
</body>
</html>
