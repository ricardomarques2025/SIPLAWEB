// Usuarios e permissoes (usuarios.html), so para administradores.
// Dados e regras no banco (supabase/006_admin_master.sql): administrador gerencia usuarios comuns; administradores
// (criar, promover, rebaixar, editar, desativar) e exclusao de conta so o master; o master so ele mesmo.
// Criar conta, redefinir senha e excluir passam pela Edge Function "admin-usuarios" (chave secreta fica nela).

(function() {
  var sb = Acesso.cliente;   // schema siplaweb
  var FUNCAO = Acesso.url + '/functions/v1/admin-usuarios';
  // Perfis (acesso.perfis, supabase/015_perfis.sql), na ordem definida no Painel › Configurações.
  function niveis() { return [['', 'Sem acesso']].concat((dados.perfis || []).map(function(f) { return [f.codigo, f.nome]; })); }
  var ACOES = { criou: 'Criou a conta', alterou: 'Alterou', redefiniu_senha: 'Redefiniu a senha', excluiu: 'Excluiu a conta' };

  var dados = { eu: {}, areas: [], usuarios: [], perfis: [] };
  var selecionado = null;

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function fmtDataHora(v) { return v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }
  function toast(msg, erro) {
    var el = document.createElement('div');
    el.className = 'toast' + (erro ? ' toast-erro' : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(function() { el.remove(); }, erro ? 8000 : 3500);
  }

  function carregar() {
    return sb.rpc('admin_usuarios').then(function(res) {
      if (res.error) throw new Error(res.error.message);
      dados = res.data;
      renderLista();
      if (selecionado) renderFicha();
    });
  }

  // Regras de quem pode mexer em quem (o banco confere de novo).
  function podeGerenciar(u) {
    if (u.master) return u.user_id === dados.eu.user_id;
    if (u.admin) return dados.eu.master;
    return true;
  }
  function motivoBloqueio(u) {
    if (u.master && u.user_id !== dados.eu.user_id) return 'O administrador master só pode ser alterado por ele mesmo.';
    if (u.admin && !dados.eu.master) return 'Administradores só podem ser alterados pelo administrador master.';
    return '';
  }

  // ---------- Lista ----------
  function papel(u) {
    if (u.master) return '<span class="selo selo-master">master</span>';
    if (u.admin) return '<span class="selo selo-admin">administrador</span>';
    return '';
  }
  function renderLista() {
    var termo = semAcento($('busca').value.trim()), filtro = $('filtro').value;
    var lista = dados.usuarios.filter(function(u) {
      if (termo && semAcento(u.nome + ' ' + u.email).indexOf(termo) === -1) return false;
      if (filtro === 'ativos' && !u.ativo) return false;
      if (filtro === 'inativos' && u.ativo) return false;
      if (filtro === 'admins' && !u.admin) return false;
      if (filtro === 'trocar' && !u.trocar_senha) return false;
      return true;
    });
    $('listaUsuarios').innerHTML = lista.length ? lista.map(function(u) {
      var areas = Object.keys(u.areas || {}).length;
      return '<button type="button" class="item' + (u.user_id === selecionado ? ' ativo' : '') + (u.ativo ? '' : ' inativo') + '" data-id="' + u.user_id + '">' +
        '<b>' + esc(u.nome) + '</b> ' + papel(u) + (u.ativo ? '' : '<span class="selo selo-inativo">inativo</span>') +
        (u.trocar_senha ? '<span class="selo selo-senha">senha provisória</span>' : '') +
        '<small>' + esc(u.email) + ' · ' + (u.admin ? 'todas as áreas' : areas + (areas === 1 ? ' área' : ' áreas')) + '</small></button>';
    }).join('') : '<div class="vazio">Nenhum usuário com esse filtro.</div>';
  }

  // ---------- Ficha ----------
  function renderFicha() {
    var u = dados.usuarios.find(function(x) { return x.user_id === selecionado; });
    if (!u) { $('ficha').innerHTML = '<div class="vazio">Escolha um usuário na lista ou crie um novo.</div>'; return; }
    var pode = podeGerenciar(u), bloq = pode ? '' : ' disabled', ehMaster = dados.eu.master;
    var origens = dados.areas.filter(function(a) { return a.tipo === 'origem'; });
    var sites = dados.areas.filter(function(a) { return a.tipo !== 'origem'; });
    function linhaArea(a) {
      var v = (u.areas || {})[a.codigo] || '';
      return '<label class="area"><span>' + esc(a.codigo) + (a.nome && a.nome !== a.codigo ? ' <small>' + esc(a.nome) + '</small>' : '') + '</span>' +
        '<select data-area="' + esc(a.codigo) + '"' + bloq + ' class="nivel-' + (v || 'nenhum') + '">' +
        niveis().map(function(n) { return '<option value="' + n[0] + '"' + (n[0] === v ? ' selected' : '') + '>' + esc(n[1]) + '</option>'; }).join('') + '</select></label>';
    }
    $('ficha').innerHTML =
      '<div class="ficha-topo"><div><h2>' + esc(u.nome) + ' ' + papel(u) + '</h2><div class="sub">' + esc(u.email) +
        ' · criado em ' + fmtDataHora(u.criado_em) + ' · último acesso ' + fmtDataHora(u.ultimo_acesso) + '</div></div></div>' +
      (pode ? '' : '<div class="bloqueio">' + esc(motivoBloqueio(u)) + '</div>') +
      '<div class="grupo"><label class="campo">Nome<input id="fNome" value="' + esc(u.nome) + '"' + bloq + '></label>' +
        '<label class="chave"><input type="checkbox" id="fAtivo"' + (u.ativo ? ' checked' : '') + (u.master ? ' disabled' : bloq) + '> Conta ativa (pode entrar)</label>' +
        '<label class="chave"><input type="checkbox" id="fAdmin"' + (u.admin ? ' checked' : '') + (u.master || !ehMaster ? ' disabled' : bloq) + '> Administrador' +
          '<small>' + (ehMaster ? 'acesso total a todas as áreas e gerencia usuários comuns' : 'só o administrador master define administradores') + '</small></label>' +
      '</div>' +
      '<div class="grupo" id="grupoNiveis"' + (u.admin ? ' hidden' : '') + '><h3>Perfil por área</h3>' +
        '<p class="nota">' + (dados.perfis || []).map(function(f) { return '<b>' + esc(f.nome) + '</b>: ' + esc(f.descricao); }).join(' · ') +
          ' <a href="painel.html">Perfis no Painel › Configurações</a></p>' +
        (pode ? '<div class="todas">Aplicar a todas as origens: <select id="fTodas"><option value="-">—</option>' +
          niveis().map(function(n) { return '<option value="' + n[0] + '">' + esc(n[1]) + '</option>'; }).join('') + '</select></div>' : '') +
        '<div class="areas"><h4>Origens</h4>' + origens.map(linhaArea).join('') + '</div>' +
        '<div class="areas"><h4>Módulos</h4>' + sites.map(linhaArea).join('') + '</div>' +
      '</div>' +
      '<p class="nota" id="notaAdmin"' + (u.admin ? '' : ' hidden') + '>Administrador acessa todas as áreas com todos os poderes (grava direto e aprova tudo).</p>' +
      '<div class="acoes">' +
        (pode && !u.master && ehMaster ? '<button type="button" class="btn btn-perigo" id="fExcluir">Excluir conta</button>' : '') +
        (pode ? '<button type="button" class="btn" id="fSenha">Redefinir senha</button>' : '') +
        '<div class="espaco"></div>' +
        (pode ? '<button type="button" class="btn btn-primario" id="fSalvar">Salvar alterações</button>' : '') +
      '</div>';
    if (!pode) return;
    $('fAdmin').addEventListener('change', function() { $('grupoNiveis').hidden = this.checked; $('notaAdmin').hidden = !this.checked; });
    if ($('fTodas')) $('fTodas').addEventListener('change', function() {
      if (this.value === '-') return;
      var v = this.value;
      origens.forEach(function(a) { var s = document.querySelector('#ficha select[data-area="' + a.codigo + '"]'); s.value = v; s.className = 'nivel-' + (v || 'nenhum'); });
      this.value = '-';
    });
    $('ficha').querySelectorAll('select[data-area]').forEach(function(s) { s.addEventListener('change', function() { s.className = 'nivel-' + (s.value || 'nenhum'); }); });
    $('fSalvar').addEventListener('click', function() { salvar(u); });
    $('fSenha').addEventListener('click', function() { redefinirSenha(u); });
    if ($('fExcluir')) $('fExcluir').addEventListener('click', function() { excluir(u); });
  }

  function salvar(u) {
    var areas = {};
    if (!$('fAdmin').checked) $('ficha').querySelectorAll('select[data-area]').forEach(function(s) { if (s.value) areas[s.dataset.area] = s.value; });
    else areas = u.areas || {};
    if ($('fAdmin').checked !== !!u.admin && !confirm($('fAdmin').checked ? 'Tornar ' + u.nome + ' administrador (acesso total)?' : 'Tirar o acesso de administrador de ' + u.nome + '?')) return;
    $('fSalvar').disabled = true;
    sb.rpc('admin_salvar_usuario', { p_user_id: u.user_id, p_nome: $('fNome').value.trim(), p_ativo: $('fAtivo').checked, p_admin: $('fAdmin').checked, p_areas: areas })
      .then(function(res) {
        if (res.error) throw new Error(res.error.message);
        toast('Alterações de ' + u.nome + ' salvas');
        return carregar();
      }).catch(function(e) { toast(e.message, true); if ($('fSalvar')) $('fSalvar').disabled = false; });
  }

  // ---------- Edge Function ----------
  function chamarFuncao(corpo) {
    return sb.auth.getSession().then(function(r) {
      var token = r.data.session && r.data.session.access_token;
      if (!token) throw new Error('Sessão expirada. Entre novamente.');
      return fetch(FUNCAO, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(corpo) });
    }).then(function(resp) {
      return resp.json().catch(function() { return {}; }).then(function(j) {
        if (!resp.ok) throw new Error(j.erro || 'Falha (' + resp.status + ')');
        return j;
      });
    });
  }

  function mostrarSenha(titulo, email, senha) {
    $('senhaTitulo').textContent = titulo;
    $('senhaEmail').textContent = email;
    $('senhaValor').textContent = senha;
    $('dlgSenha').showModal();
  }

  function criar(e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData($('formNovo')));
    $('avisoNovo').textContent = 'Criando…';
    chamarFuncao({ acao: 'criar', nome: d.nome.trim(), email: d.email.trim() }).then(function(r) {
      $('dlgNovo').close();
      $('formNovo').reset();
      selecionado = r.user_id;
      mostrarSenha('Conta criada', d.email.trim().toLowerCase(), r.senha);
      return carregar();
    }).catch(function(err) { $('avisoNovo').textContent = err.message; });
  }

  function redefinirSenha(u) {
    if (!confirm('Gerar uma nova senha provisória para ' + u.nome + '? A senha atual deixa de valer.')) return;
    chamarFuncao({ acao: 'redefinir_senha', user_id: u.user_id }).then(function(r) {
      mostrarSenha('Nova senha provisória', u.email, r.senha);
      return carregar();
    }).catch(function(err) { toast(err.message, true); });
  }

  function excluir(u) {
    if (!confirm('Excluir a conta de ' + u.nome + ' (' + u.email + ')? Não dá para desfazer.\n\nSe a pessoa já editou dados, prefira desativar a conta (o histórico guarda o nome dela).')) return;
    chamarFuncao({ acao: 'excluir', user_id: u.user_id }).then(function() {
      toast('Conta de ' + u.nome + ' excluída');
      selecionado = null;
      return carregar();
    }).catch(function(err) {
      toast(/foreign key|violates|referenced/i.test(err.message) ? 'Esta pessoa já tem registros no sistema; desative a conta em vez de excluir.' : err.message, true);
    });
  }

  // ---------- Registro ----------
  function renderRegistro() {
    $('registro').innerHTML = '<div class="vazio">Carregando…</div>';
    sb.rpc('admin_auditoria', { p_limite: 300 }).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      var nomeArea = function(k) { return k; };
      $('registro').innerHTML = res.data.length ? res.data.map(function(r) {
        var mud = [];
        if (r.acao === 'alterou' && r.antes && r.depois) {
          ['nome', 'ativo', 'admin'].forEach(function(k) {
            if (JSON.stringify(r.antes[k]) !== JSON.stringify(r.depois[k])) mud.push('<b>' + k + '</b>: ' + esc(r.antes[k]) + ' → ' + esc(r.depois[k]));
          });
          var a = r.antes.areas || {}, d = r.depois.areas || {};
          Object.keys(Object.assign({}, a, d)).sort().forEach(function(k) {
            if (a[k] !== d[k]) mud.push('<b>' + esc(nomeArea(k)) + '</b>: ' + esc(a[k] || 'sem acesso') + ' → ' + esc(d[k] || 'sem acesso'));
          });
        }
        return '<div class="reg"><div class="reg-cab">' + fmtDataHora(r.quando) + ' · <b>' + esc(r.por_nome || '—') + '</b> · ' + (ACOES[r.acao] || r.acao) +
          ' · ' + esc(r.alvo_email || '') + '</div>' + (mud.length ? '<div class="reg-mud">' + mud.join('<br>') + '</div>' : '') + '</div>';
      }).join('') : '<div class="vazio">Nenhuma alteração registrada ainda.</div>';
    }).catch(function(e) { $('registro').innerHTML = '<div class="vazio">Erro: ' + esc(e.message) + '</div>'; });
  }

  // ---------- Inicio ----------
  Acesso.pronto.then(function(perfil) {
    if (!perfil.admin) { $('restrito').hidden = false; return; }
    $('adm').hidden = false;
    $('busca').addEventListener('input', renderLista);
    $('filtro').addEventListener('change', renderLista);
    $('listaUsuarios').addEventListener('click', function(e) {
      var b = e.target.closest('[data-id]');
      if (!b) return;
      selecionado = b.dataset.id;
      renderLista();
      renderFicha();
    });
    $('novo').addEventListener('click', function() { $('avisoNovo').textContent = ''; $('dlgNovo').showModal(); });
    $('formNovo').addEventListener('submit', criar);
    $('copiarSenha').addEventListener('click', function() {
      navigator.clipboard.writeText('E-mail: ' + $('senhaEmail').textContent + '\nSenha provisória: ' + $('senhaValor').textContent)
        .then(function() { toast('Copiado'); }, function() { toast('Não foi possível copiar; selecione e copie manualmente', true); });
    });
    document.querySelectorAll('[data-fechar]').forEach(function(b) { b.addEventListener('click', function() { b.closest('dialog').close(); }); });
    document.querySelectorAll('.adm-abas button').forEach(function(b) {
      b.addEventListener('click', function() {
        document.querySelectorAll('.adm-abas button').forEach(function(x) { x.classList.toggle('ativo', x === b); });
        $('abaUsuarios').hidden = b.dataset.aba !== 'usuarios';
        $('abaRegistro').hidden = b.dataset.aba !== 'registro';
        if (b.dataset.aba === 'registro') renderRegistro();
      });
    });
    if (location.hash === '#registro') document.querySelector('.adm-abas [data-aba="registro"]').click();   // link do painel
    carregar().catch(function(e) { toast(e.message, true); });
  });
})();
