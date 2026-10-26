// Acesso ao SIPLAWEB: login obrigatorio (Supabase Auth do projeto do ambiente: producao ou homologacao, abaixo).
// Permissoes por AREA (cada origem + JURISDICAO) no schema acesso do banco, em 5 niveis (cada um inclui os
// anteriores): visualizador (so ve), gerenciador (+ exporta), editor_basico (+ propoe edicoes que o pleno
// aprova), editor_pleno (+ grava direto e aprova) e administrador (tudo, em todas as areas);
// conta nova fica inativa ate o admin liberar. As paginas esperam Acesso.pronto antes de carregar
// dados. Elementos com data-servico ou data-area de uma area sem acesso sao escondidos (o banco
// ja nao entrega os dados dela; isso so limpa os menus).
//
// A chave "publishable" e publica por natureza: quem protege os dados e o login + as regras
// de acesso (RLS) no banco. O login vale tambem para o site do jurisdicao (mesmo projeto).

var Acesso = (function() {
  // Dois bancos (projetos Supabase em São Paulo), escolhidos pelo endereço do site:
  //   producao     banco-gis-dpl  -> ricardomarques2025.github.io/SIPLAWEB/ (desde 26/10/2026; antes banco-gis, Oregon)
  //   homologacao  banco-gis-homolog -> ricardomarques2025.github.io/SIPLAWEB_HOMOLOG/ e o site local (127.0.0.1/localhost);
  //                no local, ?banco=producao usa a produção (fica lembrado na aba; ?banco=homologacao volta).
  // Fora da produção aparece a faixa do ambiente no topo da página.
  var AMBIENTES = {
    producao: { nome: 'Produção', url: 'https://zeneqnnrlrmmmejchbrl.supabase.co', chave: 'sb_publishable_U8n8H8rjvsT8zTpQfZf1dQ_XtV8seBI' },
    homologacao: { nome: 'Homologação', url: 'https://lbhgjkhpxhihmuzapxui.supabase.co', chave: 'sb_publishable_HzhId9FCLmFz_TQrmoU2NQ_qJFEandU' }
  };
  function escolherAmbiente() {
    var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    if (!local) return /^\/SIPLAWEB_HOMOLOG(\/|$)/i.test(location.pathname) ? 'homologacao' : 'producao';
    var pedido = new URLSearchParams(location.search).get('banco');
    try {
      if (pedido === 'producao' || pedido === 'homologacao') sessionStorage.setItem('siplaweb_banco', pedido);
      return sessionStorage.getItem('siplaweb_banco') || 'homologacao';
    } catch (e) { return pedido === 'producao' ? 'producao' : 'homologacao'; }
  }
  var AMBIENTE = escolherAmbiente();
  var SUPABASE = AMBIENTES[AMBIENTE];
  var sb = supabase.createClient(SUPABASE.url, SUPABASE.chave, { db: { schema: 'siplaweb' } });
  var perfil = null;
  var resolverPronto;
  var pronto = new Promise(function(resolve) { resolverPronto = resolve; });
  var tela = null;

  var CSS =
    '.acesso-tela{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(135deg,#0f2b46 0%,#1d4f7a 100%);font-family:Segoe UI,Arial,sans-serif;padding:16px}' +
    '.acesso-tela[hidden]{display:none}' +
    '.acesso-caixa{width:100%;max-width:360px;background:#fff;border-radius:12px;padding:28px 26px;' +
    'box-shadow:0 20px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:10px;color:#1f2937}' +
    '.acesso-titulo{font-size:20px;font-weight:700;color:#0f2b46;margin:0}' +
    '.acesso-sub{font-size:12px;letter-spacing:.08em;color:#64748b;margin:-6px 0 6px;text-transform:uppercase}' +
    '.acesso-texto{font-size:13px;color:#475569;line-height:1.5;margin:0 0 4px}' +
    '.acesso-caixa label{font-size:12px;font-weight:600;color:#334155}' +
    '.acesso-caixa input{height:36px;border:1px solid #cbd5e1;border-radius:7px;padding:0 10px;font-size:14px}' +
    '.acesso-caixa input:focus{outline:2px solid #2563eb33;border-color:#2563eb}' +
    '.acesso-aviso{min-height:18px;font-size:13px;color:#b91c1c;margin:0;line-height:1.4}' +
    '.acesso-aviso.ok{color:#15803d}' +
    '.acesso-entrar{height:38px;border:0;border-radius:7px;background:#1d4f7a;color:#fff;font-size:14px;font-weight:600;cursor:pointer}' +
    '.acesso-entrar:disabled{opacity:.6;cursor:wait}' +
    '.acesso-link{background:none;border:0;color:#1d4f7a;font-size:13px;cursor:pointer;padding:2px;text-decoration:underline}' +
    '.acesso-link[hidden]{display:none}' +
    '[data-servico][hidden],[data-area][hidden]{display:none!important}' +
    '@media print{.acesso-usuario,.acesso-tela{display:none!important}}' +
    // Sem permissao de exportar: nada sai na impressao (Ctrl+P incluso), so o aviso.
    '[data-exportar][hidden]{display:none!important}' +
    '@media print{html.sem-exportar body>*{display:none!important}' +
    'html.sem-exportar body::before{content:"Impressão e exportação não liberadas para o seu perfil.";display:block;padding:40px;font:16px Segoe UI,Arial,sans-serif}}' +
    '.acesso-usuario{display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}' +
    '.acesso-usuario .acesso-admin{color:inherit;border:1px solid currentColor;border-radius:5px;font-size:11px;padding:2px 7px;text-decoration:none;opacity:.85}' +
    '.acesso-usuario button{background:none;border:1px solid currentColor;border-radius:5px;color:inherit;font-size:11px;padding:2px 7px;cursor:pointer;opacity:.85}' +
    '.acesso-usuario-flutuante{position:fixed;top:10px;right:12px;z-index:9999;background:rgba(15,43,70,.85);color:#fff;padding:5px 10px;border-radius:7px}' +
    '.acesso-ambiente{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:100001;pointer-events:auto;' +
    'font:800 11px/1 Inter,Segoe UI,Arial,sans-serif;letter-spacing:.12em;color:#fff;padding:5px 14px 6px;border-radius:0 0 9px 9px;' +
    'box-shadow:0 3px 10px rgba(0,0,0,.25);white-space:nowrap}' +
    '.acesso-ambiente-homologacao{background:#c2410c}' +
    '.acesso-ambiente-producao{background:#b91c1c}' +
    '@media print{.acesso-ambiente{display:block!important;position:absolute;-webkit-print-color-adjust:exact;print-color-adjust:exact}}';

  function $(id) { return document.getElementById(id); }

  function montarTela() {
    var estilo = document.createElement('style');
    estilo.textContent = CSS;
    document.head.appendChild(estilo);
    tela = document.createElement('div');
    tela.className = 'acesso-tela';
    tela.hidden = true;
    tela.innerHTML =
      '<form class="acesso-caixa" id="acessoForm" autocomplete="on">' +
        '<h1 class="acesso-titulo">Plano GOINFRA</h1>' +
        '<p class="acesso-sub">SIPLAWEB · Sistema de Monitoramento</p>' +
        '<div id="acessoEntrar">' +
          '<p class="acesso-texto">Acesso restrito. Entre com o e-mail e a senha fornecidos pelo administrador.</p>' +
          '<label for="acessoEmail">E-mail</label>' +
          '<input type="email" id="acessoEmail" autocomplete="username" style="width:100%;margin:4px 0 8px">' +
          '<label for="acessoSenha">Senha</label>' +
          '<input type="password" id="acessoSenha" autocomplete="current-password" style="width:100%;margin-top:4px">' +
        '</div>' +
        '<div id="acessoNovaSenha" hidden>' +
          '<p class="acesso-texto">Crie uma nova senha (mínimo 8 caracteres).</p>' +
          '<label for="acessoSenha1">Nova senha</label>' +
          '<input type="password" id="acessoSenha1" minlength="8" autocomplete="new-password" style="width:100%;margin:4px 0 8px">' +
          '<label for="acessoSenha2">Repita a nova senha</label>' +
          '<input type="password" id="acessoSenha2" minlength="8" autocomplete="new-password" style="width:100%;margin-top:4px">' +
        '</div>' +
        '<p class="acesso-aviso" id="acessoAviso"></p>' +
        '<button class="acesso-entrar" type="submit" id="acessoBotao">Entrar</button>' +
        '<button class="acesso-link" type="button" id="acessoEsqueci">Esqueci minha senha</button>' +
        '<button class="acesso-link" type="button" id="acessoOutra" hidden>Entrar com outra conta</button>' +
      '</form>';
    document.body.appendChild(tela);

    $('acessoForm').addEventListener('submit', function(e) {
      e.preventDefault();
      if (!$('acessoNovaSenha').hidden) salvarNovaSenha(); else entrar();
    });
    $('acessoEsqueci').addEventListener('click', esqueci);
    $('acessoOutra').addEventListener('click', function() {
      sb.auth.signOut().then(function() { mostrarTela(); });
    });
  }

  function aviso(texto, ok) {
    $('acessoAviso').textContent = texto || '';
    $('acessoAviso').classList.toggle('ok', !!ok);
  }

  function mostrarTela(texto, logado, novaSenha) {
    tela.hidden = false;
    $('acessoEntrar').hidden = !!novaSenha || !!logado;
    $('acessoNovaSenha').hidden = !novaSenha;
    $('acessoBotao').hidden = !!logado && !novaSenha;
    $('acessoBotao').textContent = novaSenha ? 'Salvar senha' : 'Entrar';
    $('acessoEsqueci').hidden = !!novaSenha || !!logado;
    $('acessoOutra').hidden = !logado || !!novaSenha;
    aviso(texto);
    setTimeout(function() { (novaSenha ? $('acessoSenha1') : $('acessoEmail')).focus(); }, 50);
  }

  function traduzir(e) {
    var msg = String((e && e.message) || e);
    var mapa = [
      [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
      [/Email not confirmed/i, 'E-mail ainda não confirmado.'],
      [/rate limit|too many/i, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'],
      [/Password should be at least/i, 'A senha precisa ter pelo menos 8 caracteres.'],
      [/New password should be different/i, 'A nova senha precisa ser diferente da atual.'],
      [/JWT expired|invalid JWT/i, 'Sessão expirada. Entre novamente.'],
      [/permission denied|row-level security|42501/i, 'Sem permissão para esta operação.'],
      [/Failed to fetch|NetworkError/i, 'Sem conexão com o banco de dados. Verifique a internet.']
    ];
    for (var i = 0; i < mapa.length; i++) if (mapa[i][0].test(msg)) return new Error(mapa[i][1]);
    return new Error(msg);
  }

  function entrar() {
    var email = $('acessoEmail').value.trim();
    var senha = $('acessoSenha').value;
    if (!email || !senha) { aviso('Informe e-mail e senha.'); return; }
    $('acessoBotao').disabled = true;
    aviso('Entrando…', true);
    sb.auth.signInWithPassword({ email: email, password: senha }).then(function(res) {
      if (res.error) throw traduzir(res.error);
      $('acessoSenha').value = '';
      return verificar(true);
    }).catch(function(err) {
      aviso(err.message);
    }).then(function() {
      $('acessoBotao').disabled = false;
    });
  }

  function esqueci() {
    var email = $('acessoEmail').value.trim();
    if (!email) { aviso('Digite seu e-mail acima e clique de novo em "Esqueci minha senha".'); return; }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function(res) {
      if (res.error) throw traduzir(res.error);
      aviso('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.', true);
    }).catch(function(err) { aviso(err.message); });
  }

  function salvarNovaSenha() {
    var s1 = $('acessoSenha1').value;
    if (s1.length < 8) { aviso('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (s1 !== $('acessoSenha2').value) { aviso('As senhas não conferem.'); return; }
    $('acessoBotao').disabled = true;
    sb.auth.updateUser({ password: s1 }).then(function(res) {
      if (res.error) throw traduzir(res.error);
      $('acessoSenha1').value = '';
      $('acessoSenha2').value = '';
      // Senha provisoria (conta criada ou senha redefinida pelo administrador): marca como trocada.
      return sb.rpc('senha_trocada');
    }).then(function() {
      return verificar(true);
    }).catch(function(err) {
      aviso(err.message);
    }).then(function() {
      $('acessoBotao').disabled = false;
    });
  }

  function registrarEvento(evento, detalhe) {
    return sb.rpc('registrar_evento', {
      p_evento: evento, p_detalhe: detalhe || null, p_navegador: navigator.userAgent
    }).then(function(res) {
      if (res.error) console.warn('Registro de acesso falhou:', res.error.message);
    });
  }

  // Confere sessao + perfil. Libera a pagina so para perfil ativo.
  function verificar(entrouAgora) {
    return sb.auth.getSession().then(function(res) {
      var sessao = res.data && res.data.session;
      if (!sessao) { mostrarTela(); return; }
      return sb.rpc('meu_acesso')
        .then(function(r) {
          if (r.error) throw traduzir(r.error);
          var p = r.data || { nome: sessao.user.email, email: sessao.user.email, admin: false, ativo: false, areas: {} };
          if (!p.ativo) {
            if (entrouAgora) registrarEvento('acesso_negado', 'conta inativa no SIPLAWEB');
            mostrarTela('Sua conta (' + p.email + ') ainda não foi liberada no SIPLAWEB. Peça ao administrador para ativá-la.', true);
            return;
          }
          if (p.trocar_senha) {
            mostrarTela('Você entrou com uma senha provisória. Crie a sua senha para continuar.', false, true);
            return;
          }
          perfil = p;
          tela.hidden = true;
          var chave = 'siplaweb_acesso_' + sessao.user.id;
          try {
            if (entrouAgora || !sessionStorage.getItem(chave)) {
              registrarEvento('acesso', location.pathname.split('/').pop() || 'index.html');
              sessionStorage.setItem(chave, '1');
            }
          } catch (e) { /* navegador sem sessionStorage: so deixa de evitar registros repetidos */ }
          mostrarUsuario();
          esconderSemAcesso();
          aplicarExportacao();
          resolverPronto(perfil);
        });
    }).catch(function(err) {
      mostrarTela('Não foi possível conectar ao banco: ' + err.message);
    });
  }

  var GRAU = { visualizador: 1, gerenciador: 2, editor_basico: 3, editor_pleno: 4 };
  var NOME_NIVEL = { visualizador: 'visualizador', gerenciador: 'gerenciador', editor_basico: 'editor básico', editor_pleno: 'editor pleno' };
  function grau(area) { return perfil ? GRAU[perfil.areas[area]] || 0 : 0; }
  function podeVer(area) { return grau(area) >= 1; }
  function podeExportar(area) { return grau(area) >= 2; }
  function podePropor(area) { return grau(area) >= 3; }        // editor basico em diante (o basico so propoe)
  function podeEditar(area) { return grau(area) >= 4; }        // editor pleno: grava direto e aprova

  // Exportar/imprimir na pagina atual: a origem aberta, o modulo da jurisdicao (e o caderno) ou, no mapa geral,
  // TODAS as origens que a pessoa ve (o mapa mistura todas). No rodoviario (so camadas de base) basta uma area.
  function areaDaPagina() {
    var q = new URLSearchParams(location.search);
    if (q.get('origem')) return String(q.get('origem')).toUpperCase();
    if (q.get('modulo') === 'jurisdicao' || /jurisdicao_caderno/.test(location.pathname)) return 'JURISDICAO';
    return null;
  }
  function podeExportarPagina() {
    if (!perfil) return false;
    if (perfil.admin) return true;
    var area = areaDaPagina();
    if (area) return podeExportar(area);
    var areas = Object.keys(perfil.areas);
    if (String(new URLSearchParams(location.search).get('perfil')).toLowerCase() === 'rodoviario') return areas.some(podeExportar);
    return areas.length > 0 && areas.filter(function(a) { return a !== 'JURISDICAO'; }).every(podeExportar);
  }

  function aplicarExportacao() {
    var pode = podeExportarPagina();
    document.documentElement.classList.toggle('sem-exportar', !pode);
    document.querySelectorAll('[data-exportar]').forEach(function(el) { if (!pode) el.hidden = true; });
  }

  function esconderSemAcesso() {
    document.querySelectorAll('[data-servico], [data-area]').forEach(function(el) {
      if (!podeVer(el.getAttribute('data-area') || el.getAttribute('data-servico'))) el.hidden = true;
    });
  }

  function mostrarUsuario() {
    var alvo = $('acessoUsuario');
    var el = document.createElement('span');
    el.className = 'acesso-usuario' + (alvo ? '' : ' acesso-usuario-flutuante');
    var areas = Object.keys(perfil.areas);
    el.title = perfil.email + (perfil.admin ? ' · administrador' : ' · ' + (areas.length
      ? areas.map(function(a) { return a + ': ' + (NOME_NIVEL[perfil.areas[a]] || perfil.areas[a]); }).join(', ') : 'sem áreas liberadas'));
    // Painel (painel.html): a partir de gerenciador em alguma area.
    var painel = perfil.admin || areas.some(podeExportar);
    el.innerHTML = '<span></span>' + (painel ? '<a class="acesso-admin" href="painel.html" title="Indicadores, avisos e aprovações">Painel</a>' : '') +
      (perfil.admin ? '<a class="acesso-admin" href="usuarios.html" title="Usuários e permissões">Usuários</a>' : '') +
      '<button type="button">Sair</button>';
    el.firstChild.textContent = perfil.nome;
    el.lastChild.addEventListener('click', sair);
    (alvo || document.body).appendChild(el);
  }

  function sair() {
    registrarEvento('saiu').then(function() { return sb.auth.signOut(); }).then(function() { location.reload(); });
  }

  // Faixa do ambiente: homologação (ou o site local usando a produção). Não some na impressão nem no login.
  function montarFaixa() {
    var local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    if (AMBIENTE === 'producao' && !local) return;
    var faixa = document.createElement('div');
    faixa.className = 'acesso-ambiente acesso-ambiente-' + AMBIENTE;
    faixa.textContent = AMBIENTE === 'producao' ? 'PRODUÇÃO · site local' : 'HOMOLOGAÇÃO · ambiente de teste';
    faixa.title = AMBIENTE === 'producao' ? 'Site local ligado ao banco de PRODUÇÃO: o que você gravar vale de verdade.'
      : 'Banco de homologação: dados de teste, nada aqui vale para a produção.';
    document.body.appendChild(faixa);
    document.documentElement.classList.add('amb-' + AMBIENTE);
    if (AMBIENTE !== 'producao') document.title = '[HOMOLOGAÇÃO] ' + document.title;
  }

  function iniciar() {
    montarTela();
    montarFaixa();
    sb.auth.onAuthStateChange(function(evento) {
      if (evento === 'PASSWORD_RECOVERY') setTimeout(function() { mostrarTela('', false, true); }, 0);
    });
    // Link de recuperacao de senha: espera o Supabase processar o token antes de conferir a sessao.
    if (/type=recovery/.test(location.hash)) return;
    verificar(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();

  return {
    pronto: pronto,
    cliente: sb,
    url: SUPABASE.url,                        // funções do servidor (Edge Functions) usam o mesmo projeto
    ambiente: AMBIENTE,                       // 'producao' | 'homologacao'
    perfil: function() { return perfil; },
    podeVer: podeVer,
    podeExportar: podeExportar,
    podePropor: podePropor,
    podeEditar: podeEditar,
    podeExportarPagina: podeExportarPagina,
    aplicarExportacao: aplicarExportacao,     // modulos que montam botoes depois do login chamam de novo
    nomeNivel: function(area) { return perfil && perfil.admin ? 'administrador' : NOME_NIVEL[perfil && perfil.areas[area]] || ''; },
    registrarEvento: registrarEvento,
    sair: sair
  };
})();
