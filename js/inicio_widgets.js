// Widgets da faixa de boas-vindas da página inicial (19/11/2026). Padrão: Aprovações, Calendário e Bloco de notas;
// opcionais em "Personalizar": Meus cartões (resumo do kanban), Novidades do site e Alterações recentes.
// Cada widget só aparece para quem precisa dele (ex.: diretor não propõe nem aprova e não tem a área Gerência: vê só o
// bloco de notas por padrão). A escolha (quais e em que ordem) e as notas ficam no banco, em siplaweb.preferencias
// (script 030, uma linha por pessoa, só ela lê).
(function() {
  var sb = Acesso.cliente;
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // As 5 notas do bloco, cada uma com a sua cor (a aba do lado direito leva a cor da nota).
  var NOTAS = [['Amarela', '#fde68a'], ['Verde', '#bbf7d0'], ['Azul', '#bfdbfe'], ['Rosa', '#fbcfe8'], ['Lilás', '#ddd6fe']];
  var perfil = null, chave = '', escolha = [], cache = {}, mesCal = null, prefs = null, notaTimer = null, notaAtual = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hojeIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function maisDias(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function haQuanto(ts) {
    var m = Math.round((Date.now() - new Date(ts)) / 60000);
    return m < 60 ? 'há ' + Math.max(m, 1) + ' min' : m < 1440 ? 'há ' + Math.round(m / 60) + ' h' : 'há ' + Math.round(m / 1440) + ' d';
  }
  function lsLer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsGravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } }

  // Quem vê cada widget
  function gerencia() { return Acesso.podeVer('GERENCIA'); }
  function propoeOuAprova() {
    return !!perfil.admin || Object.keys(perfil.areas || {}).some(function(a) { return Acesso.aprovaNaArea(a) || Acesso.podePropor(a); });
  }

  var ICONES = {
    cartoes: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
    novidades: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
    alteracoes: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    aprovacoes: '<path d="M4 12.5 9 17.5 20 6.5"/>',
    calendario: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    notas: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>'
  };
  // padrao: ligado para quem ainda não personalizou. pode(): o widget serve ao perfil da pessoa.
  function todos() { return true; }
  var CATALOGO = [
    { id: 'aprovacoes', nome: 'Aprovações', desc: 'Propostas esperando a sua decisão e as suas que aguardam', padrao: true, pode: propoeOuAprova, href: 'painel.html#aprovacoes' },
    { id: 'calendario', nome: 'Calendário', desc: 'Prazos dos seus cartões da Gerência', padrao: true, pode: gerencia, href: 'gerencia.html' },
    { id: 'notas', nome: 'Bloco de notas', desc: '5 notas coloridas, só suas, guardadas na sua conta', padrao: true, pode: todos },
    { id: 'cartoes', nome: 'Meus cartões', desc: 'Resumo do kanban: seus cartões abertos, atrasados e próximos prazos', padrao: false, pode: gerencia, href: 'gerencia.html' },
    { id: 'novidades', nome: 'Novidades do site', desc: 'O que mudou na última versão', padrao: false, pode: todos },
    { id: 'alteracoes', nome: 'Alterações recentes', desc: 'Últimas mudanças nas obras que você vê', padrao: false, pode: todos }
  ];
  function item(id) { return CATALOGO.find(function(w) { return w.id === id; }); }

  // ---------- Preferência ----------
  function ler() {
    var salvo = prefs && Array.isArray(prefs.widgets) ? prefs.widgets : null;
    var lista = salvo || CATALOGO.filter(function(w) { return w.padrao; }).map(function(w) { return w.id; });
    return lista.filter(function(id) { var w = item(id); return w && w.pode(); });
  }
  function salvarPrefs(campos) {
    return sb.from('preferencias').upsert(campos, { onConflict: 'user_id' }).select('atualizado_em').then(function(r) {
      if (r.error) throw r.error;
      prefs = Object.assign(prefs || {}, campos);
      return r.data[0];
    });
  }
  function gravar(padrao) { salvarPrefs({ widgets: padrao ? null : escolha }).catch(function() { /* fica valendo nesta tela */ }); }
  function notas() {
    var n = prefs && prefs.notas;
    if (typeof n === 'string') n = [n];                      // formato antigo (uma nota só)
    n = Array.isArray(n) ? n.slice(0, NOTAS.length) : [];
    while (n.length < NOTAS.length) n.push('');
    return n.map(function(t) { return typeof t === 'string' ? t : ''; });
  }

  // ---------- Dados ----------
  function meusCartoes() {
    if (!cache.cartoes) {
      var uid = perfil.user_id;
      cache.cartoes = sb.from('ger_cartoes').select('id,codigo,titulo,prazo')
        .is('concluido_em', null).or('responsavel.eq.' + uid + ',corresponsaveis.cs.{' + uid + '}')
        .order('prazo', { ascending: true, nullsFirst: false }).limit(500)
        .then(function(r) { if (r.error) throw r.error; return r.data; });
    }
    return cache.cartoes;
  }
  function pendencias() {
    function sel(q) { return q.then(function(r) { return r.error ? [] : r.data; }, function() { return []; }); }
    return Promise.all([
      sel(sb.from('propostas').select('origem,perfil_autor,criado_por').eq('situacao', 'pendente').limit(1000)),
      Acesso.podeVer('JURISDICAO') ? sel(sb.schema('jurisdicao').from('propostas').select('perfil_autor,criado_por').eq('situacao', 'pendente').limit(1000)) : [],
      sel(sb.from('camadas_propostas').select('area,perfil_autor,criado_por').eq('situacao', 'pendente').limit(1000))
    ]).then(function(r) {
      var todas = r[0].map(function(p) { return [p.origem, p]; })
        .concat(r[1].map(function(p) { return ['JURISDICAO', p]; }), r[2].map(function(p) { return [p.area, p]; }));
      return {
        paraMim: todas.filter(function(x) { return Acesso.podeAprovar(x[0], x[1].perfil_autor, x[1].criado_por); }).length,
        minhas: todas.filter(function(x) { return x[1].criado_por === perfil.user_id; }).length
      };
    });
  }

  // ---------- Widgets ----------
  var MONTAR = {
    cartoes: function(corpo) {
      return meusCartoes().then(function(lista) {
        var hoje = hojeIso(), em7 = maisDias(hoje, 7);
        var atras = lista.filter(function(c) { return c.prazo && c.prazo < hoje; }).length;
        var semana = lista.filter(function(c) { return c.prazo && c.prazo >= hoje && c.prazo <= em7; }).length;
        var prox = lista.filter(function(c) { return c.prazo; }).slice(0, 3);
        corpo.innerHTML = '<div class="wg-nums"><div><b>' + lista.length + '</b>abertos</div>' +
          '<div' + (atras ? ' class="alerta"' : '') + '><b>' + atras + '</b>atrasados</div><div><b>' + semana + '</b>em 7 dias</div></div>' +
          (prox.length ? '<ul class="wg-lista">' + prox.map(function(c) {
            return '<li><a href="gerencia.html?cartao=' + encodeURIComponent(c.codigo) + '"><span class="' + (c.prazo < hoje ? 'atrasado' : '') + '">' + ddmm(c.prazo) + '</span>' + esc(c.titulo) + '</a></li>';
          }).join('') + '</ul>' : '<p class="wg-vazio">' + (lista.length ? 'Nenhum dos seus cartões tem prazo.' : 'Nenhum cartão com você.') + '</p>');
      });
    },
    novidades: function(corpo) {
      var n = (Acesso.novidades && Acesso.novidades()[0]) || null;
      if (!n) { corpo.innerHTML = '<p class="wg-vazio">Sem novidades.</p>'; return Promise.resolve(); }
      var itens = (n[3] && n[3].length ? n[3] : n[2]).slice(0, 2);
      corpo.innerHTML = '<p class="wg-ver">VER. ' + esc(n[0]) + ' · ' + esc(n[1]) + '</p><ul class="wg-lista wg-texto">' +
        itens.map(function(t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
        '<button type="button" class="wg-mais" data-novidades>Ver todas as novidades</button>';
      return Promise.resolve();
    },
    alteracoes: function(corpo) {
      return sb.from('historico').select('codigo,usuario_nome,acao,quando').order('quando', { ascending: false }).limit(4).then(function(r) {
        if (r.error) throw r.error;
        corpo.innerHTML = r.data.length ? '<ul class="wg-lista">' + r.data.map(function(h) {
          return '<li><span>' + esc(haQuanto(h.quando)) + '</span><b>' + esc(h.codigo || '') + '</b> ' + esc((h.usuario_nome || '').split(' ')[0]) + ' · ' + esc(h.acao) + '</li>';
        }).join('') + '</ul>' : '<p class="wg-vazio">Nenhuma alteração.</p>';
      });
    },
    aprovacoes: function(corpo) {
      return pendencias().then(function(n) {
        var aprova = !!perfil.admin || Object.keys(perfil.areas || {}).some(Acesso.aprovaNaArea);
        corpo.innerHTML = '<div class="wg-nums">' + (aprova ? '<div' + (n.paraMim ? ' class="alerta"' : '') + '><b>' + n.paraMim + '</b>para você decidir</div>' : '') +
          '<div><b>' + n.minhas + '</b>suas aguardando</div></div>' +
          '<p class="wg-vazio">' + (aprova && n.paraMim ? 'Há propostas esperando a sua aprovação.' : n.minhas ? 'Suas propostas ainda aguardam decisão.' : 'Nada pendente.') + '</p>';
      });
    },
    calendario: function(corpo) {
      return meusCartoes().then(function(lista) {
        var hoje = hojeIso(), base = mesCal || hoje.slice(0, 7);
        var ano = Number(base.slice(0, 4)), mes = Number(base.slice(5, 7)) - 1;
        var primeiro = new Date(ano, mes, 1).getDay(), dias = new Date(ano, mes + 1, 0).getDate();
        var porDia = {};
        lista.forEach(function(c) { if (c.prazo && c.prazo.slice(0, 7) === base) (porDia[Number(c.prazo.slice(8, 10))] = porDia[Number(c.prazo.slice(8, 10))] || []).push(c); });
        var cel = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(function(d) { return '<i class="sem">' + d + '</i>'; });
        for (var i = 0; i < primeiro; i++) cel.push('<i></i>');
        for (var d = 1; d <= dias; d++) {
          var iso = base + '-' + (d < 10 ? '0' : '') + d, cs = porDia[d];
          var cls = (iso === hoje ? 'hoje ' : '') + (cs ? (iso < hoje ? 'prazo vencido' : 'prazo') : '');
          cel.push(cs ? '<a class="' + cls + '" href="gerencia.html?cartao=' + encodeURIComponent(cs[0].codigo) + '" title="' +
            esc(cs.map(function(c) { return c.codigo + ' · ' + c.titulo; }).join('\n')) + '">' + d + '</a>' : '<i class="' + cls + '">' + d + '</i>');
        }
        // Resumo embaixo (no lugar do antigo widget "Meus cartões"): quantos, atrasados e o próximo prazo.
        var atras = lista.filter(function(c) { return c.prazo && c.prazo < hoje; }).length;
        var prox = lista.find(function(c) { return c.prazo && c.prazo >= hoje; });
        corpo.innerHTML = '<div class="wg-cal-topo"><button type="button" data-mes="-1" title="Mês anterior">‹</button><span>' + MESES[mes] + ' ' + ano +
          '</span><button type="button" data-mes="1" title="Próximo mês">›</button></div><div class="wg-cal">' + cel.join('') + '</div>' +
          '<p class="wg-cal-resumo">' + (lista.length ? lista.length + ' cartão(ões) com você' + (atras ? ' · <b class="atrasado">' + atras + ' atrasado(s)</b>' : '') +
            (prox ? ' · próximo: <a href="gerencia.html?cartao=' + encodeURIComponent(prox.codigo) + '">' + ddmm(prox.prazo) + ' ' + esc(prox.titulo) + '</a>' : '')
            : 'Nenhum cartão com você.') + '</p>';
      });
    },
    notas: function(corpo) {
      var lista = notas();
      corpo.innerHTML = '<div class="wg-nota"><textarea class="wg-nota-texto" maxlength="5000"></textarea><div class="wg-nota-abas">' +
        NOTAS.map(function(n, i) { return '<button type="button" data-nota="' + i + '" style="--c:' + n[1] + '"></button>'; }).join('') +
        '</div></div><small class="wg-nota-status"></small>';
      var ta = corpo.querySelector('textarea'), st = corpo.querySelector('small');
      function mostrar(i) {
        notaAtual = i; lsGravar(chave + '.nota', String(i));
        ta.value = lista[i]; ta.style.background = NOTAS[i][1];
        ta.placeholder = 'Nota ' + (i + 1) + ' (' + NOTAS[i][0].toLowerCase() + '). Salva sozinha e só você vê.';
        Array.prototype.forEach.call(corpo.querySelectorAll('[data-nota]'), function(b, k) {
          b.classList.toggle('ativa', k === i); b.classList.toggle('com-texto', !!lista[k].trim());
          b.title = 'Nota ' + (k + 1) + (lista[k].trim() ? ': ' + lista[k].trim().slice(0, 40) : ' (vazia)') + (k === i ? ' · clique para a próxima' : '');
        });
        st.textContent = 'Nota ' + (i + 1) + ' de ' + NOTAS.length;
      }
      corpo.querySelector('.wg-nota-abas').addEventListener('click', function(e) {
        var b = e.target.closest('[data-nota]'); if (!b) return;
        var i = Number(b.dataset.nota);
        mostrar(i === notaAtual ? (i + 1) % NOTAS.length : i);   // a aba da nota aberta passa para a próxima
      });
      ta.addEventListener('input', function() {
        lista[notaAtual] = ta.value;
        prefs = prefs || {}; prefs.notas = lista.slice();
        corpo.querySelector('[data-nota="' + notaAtual + '"]').classList.toggle('com-texto', !!ta.value.trim());
        st.textContent = 'Salvando…';
        clearTimeout(notaTimer);
        notaTimer = setTimeout(function() {
          notaTimer = null;
          salvarPrefs({ notas: lista.slice() }).then(function(d) {
            st.textContent = 'Nota ' + (notaAtual + 1) + ' de ' + NOTAS.length + ' · salvo às ' + new Date(d.atualizado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          }).catch(function(e) { st.textContent = 'Não foi possível salvar: ' + e.message; });
        }, 800);
      });
      var guardada = Number(lsLer(chave + '.nota'));
      mostrar(guardada >= 0 && guardada < NOTAS.length ? guardada : 0);
      return Promise.resolve();
    }
  };

  function render() {
    var area = $('widgets');
    area.innerHTML = escolha.map(function(id) {
      var w = item(id);
      return '<section class="wg wg-' + id + '" data-wg="' + id + '"><header><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONES[id] + '</svg><b>' + esc(w.nome) + '</b>' +
        (w.href ? '<a href="' + w.href + '">abrir ›</a>' : '') + '</header><div class="wg-corpo"><p class="wg-vazio">Carregando…</p></div></section>';
    }).join('') + '<button type="button" class="wg-personalizar" id="wgPersonalizar" title="Escolher os widgets desta faixa">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>' +
      (escolha.length ? 'Personalizar' : 'Adicionar widgets') + '</button>';
    area.classList.toggle('vazio', !escolha.length);
    // Cada widget ocupa até ~320 px: com 1 ou 2 widgets o painel não estica pela faixa toda.
    area.style.maxWidth = escolha.length ? (escolha.length * 330 + 28) + 'px' : '';
    document.querySelector('.hero').classList.toggle('com-widgets', escolha.length > 0);
    escolha.forEach(montar);
  }
  function montar(id) {
    var el = document.querySelector('[data-wg="' + id + '"] .wg-corpo');
    if (!el) return;
    MONTAR[id](el).catch(function() { el.innerHTML = '<p class="wg-vazio">Não foi possível carregar.</p>'; });
  }

  // ---------- Personalizar ----------
  function abrirPersonalizar() {
    var dlg = $('wgDialogo');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'wgDialogo'; dlg.className = 'wg-dlg';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', function(e) {
        if (e.target === dlg || e.target.closest('[data-fechar]')) { dlg.close(); return; }
        var b = e.target.closest('[data-mover]');
        if (b) {
          var id = b.dataset.id, i = escolha.indexOf(id), j = i + Number(b.dataset.mover);
          if (i >= 0 && j >= 0 && j < escolha.length) { escolha.splice(i, 1); escolha.splice(j, 0, id); gravar(); render(); listar(); }
        }
        if (e.target.closest('[data-padrao]')) { if (prefs) prefs.widgets = null; gravar(true); escolha = ler(); render(); listar(); }
      });
      dlg.addEventListener('change', function(e) {
        var id = e.target.dataset.id; if (!id) return;
        escolha = escolha.filter(function(x) { return x !== id; });
        if (e.target.checked) escolha.push(id);
        gravar(); render(); listar();
      });
    }
    function listar() {
      var disponiveis = CATALOGO.filter(function(w) { return w.pode(); });
      var ordem = escolha.concat(disponiveis.map(function(w) { return w.id; }).filter(function(id) { return escolha.indexOf(id) < 0; }));
      dlg.innerHTML = '<div class="wg-dlg-topo"><b>Widgets da página inicial</b><button type="button" data-fechar title="Fechar">×</button></div>' +
        '<p class="wg-dlg-nota">Marque os que quer ver na faixa de boas-vindas e use as setas para mudar a ordem. Fica guardado na sua conta (vale em qualquer computador).' +
        ' Aparecem só os widgets que servem ao seu perfil.</p><ul>' +
        ordem.map(function(id) {
          var w = item(id), on = escolha.indexOf(id) >= 0, pos = escolha.indexOf(id);
          return '<li class="' + (on ? 'ligado' : '') + '"><label><input type="checkbox" data-id="' + id + '"' + (on ? ' checked' : '') + ' />' +
            '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONES[id] + '</svg><span><b>' + esc(w.nome) + '</b><small>' + esc(w.desc) + '</small></span></label>' +
            (on ? '<button type="button" data-mover="-1" data-id="' + id + '"' + (pos ? '' : ' disabled') + ' title="Subir">↑</button>' +
              '<button type="button" data-mover="1" data-id="' + id + '"' + (pos < escolha.length - 1 ? '' : ' disabled') + ' title="Descer">↓</button>' : '') + '</li>';
        }).join('') + '</ul><div class="wg-dlg-rodape"><button type="button" class="wg-link" data-padrao>Voltar ao padrão</button>' +
        '<button type="button" class="wg-ok" data-fechar>Pronto</button></div>';
    }
    listar();
    dlg.showModal();
  }

  Acesso.pronto.then(function(p) {
    if (!p || !$('widgets')) return;
    perfil = p;
    chave = 'siplaweb.widgets.' + p.user_id;
    sb.from('preferencias').select('widgets,notas').maybeSingle().then(function(r) { prefs = r.error ? null : (r.data || {}); }, function() { prefs = null; })
      .then(function() { escolha = ler(); render(); });
    // Antes de sair da página, grava a nota que ainda esperava o intervalo.
    window.addEventListener('pagehide', function() {
      if (notaTimer) { clearTimeout(notaTimer); salvarPrefs({ notas: notas() }); }
    });
    $('widgets').addEventListener('click', function(e) {
      if (e.target.closest('#wgPersonalizar')) return abrirPersonalizar();
      if (e.target.closest('[data-novidades]')) return Acesso.mostrarNovidades();
      var m = e.target.closest('[data-mes]');
      if (m) {
        var base = mesCal || hojeIso().slice(0, 7), d = new Date(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1 + Number(m.dataset.mes), 1);
        mesCal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        montar('calendario');
      }
    });
  });
})();
