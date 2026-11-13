// Acesso ao SIPLAWEB: login obrigatorio (Supabase Auth do projeto do ambiente: producao ou homologacao, abaixo).
// Permissoes por AREA (cada origem + JURISDICAO) no schema acesso do banco: cada area aponta para um PERFIL
// configuravel (acesso.perfis: exporta, propoe, grava direto, edita camadas, aprova propostas de quais perfis).
// Iniciais: visualizador, diretor, editor basico, editor pleno e gerenciador; administrador: tudo, em todas as areas;
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
    '.acesso-versao{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:100002;display:flex;align-items:center;gap:10px;' +
    'flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px);background:#0f2a1a;color:#fff;padding:10px 12px 10px 16px;border-radius:12px;' +
    'box-shadow:0 10px 28px rgba(0,0,0,.3);font:13px Inter,Segoe UI,Arial,sans-serif}' +
    '.acesso-versao span{opacity:.85}' +
    '.acesso-versao button{border:0;border-radius:8px;padding:7px 12px;font:700 12.5px Inter,Segoe UI,Arial,sans-serif;cursor:pointer;background:#22c55e;color:#06260f}' +
    '.acesso-versao button.depois{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);font-weight:600}' +
    '.acesso-versao button:disabled{opacity:.7;cursor:wait}' +
    '@media print{.acesso-versao{display:none!important}}' +
    '.acesso-novidades{border:0;border-radius:14px;padding:0 18px 14px;width:min(520px,calc(100vw - 32px));box-shadow:0 20px 50px rgba(0,0,0,.3);' +
    'font:13.5px/1.5 Inter,Segoe UI,Arial,sans-serif;color:#1f2937}' +
    '.acesso-novidades::backdrop{background:rgba(15,23,42,.45)}' +
    '.acesso-novidades-topo{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #e5e7eb}' +
    '.acesso-novidades-topo button{border:0;background:none;font-size:22px;cursor:pointer;color:#64748b}' +
    '.acesso-novidades h4{margin:14px 0 4px;font-size:14px}.acesso-novidades h4 small{color:#64748b;font-weight:500;margin-left:6px}' +
    '.acesso-novidades ul{margin:0;padding-left:18px}' +
    '.acesso-boasvindas{padding:0;width:min(480px,calc(100vw - 32px))}' +
    '.acesso-bv-topo{background:linear-gradient(135deg,#15803d,#16a34a);color:#fff;padding:20px 22px 16px;border-radius:14px 14px 0 0}' +
    '.acesso-bv-topo small{display:block;opacity:.85;font-size:12px;letter-spacing:.04em;text-transform:uppercase}' +
    '.acesso-bv-topo b{display:block;font-size:19px;margin-top:2px}' +
    '.acesso-bv-corpo{padding:16px 22px 6px}.acesso-bv-corpo p{margin:0 0 8px;color:#475569}' +
    '.acesso-bv-ajuda{margin:10px 0 0!important;padding:10px 12px;background:#f0fdf4;border-radius:8px;color:#14532d!important}' +
    '.acesso-bv-ajuda a{color:#15803d;font-weight:600}' +
    '.acesso-bv-corpo ul{list-style:none;padding:0;margin:0}' +
    '.acesso-bv-corpo li{position:relative;padding:8px 0 8px 26px;border-bottom:1px solid #f1f5f9}.acesso-bv-corpo li:last-child{border-bottom:0}' +
    '.acesso-bv-corpo li:before{content:"\\2713";position:absolute;left:2px;top:8px;color:#16a34a;font-weight:700}' +
    '.acesso-bv-acoes{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 22px 18px}' +
    '.acesso-bv-acoes a{color:#15803d;font-size:12.5px;cursor:pointer;text-decoration:underline;white-space:nowrap}' +
    '.acesso-bv-acoes button{flex:none!important;width:auto!important;margin:0!important;box-shadow:none!important;border:0!important;border-radius:8px;background:#15803d;color:#fff;font:600 13.5px Inter,Segoe UI,Arial,sans-serif;padding:9px 22px;cursor:pointer}' +
    '.acesso-bv-acoes button:hover{background:#166534}' +
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

  // Perfis (acesso.perfis, supabase/015_perfis.sql): cada area da pessoa aponta para um perfil com chaves liga/desliga.
  // O banco confere tudo de novo; aqui so decide o que mostrar. Administrador: tudo, em todas as areas.
  var ADMIN = { nome: 'administrador', exportar: true, propor: true, gravar: true, camadas: true, aprova: [] };
  function def(area) {
    if (!perfil) return null;
    if (perfil.admin) return ADMIN;
    var codigo = perfil.areas[area];
    return codigo ? (perfil.perfis || {})[codigo] || null : null;
  }
  function nomePerfil(codigo) { var f = perfil && (perfil.perfis || {})[codigo]; return codigo === 'admin' ? 'administrador' : f ? f.nome : codigo || ''; }
  function podeVer(area) { return !!def(area); }
  function podeExportar(area) { var f = def(area); return !!(f && f.exportar); }
  function podePropor(area) { var f = def(area); return !!(f && (f.propor || f.gravar)); }   // edita na tela (vira proposta se nao grava)
  function podeEditar(area) { var f = def(area); return !!(f && f.gravar); }                // grava direto, sem aprovacao
  function podeCamadas(area) { var f = def(area); return !!(f && f.camadas); }
  // Aprova alguma proposta na area / aprova a proposta de quem tem perfilAutor (ninguem aprova a propria).
  function aprovaNaArea(area) { var f = def(area); return !!(f && (perfil.admin || (f.aprova || []).length)); }
  // Exportar o histórico de alterações (13/11/2026): quem participa da edição na área (propõe, grava ou aprova):
  // editor básico, editor pleno, gerenciador e administrador; não o visualizador nem o diretor.
  function podeExportarHistorico(area) { return podePropor(area) || aprovaNaArea(area); }
  function podeAprovar(area, perfilAutor, autor) {
    if (!perfil || autor === perfil.user_id) return false;
    if (perfil.admin) return true;
    var f = def(area);
    return !!(f && (f.aprova || []).indexOf(perfilAutor || 'editor_basico') !== -1);
  }

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
    // Caderno de obras (obras_caderno.html?origens=DOR,DPJ): precisa exportar em todas as origens escolhidas.
    var origens = new URLSearchParams(location.search).get('origens');
    if (origens) return origens.split(',').every(function(a) { return podeExportar(a.trim().toUpperCase()); });
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
      ? areas.map(function(a) { return a + ': ' + nomePerfil(perfil.areas[a]); }).join(', ') : 'sem áreas liberadas'));
    // Painel (painel.html): quem exporta ou aprova em alguma area.
    var painel = perfil.admin || areas.some(function(a) { return podeExportar(a) || aprovaNaArea(a); });
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

  // ---------- Versão do site ----------
  // A cada publicação, VERSAO_SITE (aqui) e versao.json (raiz do site) recebem o MESMO valor novo. A página confere
  // versao.json sem cache ao abrir, a cada 5 minutos e quando a aba volta a ficar visível; se o publicado for outro,
  // mostra o aviso "Nova versão" (uma aba esquecida aberta continuava rodando o código antigo por dias).
  var VERSAO_SITE = '2026-11-13.15';
  var conferidaEm = 0, avisoAdiadoAte = 0;
  // Versão que as pessoas veem (rodapé do mapa e Painel): sobe o número a cada mudança relevante, com a data e o que
  // mudou em NOVIDADES (a mais nova primeiro). Correção pequena troca só VERSAO_SITE.
  // 4º item (opcional) = BOAS-VINDAS: resumo curto, em linguagem simples (sem termos técnicos), mostrado uma vez por
  // navegador ao entrar no mapa ou no Painel depois de cada versão nova (número novo). Toda versão nova deve ter.
  var NOVIDADES = [
    ['3.10', '13/11/2026', [
      'Tabela de obras com "Filtrar o mapa" ligado e filtro na coluna Município: os municípios escolhidos ficam como estão, os demais escurecem e o mapa se aproxima deles (respeita o Zoom automático). Células com mais de um município ("A / B", "A, B", "A e B") destacam todos.'
    ], [
      'Na tabela de obras, filtre a coluna Município e ligue "Filtrar o mapa": os municípios escolhidos ficam em destaque e o mapa se aproxima deles.'
    ]],
    ['3.9', '13/11/2026', [
      'Obras no mesmo trecho em tracejado alternado: as linhas ficam sobre o mesmo traçado, em traços que se alternam, cada um com a cor e o estilo da sua obra, em qualquer zoom (substitui o lado a lado da 3.8); sombra única por baixo; o popup de qualquer delas lista todas as obras do trecho.',
      'Jurisdição: clicar num tipo da legenda (Estadualização, Federalização, Municipalização) mostra só ele no mapa — no módulo, é o mesmo filtro Tipo da barra esquerda; nos outros mapas, com a Jurisdição ligada como camada de referência, filtra só o desenho dela.',
      'GME e GMK: placas próprias para ponte/OAE e bueiro concluídos (etapa Obra com status Concluído), também na legenda.'
    ], [
      'Quando duas obras passam pelo mesmo trecho de rodovia, a linha alterna as cores das duas. Clique nela para ver todas as obras do trecho.',
      'Na Jurisdição, clique num tipo da legenda para ver só ele no mapa.',
      'No GME e no GMK, pontes e bueiros concluídos ganharam placa própria.'
    ]],
    ['3.8', '13/11/2026', [
      'Obras no mesmo trecho: quando duas ou mais obras usam o mesmo segmento (da mesma origem ou de origens diferentes), cada uma é desenhada com a sua simbologia, lado a lado, a partir do zoom 11. Antes o mapa ligava só uma obra por origem a cada segmento e a outra ficava escondida (ex.: OB26-01518 Duplicação e OB26-01574 Restauração no TRE0051).'
    ], [
      'Quando duas obras passam pelo mesmo trecho de rodovia, agora as duas aparecem lado a lado, cada uma com a sua cor. Aproxime o mapa para ver.'
    ]],
    ['3.7', '12/11/2026', [
      'Tabela de obras e tabela das camadas de referência com o mesmo menu Exportar da Jurisdição: Excel com todos ou só os filtrados, CSV, GeoJSON com atributos para o QGIS (obras com o traçado) e, nas obras, o caderno completo e o mapa A4 da obra selecionada. Só aparece para quem exporta.',
      'Filtros: nova opção "Isolar seleção", ao lado do Auto zoom. Ligada (padrão), Rodovia, SRE, Ferrovia, Município, Regiões e Área de Estudo mostram só o que foi escolhido; desligada, o mapa mostra tudo e destaca a escolha em laranja. Fica lembrada no navegador.',
      'Tabelas de obras e da Jurisdição: o Tab depois de editar uma célula passa para a próxima sem erro.',
      'Exportar › Histórico de alterações (período), nas tabelas de obras e da Jurisdição: planilha Excel com cada alteração gravada entre duas datas (campo, antes, depois, autor, quem propôs), de todos os registros ou só dos filtrados. Para quem edita ou aprova (editor básico, editor pleno, gerenciador, administrador).',
      'Tabela de obras e tabela das camadas com o indicador "Dados do banco" da Jurisdição: mostra Carregando/Salvando/Erro e, ao clicar, busca os dados de novo no banco. Nas camadas, indica se a camada vem do banco (malha complementar, área de estudo, área de influência) ou é uma camada de base publicada com o site.',
      'Clique num lugar sem obra (dentro de um parque, numa área vazia): o popup mostra as camadas ligadas que contêm o ponto (município, área ambiental, área urbana, regiões, área de estudo, raio de saúde, curso d’água). Antes as camadas de cima impediam o clique de chegar às áreas e nada abria.'
    ], [
      'Novo botão Exportar nas tabelas de obras e das camadas, como na Jurisdição: planilha Excel (todas ou só as filtradas), CSV e arquivo para o QGIS.',
      'Nos filtros do mapa, a opção "Isolar seleção": desligada, o mapa continua mostrando tudo e só destaca em laranja a rodovia, o município ou a região escolhida.',
      'Na tabela, a tecla Tab passa para a próxima célula sem problemas.',
      'Quem edita ou aprova pode exportar o histórico de alterações de um período: o que mudou, quando, o valor antes e depois e quem fez.',
      'Clicando em qualquer ponto do mapa, mesmo sem obra, você vê o município, o parque ou a área ambiental e as demais camadas ligadas naquele lugar.'
    ]],
    ['3.6', '12/11/2026', [
      'Legenda como filtro: clicar no nome de um item da legenda mostra no mapa só aquele item (clique em outros para somar, de novo para desmarcar; "Mostrar todos" desfaz). Vale para as obras e para as camadas de referência com mais de um item (rodovias estaduais e federais pela situação, aeródromos, regiões, área de influência, unidades de saúde); cada camada filtra só a si mesma.',
      'Os outros estados, fora de Goiás, aparecem num cinza mais claro.'
    ], [
      'A legenda, à direita do mapa, agora também filtra: clique no nome de um item para ver só ele no mapa. Clique em outros para somar e no mesmo de novo para desmarcar.',
      'Funciona nas obras e nas camadas de apoio, como as rodovias estaduais e federais, os aeródromos e as regiões.',
      'O botão "Mostrar todos", no alto da legenda, volta a mostrar tudo.',
      'Os estados vizinhos aparecem num cinza mais claro, deixando Goiás em destaque.'
    ]],
    ['3.5', '11/11/2026', [
      'Tabela de atributos das camadas de referência: no popup de um aeródromo, localidade, município, trecho da malha estadual, federal ou complementar, ferrovia, pedágio, área, região ou curso d’água, o botão "Tabela: …" abre a tabela daquela camada, já com a feição clicada selecionada e destacada no mapa.',
      'Na tabela: busca, filtro tipo Excel em cada coluna, ordenação, exportação para Excel, tela cheia ou dividida com o mapa e o botão "Filtrar o mapa" (o mapa mostra só as feições filtradas; um aviso no alto do mapa permite desfazer). Só consulta: as camadas editáveis continuam em "Editar camadas".'
    ]],
    ['3.4', '10/11/2026', [
      'FUNDEINFRA passa a ser um filtro: o botão e o cartão FUNDEINFRA mostram as obras da DOR, da DPJ e das demais origens com recurso do Fundeinfra (fonte Fundeinfra ou Associativo-Fundeinfra). Cada obra continua na sua origem; com as duas ligadas, o trecho aparece uma vez só.',
      'Painel › Configurações › Listas de valores (administrador): opções das listas suspensas das obras (etapa, status, intervenção, modalidade, fonte, fase). Incluir, renomear (atualiza as obras que usam o valor), juntar valores repetidos (\"Juntar com…\"), mudar a ordem, desativar e excluir valor sem uso.',
      'Obras DPJ atualizadas (camadas de 10/11/2026), no padrão da DOR: modalidade Projeto / Anteprojeto / Obra / Obra Integrada; etapa Projeto, Licitação (projeto em licitação) ou Planejamento (estudo técnico preliminar); "Nº na origem" com o código da DPJ (TRC_ / PNT_).',
      'Tabela de obras: novas posições das colunas (Nº na origem e Rodovia antes da Descrição, SRE logo depois; Fonte do recurso antes da Etapa) e a Fonte do recurso com cor, como a Etapa.',
      'Tabela de obras: botão "Filtrar o mapa". Ligado, o mapa mostra só as obras da origem da tabela que passam na busca e nos filtros das colunas (as das outras origens continuam) e se aproxima delas; vale também com a tabela fechada (o botão "Abrir tabela de obras" avisa).',
      'A barra lateral esquerda (ORIGEM, filtros, camadas) agora abre sempre aberta nas origens; só o mapa rodoviário abre com ela recolhida.'
    ]],
    ['3.3', '05/11/2026', [
      'Nova camada de referência "Hidrografia": cursos d’água que cruzam as rodovias estaduais e federais, até 2 km de cada lado (base da ANA). Onde o curso continua além da faixa, a linha fica tracejada. Clique para ver o nome, a área de drenagem e as rodovias que cruza.',
      'Nomes dos cursos d’água ao longo da linha (azul, sem sobreposição): os maiores primeiro, mais nomes ao aproximar o mapa.',
      'Filtro "Curso d’água" (depois do Município): busca pelo nome, destaca o curso e aproxima o mapa.',
      'Obras pontuais (com coordenadas) junto a um curso d’água, até 100 m, contam como cruzamento: o curso entra com a mesma regra das rodovias (2 km em volta da obra). A malha complementar (vicinais) também conta como rodovia.',
      'Malha complementar (vicinais) como camada de referência: botão "Malha Complementar", depois da Malha Federal.',
      'Cursos d’água em azul mais claro (os nomes continuam em azul escuro).',
      'Clique na malha estadual: mais dados do SRE (início e fim, situação, revestimento, km, classe, perímetro urbano, faixa de domínio, VMDa, região) e o trecho coincidente com os códigos sobrepostos, estaduais e federais, em ordem de número (prevalece a de menor número).',
      'Ligada por padrão só no mapa rodoviário; nos outros, botão "Hidrografia" das camadas de referência.',
      'Tabelas de obras e da Jurisdição: filtro em cada coluna, logo abaixo do título, como no Excel (ícone de funil, cheio quando a coluna está filtrada; lista dos valores com caixas de marcar, pesquisa, selecionar tudo e vazias). A busca geral continua no mesmo lugar.',
      'Mapa e pranchas dos cadernos com o limite dos estados vizinhos; nas pranchas, a sigla de cada estado aparece quando a folha mostra uma divisa.',
      'Pranchas dos cadernos sempre com a hidrografia (cursos d’água com o nome ao longo da linha) e o item na legenda.',
      'Nomes dos cursos d’água não cobrem as obras (no mapa e nas pranchas) nem os outros nomes da prancha.',
      'Pranchas: nomes dos cursos d’água com letra menor, em todos os cursos que couberem (abreviados, como Cór. e Rib., quando o nome inteiro não cabe), sem cobrir as rodovias.',
      'Pranchas de obras: ícones de viaduto (ciano), ponte (marrom), bueiro (cinza) e aeródromo (amarelo).'
    ]],
    ['3.2', '04/11/2026', [
      'Popup das obras no mapa: botão "Abrir na tabela", que abre a tabela de obras já na ficha da obra (como o "Abrir detalhes" da Jurisdição). No mapa geral, abre o mapa da origem em outra aba.',
      'GME e GMK com placas próprias para OAE/ponte e bueiro, em projeto e em obra.'
    ]],
    ['3.1', '29/10/2026', [
      'Caderno de obras em PDF (botão "Caderno PDF" da tabela de obras): capa, índice, resumo e, por seção, planilha e um mapa por obra, no formato dos cadernos de obras e de projetos da GOINFRA.',
      'Dá para juntar origens no mesmo caderno (ex.: DOR e depois DPJ). Na ficha, "Mapa A4" gera o mapa de uma obra.',
      'Nos mapas do caderno, obras pontuais com ícone (aeródromo, bueiro, duplicação, pavimentação, ponte, viaduto) e rodovias e localidades em toda a folha.'
    ]],
    ['3.0', '27/10/2026', [
      'Perfis de acesso configuráveis (Painel › Configurações, pelo administrador master); perfil novo: Diretor (vê e exporta).',
      'Aprovação em dois degraus: o editor pleno aprova o editor básico; o gerenciador aprova os dois, sem editar.',
      'Excluir, mudar a obra de origem e remover trâmite também passam por aprovação.',
      'Camadas: as alterações do editor pleno ficam tracejadas, aguardando aprovação, até o gerenciador decidir.',
      'Painel: quadro "Alterações e aprovações" (kanban) com tudo o que está aguardando ou foi decidido.'
    ]],
    ['2.4', '26/10/2026', ['Banco em São Paulo, ambiente de homologação e aviso de versão nova.']]
  ];
  function textoVersao() { return 'VER. ' + NOVIDADES[0][0] + ' · ' + NOVIDADES[0][1]; }
  function mostrarNovidades() {
    var dlg = $('acessoNovidades');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'acessoNovidades';
      dlg.className = 'acesso-novidades';
      dlg.innerHTML = '<div class="acesso-novidades-topo"><b>Novidades do site</b><button type="button" title="Fechar">×</button></div>' +
        NOVIDADES.map(function(n) {
          return '<h4>Versão ' + n[0] + ' <small>' + n[1] + '</small></h4><ul>' + n[2].map(function(t) { var li = document.createElement('li'); li.textContent = t; return li.outerHTML; }).join('') + '</ul>';
        }).join('');
      dlg.querySelector('button').addEventListener('click', function() { dlg.close(); });
      dlg.addEventListener('click', function(e) { if (e.target === dlg) dlg.close(); });
      document.body.appendChild(dlg);
    }
    dlg.showModal();
  }
  // Boas-vindas da versão nova: ao entrar num módulo (mapa, Painel) depois do login, uma vez por navegador e por
  // número de versão (NOVIDADES[0][0]), com o resumo simples da versão (NOVIDADES[0][3]).
  var CHAVE_BOAS_VINDAS = 'siplaweb.boasVindasVersao';
  // ?boasvindas=1 no endereço mostra de novo (lido ao carregar, antes que a página troque o endereço)
  var FORCAR_BOAS_VINDAS = /[?&]boasvindas=1(&|$)/.test(location.search);
  function mostrarBoasVindas() {
    var atual = NOVIDADES[0];
    if (!atual[3] || !atual[3].length || $('acessoBoasVindas')) return;
    if (!/(^|\/)(mapa|painel)\.html$/.test(location.pathname)) return;
    var vista = '';
    try { vista = localStorage.getItem(CHAVE_BOAS_VINDAS) || ''; } catch (e) { /* sem armazenamento: mostra */ }
    if (vista === atual[0] && !FORCAR_BOAS_VINDAS) return;
    var dlg = document.createElement('dialog');
    dlg.id = 'acessoBoasVindas';
    dlg.className = 'acesso-novidades acesso-boasvindas';
    var nome = perfil && perfil.nome ? String(perfil.nome).split(' ')[0] : '';
    var topo = document.createElement('div');
    topo.className = 'acesso-bv-topo';
    topo.innerHTML = '<small>Versão ' + atual[0] + ' · ' + atual[1] + '</small><b></b>';
    topo.querySelector('b').textContent = 'Bem-vindo' + (nome ? ', ' + nome : '') + '! Veja o que há de novo';
    var corpo = document.createElement('div');
    corpo.className = 'acesso-bv-corpo';
    var lista = document.createElement('ul');
    atual[3].forEach(function(t) { var li = document.createElement('li'); li.textContent = t; lista.appendChild(li); });
    corpo.appendChild(lista);
    var ajuda = document.createElement('p');
    ajuda.className = 'acesso-bv-ajuda';
    ajuda.innerHTML = 'Precisa de ajuda? <a href="ajuda.html#inicio" target="_blank" rel="noopener">Clique aqui para começar.</a>';
    ajuda.querySelector('a').addEventListener('click', function() { fechar(); });
    corpo.appendChild(ajuda);
    var acoes = document.createElement('div');
    acoes.className = 'acesso-bv-acoes';
    acoes.innerHTML = '<a data-todas>Ver todas as novidades</a><button type="button" data-ok autofocus>Entendi</button>';
    dlg.append(topo, corpo, acoes);
    function fechar() {
      try { localStorage.setItem(CHAVE_BOAS_VINDAS, atual[0]); } catch (e) { /* ignora */ }
      if (dlg.open) dlg.close();
    }
    dlg.addEventListener('close', fechar);
    dlg.addEventListener('click', function(e) { if (e.target === dlg) fechar(); });
    acoes.querySelector('[data-ok]').addEventListener('click', fechar);
    acoes.querySelector('[data-todas]').addEventListener('click', function() { fechar(); mostrarNovidades(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // Onde a página tiver [data-versao-site] (rodapé do mapa, Painel), escreve a versão; clicar abre as novidades.
  function mostrarVersao() {
    document.querySelectorAll('[data-versao-site]').forEach(function(el) {
      el.textContent = (el.getAttribute('data-versao-site') || '') + textoVersao();
      el.title = 'Ver as novidades desta versão';
      el.style.cursor = 'pointer';
      el.addEventListener('click', mostrarNovidades);
    });
  }

  function conferirVersao() {
    conferidaEm = Date.now();
    return fetch('versao.json?t=' + Date.now(), { cache: 'no-store' }).then(function(r) { return r.ok ? r.json() : null; })
      .then(function(j) { if (j && j.versao && j.versao !== VERSAO_SITE && Date.now() > avisoAdiadoAte) mostrarAvisoVersao(j.versao); })
      .catch(function() { /* sem internet ou arquivo: tenta na próxima */ });
  }

  function mostrarAvisoVersao(nova) {
    if ($('acessoVersao')) return;
    var aviso = document.createElement('div');
    aviso.id = 'acessoVersao';
    aviso.className = 'acesso-versao';
    aviso.innerHTML = '<b>Nova versão do site publicada.</b><span>Atualize para usar a versão mais recente.</span>' +
      '<button type="button" data-atualizar>Atualizar agora</button><button type="button" class="depois" data-depois>Depois</button>';
    aviso.title = 'Versão aberta: ' + VERSAO_SITE + ' · publicada: ' + nova;
    aviso.querySelector('[data-atualizar]').addEventListener('click', atualizarSite);
    aviso.querySelector('[data-depois]').addEventListener('click', function() { avisoAdiadoAte = Date.now() + 30 * 60000; aviso.remove(); });
    document.body.appendChild(aviso);
  }

  function pendentesNaoSalvos() {
    var n = 0;
    try { if (typeof ObrasStore !== 'undefined' && ObrasStore.totalPendentes) n += ObrasStore.totalPendentes(); } catch (e) { /* módulo não carregado */ }
    try { if (typeof Store !== 'undefined' && Store.totalPendentes) n += Store.totalPendentes(); } catch (e) { /* idem */ }
    return n;
  }

  // Equivale ao Ctrl+F5: baixa de novo (sem cache) os scripts, estilos e camadas que esta página usou e recarrega.
  function atualizarSite() {
    var n = pendentesNaoSalvos();
    if (n && !confirm('Há ' + n + ' alteração(ões) não salvas nesta página. Atualizar agora descarta essas alterações.\n\nAtualizar mesmo assim?')) return;
    var botao = document.querySelector('#acessoVersao [data-atualizar]');
    if (botao) { botao.disabled = true; botao.textContent = 'Atualizando…'; }
    var urls = {};
    document.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach(function(el) { urls[el.src || el.href] = 1; });
    if (window.performance && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach(function(r) { if (/\.(geojson|json|js|css|svg|png|jpe?g)(\?|$)/i.test(r.name)) urls[r.name] = 1; });
    }
    var proprias = Object.keys(urls).filter(function(u) { return u.indexOf(location.origin) === 0; });
    return Promise.all(proprias.map(function(u) { return fetch(u, { cache: 'reload' }).catch(function() {}); })).then(function() {
      var url = new URL(location.href);
      url.searchParams.set('_atualizar', Date.now());
      location.replace(url.toString());
    });
  }

  function vigiarVersao() {
    conferirVersao();
    setInterval(conferirVersao, 5 * 60000);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && Date.now() - conferidaEm > 60000) conferirVersao();
    });
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
    // Data da última cópia da produção (tools/homologacao/recopiar_homologacao.ps1); a função só existe na homologação
    // e o esquema siplaweb só abre depois do login.
    if (AMBIENTE === 'homologacao') pronto.then(function() { return sb.rpc('homologacao_copia'); }).then(function(r) {
      var c = r && r.data;
      if (!c || !c.feita_em) return;
      var quando = function(v) { var d = new Date(v); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
      faixa.textContent = c.producao_lida_em ? 'HOMOLOGAÇÃO · dados de ' + quando(c.producao_lida_em)
        : 'HOMOLOGAÇÃO · restaurada em ' + quando(c.feita_em);
      faixa.title += '\nÚltima carga em ' + quando(c.feita_em) + ': ' + c.situacao + '.';
    });
  }

  function iniciar() {
    montarTela();
    montarFaixa();
    mostrarVersao();
    vigiarVersao();
    pronto.then(function() { setTimeout(mostrarBoasVindas, 1200); });   // depois do login, com a tela já montada
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
    versao: VERSAO_SITE,
    versaoTexto: textoVersao,                 // "VER. 3.0 · 27/10/2026"
    mostrarNovidades: mostrarNovidades,
    atualizarSite: atualizarSite,             // botão "Atualizar site" do mapa e aviso de versão nova
    perfil: function() { return perfil; },
    podeVer: podeVer,
    podeExportar: podeExportar,
    podePropor: podePropor,
    podeEditar: podeEditar,
    podeCamadas: podeCamadas,
    aprovaNaArea: aprovaNaArea,
    podeExportarHistorico: podeExportarHistorico,
    podeAprovar: podeAprovar,
    nomePerfil: nomePerfil,
    podeExportarPagina: podeExportarPagina,
    aplicarExportacao: aplicarExportacao,     // modulos que montam botoes depois do login chamam de novo
    nomeNivel: function(area) { return perfil && perfil.admin ? 'administrador' : perfil ? nomePerfil(perfil.areas[area]) : ''; },
    registrarEvento: registrarEvento,
    sair: sair
  };
})();
