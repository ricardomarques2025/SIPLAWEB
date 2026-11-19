// Quadros da Gerência (gerencia.html): um "Trello" interno para as demandas do SIPLAWEB e outros assuntos da gerência.
// Banco: siplaweb.ger_quadros, ger_colunas, ger_cartoes, ger_comentarios, ger_anexos, ger_eventos (script 024).
// Regras (conferidas de novo no banco, RLS): quem tem a área GERENCIA e os administradores veem todos os quadros;
// qualquer membro cria cartões, comenta e anexa prints; só quem criou o cartão e os administradores editam, movem e
// excluem; quadros e colunas só os administradores. Prints: imagem colada (Ctrl+V) ou escolhida, anotada num canvas e
// salva reduzida (WebP, até 1600 px) no Storage, pasta privada 'gerencia'. Links de pastas locais/rede ficam como texto
// com "Copiar" (o navegador não abre caminhos do computador a partir de um site).
(function() {
  var sb = Acesso.cliente;                     // schema siplaweb
  var BUCKET = 'gerencia';
  var MAX_LADO = 1600;                          // maior lado do print salvo (px)
  var CHAVE_QUADRO = 'siplaweb.gerencia.quadro';
  var PRIORIDADES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

  var perfil = null, membros = [], nomes = {}, quadros = [], colunas = [], cartoes = [];
  var contAnexos = {}, contComent = {};
  var quadroId = null, cartaoId = null, carregadoEm = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtData(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : ''; }
  function fmtDataHora(d) { if (!d) return ''; var x = new Date(d); return x.toLocaleDateString('pt-BR') + ' ' + x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function hojeIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function toast(msg, erro) {
    var t = document.createElement('div');
    t.className = 'toast' + (erro ? ' toast-erro' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function() { t.remove(); }, erro ? 7000 : 3500);
  }
  function dados(res) { if (res.error) throw new Error(res.error.message); return res.data; }
  function nome(uid) { return uid ? (nomes[uid] || 'Usuário') : ''; }
  function iniciais(uid) { return nome(uid).split(/\s+/).filter(Boolean).map(function(p) { return p[0]; }).slice(0, 2).join('').toUpperCase(); }
  function eu() { return perfil.user_id; }
  function comigo(c) { return c.responsavel === eu() || (c.corresponsaveis || []).indexOf(eu()) >= 0; }
  // Cartões ligados: os gravados neste cartão + os que apontam para ele (gravados no outro cartão).
  function ligadosDe(c) { return (c.ligados || []).map(cartao).filter(Boolean); }
  function ligadosAEle(c) { return cartoes.filter(function(x) { return (x.ligados || []).indexOf(c.id) >= 0 && (c.ligados || []).indexOf(x.id) < 0; }); }
  function admin() { return !!perfil.admin; }
  function podeAlterar(c) { return !c || admin() || c.criado_por === eu(); }
  function cartao(id) { return cartoes.find(function(c) { return c.id === Number(id); }) || null; }
  function coluna(id) { return colunas.find(function(c) { return c.id === Number(id); }) || null; }
  function colunasDoQuadro(q) { return colunas.filter(function(c) { return c.quadro_id === q; }).sort(function(a, b) { return a.ordem - b.ordem || a.id - b.id; }); }
  function cartoesDaColuna(c) { return cartoes.filter(function(x) { return x.coluna_id === c; }).sort(function(a, b) { return a.posicao - b.posicao || a.id - b.id; }); }
  function ehLinkWeb(s) { return /^https?:\/\//i.test(String(s || '').trim()); }

  // ---------- Carga ----------
  function carregar() {
    return Promise.all([
      sb.from('ger_quadros').select('*').eq('arquivado', false).order('ordem').order('id').then(dados),
      sb.from('ger_colunas').select('*').order('ordem').order('id').then(dados),
      sb.rpc('ger_membros').then(dados),
      sb.from('ger_cartoes').select('*').order('posicao').limit(5000).then(dados),
      sb.from('ger_anexos').select('cartao_id').limit(10000).then(dados),
      sb.from('ger_comentarios').select('cartao_id').limit(10000).then(dados)
    ]).then(function(r) {
      quadros = r[0]; colunas = r[1]; membros = r[2]; cartoes = r[3];
      nomes = {}; membros.forEach(function(m) { nomes[m.user_id] = m.nome; });
      contAnexos = {}; r[4].forEach(function(a) { contAnexos[a.cartao_id] = (contAnexos[a.cartao_id] || 0) + 1; });
      contComent = {}; r[5].forEach(function(a) { contComent[a.cartao_id] = (contComent[a.cartao_id] || 0) + 1; });
      if (!quadros.some(function(q) { return q.id === quadroId; })) quadroId = quadros.length ? quadros[0].id : null;
      carregadoEm = Date.now();
    });
  }
  // Nomes de quem não é mais membro (autor antigo de um cartão) aparecem como "Usuário".
  function recarregar(silencioso) {
    return carregar().then(function() { render(); if (!silencioso) toast('Quadros atualizados'); })
      .catch(function(e) { toast('Não foi possível carregar: ' + e.message, true); });
  }

  // ---------- Quadro ----------
  function render() { renderQuadros(); renderFiltros(); renderColunas(); }

  function renderQuadros() {
    $('quadros').innerHTML = quadros.map(function(q) {
      var abertos = cartoes.filter(function(c) { return c.quadro_id === q.id && !c.concluido_em; }).length;
      return '<button type="button" data-quadro="' + q.id + '"' + (q.id === quadroId ? ' class="ativo"' : '') + ' title="' + esc(q.descricao || '') + '">' +
        esc(q.nome) + '<small title="Cartões abertos">' + abertos + '</small></button>';
    }).join('') || '<span class="ger-vazio">Nenhum quadro. ' + (admin() ? 'Crie um em "Configurar quadros".' : 'Peça a um administrador.') + '</span>';
    renderResumo();
  }

  // Faixa do topo (como a página inicial): nome do quadro e números dele, sem os filtros.
  function renderResumo() {
    var q = quadros.find(function(x) { return x.id === quadroId; });
    $('quadroNome').textContent = q ? q.nome : 'Quadros da Gerência';
    $('quadroDescricao').textContent = (q && q.descricao) || 'Demandas do SIPLAWEB e assuntos da gerência em um só lugar.';
    var hoje = hojeIso(), doQuadro = cartoes.filter(function(c) { return c.quadro_id === quadroId; });
    var abertos = doQuadro.filter(function(c) { return !c.concluido_em; });
    var n = [
      [abertos.length, 'cartões abertos'],
      [abertos.filter(function(c) { return c.prazo && c.prazo < hoje; }).length, 'atrasados'],
      [abertos.filter(function(c) { return comigo(c); }).length, 'comigo'],
      [doQuadro.length - abertos.length, 'concluídos']
    ];
    $('numeros').innerHTML = n.map(function(x, i) {
      return '<div' + (i === 1 && x[0] ? ' class="alerta"' : '') + '><b>' + x[0] + '</b><span>' + x[1] + '</span></div>';
    }).join('');
  }

  var ICONES = {
    prazo: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>',
    coment: '<path d="M5 5h14v10H9l-4 4z"/>',
    print: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="m4 16 5-5 4 4 2-2 5 5"/><circle cx="15.5" cy="9.5" r="1.3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    ligado: '<rect x="3" y="4" width="9" height="7" rx="1.5"/><rect x="12" y="13" width="9" height="7" rx="1.5"/><path d="M7.5 11v4.5H12"/>'
  };
  function icone(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONES[n] + '</svg>'; }

  function renderFiltros() {
    var atual = $('filtroResp').value;
    $('filtroResp').innerHTML = '<option value="">Todos os responsáveis</option><option value="-">Sem responsável</option>' +
      membros.map(function(m) { return '<option value="' + m.user_id + '">' + esc(m.nome) + '</option>'; }).join('');
    $('filtroResp').value = atual;
  }

  function passaFiltros(c) {
    var b = $('busca').value.trim().toLowerCase(), r = $('filtroResp').value;
    if (b && [c.codigo, c.titulo, c.descricao, (c.etiquetas || []).join(' '), c.obra, c.sei, c.versao].join(' ').toLowerCase().indexOf(b) === -1) return false;
    if (r === '-' && c.responsavel) return false;
    if (r && r !== '-' && c.responsavel !== r && (c.corresponsaveis || []).indexOf(r) < 0) return false;
    if ($('soMeus').checked && c.criado_por !== eu() && !comigo(c)) return false;
    return true;
  }

  function htmlCartao(c, col) {
    var atrasado = c.prazo && !c.concluido_em && c.prazo < hojeIso();
    var extras = [];
    if (c.prazo) extras.push('<span class="' + (atrasado ? 'atrasado' : '') + '" title="' + (atrasado ? 'Prazo vencido' : 'Prazo') + '">' + icone('prazo') + fmtData(c.prazo).slice(0, 5) + '</span>');
    if (contComent[c.id]) extras.push('<span title="Comentários">' + icone('coment') + contComent[c.id] + '</span>');
    if (contAnexos[c.id]) extras.push('<span title="Prints">' + icone('print') + contAnexos[c.id] + '</span>');
    if ((c.links || []).length) extras.push('<span title="Links">' + icone('link') + c.links.length + '</span>');
    var nLig = ligadosDe(c).length + ligadosAEle(c).length;
    if (nLig) extras.push('<span title="Cartões ligados">' + icone('ligado') + nLig + '</span>');
    var pessoas = (c.responsavel ? [c.responsavel] : []).concat(c.corresponsaveis || []);
    return '<div class="ger-cartao' + (c.prioridade ? ' cartao-' + c.prioridade : '') + (c.concluido_em ? ' concluido' : '') + '" tabindex="0" data-cartao="' + c.id + '"' + (podeAlterar(c) ? ' draggable="true"' : '') + '>' +
      '<div class="ger-cartao-sup"><span>' + esc(c.codigo || '') + '</span>' + (c.obra ? '<span>· ' + esc(c.obra) + '</span>' : '') +
        (c.prioridade ? '<span class="prio prio-' + c.prioridade + '">' + PRIORIDADES[c.prioridade] + '</span>' : '') + '</div>' +
      '<b>' + esc(c.titulo) + '</b>' +
      ((c.etiquetas || []).length ? '<div class="ger-etiquetas">' + c.etiquetas.map(function(e) { return '<span class="ger-etiqueta">' + esc(e) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="ger-cartao-inf">' + extras.join('') +
        (pessoas.length ? '<span class="pessoas">' + pessoas.slice(0, 3).map(function(u, i) {
          return '<span class="resp' + (i ? ' co' : '') + '" title="' + (i ? 'Corresponsável: ' : 'Responsável: ') + esc(nome(u)) + '">' + esc(iniciais(u)) + '</span>';
        }).join('') + (pessoas.length > 3 ? '<span class="resp co mais" title="' + esc(pessoas.slice(3).map(nome).join(', ')) + '">+' + (pessoas.length - 3) + '</span>' : '') + '</span>' : '') + '</div>' +
      '</div>';
  }

  function renderColunas() {
    var cols = colunasDoQuadro(quadroId);
    var mostrarFim = $('mostrarConcluidos').checked;
    $('colunas').innerHTML = cols.map(function(col) {
      var todos = cartoesDaColuna(col.id), lista = todos.filter(passaFiltros);
      var oculta = col.finaliza && !mostrarFim;
      return '<section class="ger-coluna" style="--c:' + esc(col.cor || '#94a3b8') + '" data-coluna="' + col.id + '">' +
        '<h3><i></i><strong title="' + esc(col.nome) + '">' + esc(col.nome) + '</strong>' + (col.finaliza ? ' <em title="O cartão que entra aqui conta como concluído">conclui</em>' : '') + '<span>' + (lista.length === todos.length ? lista.length : lista.length + '/' + todos.length) + '</span></h3>' +
        '<div class="ger-lista" data-lista="' + col.id + '">' + (oculta ? '<span class="ger-vazio">' + lista.length + ' cartão(ões) ocultos</span>' : lista.map(function(c) { return htmlCartao(c, col); }).join('')) + '</div>' +
        '<form class="ger-rapido" data-rapido="' + col.id + '"><input name="titulo" placeholder="+ Adicionar cartão" maxlength="200" /></form>' +
        '</section>';
    }).join('') || '<p class="ger-vazio">Este quadro ainda não tem colunas.' + (admin() ? ' Use "Configurar quadros".' : '') + '</p>';
  }

  // ---------- Arrastar ----------
  var arrastado = null;
  function ligarArrastar() {
    var area = $('colunas');
    area.addEventListener('dragstart', function(e) {
      var el = e.target.closest('.ger-cartao'); if (!el) return;
      arrastado = Number(el.dataset.cartao);
      el.classList.add('arrastando');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(arrastado));
    });
    area.addEventListener('dragend', function(e) {
      var el = e.target.closest('.ger-cartao'); if (el) el.classList.remove('arrastando');
      area.querySelectorAll('.alvo').forEach(function(x) { x.classList.remove('alvo'); });
      arrastado = null;
    });
    area.addEventListener('dragover', function(e) {
      var lista = e.target.closest('.ger-lista'); if (!lista || !arrastado) return;
      e.preventDefault();
      area.querySelectorAll('.alvo').forEach(function(x) { if (x !== lista) x.classList.remove('alvo'); });
      lista.classList.add('alvo');
    });
    area.addEventListener('drop', function(e) {
      var lista = e.target.closest('.ger-lista'); if (!lista || !arrastado) return;
      e.preventDefault();
      lista.classList.remove('alvo');
      var colunaId = Number(lista.dataset.lista);
      // posição: entre os cartões acima e abaixo do ponto onde soltou
      var irmaos = Array.prototype.filter.call(lista.querySelectorAll('.ger-cartao'), function(x) { return Number(x.dataset.cartao) !== arrastado; });
      var depois = irmaos.find(function(x) { var r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      var idx = depois ? irmaos.indexOf(depois) : irmaos.length;
      var antes = idx > 0 ? cartao(irmaos[idx - 1].dataset.cartao) : null, prox = depois ? cartao(depois.dataset.cartao) : null;
      var pos = antes && prox ? (antes.posicao + prox.posicao) / 2 : antes ? antes.posicao + 1 : prox ? prox.posicao - 1 : 1;
      mover(arrastado, colunaId, pos);
    });
  }

  function mover(id, colunaId, posicao) {
    var c = cartao(id); if (!c) return;
    if (!podeAlterar(c)) { toast('Só quem criou o cartão e os administradores podem movê-lo.', true); return; }
    var antes = { coluna_id: c.coluna_id, posicao: c.posicao };
    c.coluna_id = colunaId; c.posicao = posicao;
    renderColunas();
    sb.from('ger_cartoes').update({ coluna_id: colunaId, posicao: posicao }).eq('id', id).select().then(function(res) {
      if (res.error || !res.data.length) {
        Object.assign(c, antes); renderColunas();
        toast(res.error ? 'Não foi possível mover: ' + res.error.message : 'Só quem criou o cartão e os administradores podem movê-lo.', true);
        return;
      }
      Object.assign(c, res.data[0]);
      renderQuadros(); renderColunas();
    });
  }

  function criarRapido(colunaId, titulo) {
    var ult = cartoesDaColuna(colunaId).slice(-1)[0];
    return sb.from('ger_cartoes').insert({ quadro_id: quadroId, coluna_id: colunaId, titulo: titulo, posicao: ult ? ult.posicao + 1 : 1 })
      .select().single().then(function(res) {
        if (res.error) { toast('Não foi possível criar: ' + res.error.message, true); return; }
        cartoes.push(res.data);
        renderQuadros(); renderColunas();
      });
  }

  // ---------- Cartão ----------
  function campo(rotulo, html) { return '<label class="ger-campo">' + rotulo + html + '</label>'; }
  function opcoes(lista, atual) {
    return lista.map(function(o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(atual == null ? '' : atual) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }

  function abrirCartao(id, colunaInicial) {
    var c = id ? cartao(id) : null;
    if (id && !c) { toast('Cartão não encontrado.', true); return; }
    cartaoId = c ? c.id : null;
    var pode = podeAlterar(c), dis = pode ? '' : ' disabled';
    var cols = colunasDoQuadro(c ? c.quadro_id : quadroId);
    var col = c ? c.coluna_id : (colunaInicial || (cols[0] && cols[0].id));
    $('cartaoTitulo').textContent = c ? (c.codigo || 'Cartão') + ' · ' + (quadros.find(function(q) { return q.id === c.quadro_id; }) || {}).nome : 'Novo cartão';
    $('cartaoDados').innerHTML =
      campo('Título', '<input id="cTitulo" maxlength="200" value="' + esc(c ? c.titulo : '') + '"' + dis + ' />') +
      '<div class="ger-grade">' +
        campo('Coluna', '<select id="cColuna"' + dis + '>' + opcoes(cols.map(function(x) { return [x.id, x.nome]; }), col) + '</select>') +
        campo('Responsável', '<select id="cResp"' + dis + '><option value="">—</option>' + opcoes(membros.map(function(m) { return [m.user_id, m.nome]; }), c && c.responsavel) + '</select>') +
        campo('Prazo', '<input type="date" id="cPrazo" value="' + esc(c && c.prazo || '') + '"' + dis + ' />') +
        campo('Prioridade', '<select id="cPrio"' + dis + '><option value="">—</option>' + opcoes([['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']], c && c.prioridade) + '</select>') +
      '</div>' +
      '<div class="ger-campo">Corresponsáveis <small>(dividem o cartão com o responsável)</small><div class="ger-chips" id="cCorresp"></div></div>' +
      campo('Etiquetas <small>(separe por vírgula)</small>', '<input id="cEtiquetas" value="' + esc(c ? (c.etiquetas || []).join(', ') : '') + '"' + dis + ' placeholder="ex.: mapa, urgente, DOR" />') +
      campo('Descrição', '<textarea id="cDescricao"' + dis + '>' + esc(c ? c.descricao : '') + '</textarea>') +
      '<div class="ger-campo">Links e pastas <small>(pasta da rede ou do computador: o botão "Copiar" leva o caminho para colar no Explorador)</small>' +
        '<div class="ger-links" id="cLinks"></div>' + (pode ? '<button type="button" class="mini" id="cAddLink" style="align-self:flex-start">+ Adicionar link</button>' : '') + '</div>' +
      '<div class="ger-campo">Cartões ligados <small>(relacionados, de qualquer quadro; clique para abrir)</small><div class="ger-chips" id="cLigados"></div></div>' +
      '<div class="ger-grade">' +
        campo('Obra (opcional)', '<input id="cObra" value="' + esc(c && c.obra || '') + '"' + dis + ' placeholder="ex.: OB26-00001" />') +
        campo('Versão do site', '<input id="cVersao" value="' + esc(c && c.versao || '') + '"' + dis + ' placeholder="ex.: 3.14" />') +
        campo('Processo SEI', '<input id="cSei" value="' + esc(c && c.sei || '') + '"' + dis + ' />') +
      '</div>' +
      '<div class="ger-acoes"><span class="info">' + (c ? 'Criado por ' + esc(nome(c.criado_por)) + ' em ' + fmtDataHora(c.criado_em) +
          (c.atualizado_em && c.atualizado_em !== c.criado_em ? ' · alterado por ' + esc(nome(c.atualizado_por)) + ' em ' + fmtDataHora(c.atualizado_em) : '') +
          (pode ? '' : '<br>Só quem criou o cartão e os administradores podem alterá-lo; você pode comentar e anexar prints.') : 'Você será o autor deste cartão.') + '</span>' +
        (c && pode ? '<button type="button" class="btn btn-perigo" id="cExcluir">Excluir</button>' : '') +
        (pode ? '<button type="button" class="btn btn-primario" id="cSalvar">' + (c ? 'Salvar' : 'Criar cartão') + '</button>' : '') + '</div>';
    renderLinks(c ? (c.links || []) : [], pode);
    selCorresp = c ? (c.corresponsaveis || []).slice() : []; selLigados = c ? (c.ligados || []).slice() : [];
    renderChips(c, pode);
    if (pode) {
      $('cAddLink').onclick = function() { var l = lerLinks(); l.push({ rotulo: '', endereco: '' }); renderLinks(l, true); };
      $('cSalvar').onclick = salvarCartao;
      if (c) $('cExcluir').onclick = excluirCartao;
    }
    renderLado();
    if (!$('dlgCartao').open) $('dlgCartao').showModal();
    if (!c) $('cTitulo').focus();
  }

  // Corresponsáveis e cartões ligados: etiquetas com × (para quem pode alterar) + campo para acrescentar.
  var selCorresp = [], selLigados = [];
  function rotuloCartao(x) { return (x.codigo || '') + ' · ' + x.titulo; }
  function renderChips(c, pode) {
    var resp = $('cResp').value;
    $('cCorresp').innerHTML = selCorresp.map(function(u) {
      return '<span class="ger-chip"><i>' + esc(iniciais(u)) + '</i>' + esc(nome(u)) + (pode ? '<button type="button" data-tirar-co="' + u + '" title="Tirar">×</button>' : '') + '</span>';
    }).join('') + (pode ? '<select id="cAddCo" class="ger-chip-add"><option value="">+ Adicionar pessoa</option>' +
      opcoes(membros.filter(function(m) { return m.user_id !== resp && selCorresp.indexOf(m.user_id) < 0; }).map(function(m) { return [m.user_id, m.nome]; }), '') + '</select>' :
      (selCorresp.length ? '' : '<span class="ger-vazio">Nenhum.</span>'));
    var reversos = c ? ligadosAEle(c) : [];
    $('cLigados').innerHTML = selLigados.map(cartao).filter(Boolean).map(function(x) {
      return '<span class="ger-chip ger-chip-cartao' + (x.concluido_em ? ' concluido' : '') + '" data-abrir-cartao="' + x.id + '" title="Abrir este cartão">' + esc(rotuloCartao(x)) +
        (pode ? '<button type="button" data-tirar-ligado="' + x.id + '" title="Desligar">×</button>' : '') + '</span>';
    }).join('') + reversos.map(function(x) {
      return '<span class="ger-chip ger-chip-cartao' + (x.concluido_em ? ' concluido' : '') + '" data-abrir-cartao="' + x.id + '" title="Ligado a partir de ' + esc(x.codigo) + ' (desfaça por lá)">' + esc(rotuloCartao(x)) + ' <small>↩</small></span>';
    }).join('') + (pode ? '<input id="cAddLig" class="ger-chip-add" list="listaCartoes" placeholder="+ Ligar cartão: digite código ou título" />' +
      '<datalist id="listaCartoes">' + cartoes.filter(function(x) { return (!c || x.id !== c.id) && selLigados.indexOf(x.id) < 0; }).map(function(x) {
        var q = quadros.find(function(k) { return k.id === x.quadro_id; });
        return '<option value="' + esc(rotuloCartao(x)) + '">' + esc(q ? q.nome : '') + '</option>';
      }).join('') + '</datalist>' : (selLigados.length || reversos.length ? '' : '<span class="ger-vazio">Nenhum.</span>'));
    if (!pode) return;
    $('cAddCo').onchange = function() { if (this.value) { selCorresp.push(this.value); renderChips(c, pode); } };
    $('cAddLig').onchange = function() {
      var v = this.value.trim(), cod = v.split(' · ')[0].toUpperCase();
      var x = cartoes.find(function(k) { return rotuloCartao(k) === v || (k.codigo || '').toUpperCase() === cod; });
      if (!x) { toast('Cartão não encontrado: escolha um da lista.', true); return; }
      if (c && x.id === c.id) { toast('Um cartão não se liga a ele mesmo.', true); return; }
      if (selLigados.indexOf(x.id) < 0) selLigados.push(x.id);
      renderChips(c, pode); $('cAddLig').focus();
    };
    $('cResp').onchange = function() { selCorresp = selCorresp.filter(function(u) { return u !== $('cResp').value; }); renderChips(c, pode); };
  }

  function renderLinks(links, pode) {
    $('cLinks').innerHTML = links.map(function(l, i) {
      var acao = l.endereco ? (ehLinkWeb(l.endereco)
        ? '<a class="mini" href="' + esc(l.endereco) + '" target="_blank" rel="noopener">Abrir</a>'
        : '<button type="button" class="mini" data-copiar="' + esc(l.endereco) + '">Copiar</button>') : '';
      if (!pode) return '<div class="ger-link-ver"><span><b>' + esc(l.rotulo || 'Link') + '</b> · <code>' + esc(l.endereco) + '</code></span>' + acao + '</div>';
      return '<div class="ger-link" data-link="' + i + '"><input data-rotulo placeholder="Nome (ex.: Pasta do projeto)" value="' + esc(l.rotulo) + '" />' +
        '<input data-endereco placeholder="\\\\servidor\\pasta, C:\\... ou https://..." value="' + esc(l.endereco) + '" />' + acao +
        '<button type="button" class="mini mini-perigo" data-tirar-link="' + i + '" title="Tirar">×</button></div>';
    }).join('') || '<span class="ger-vazio">Nenhum link.</span>';
  }
  function lerLinks() {
    return Array.prototype.map.call($('cLinks').querySelectorAll('.ger-link'), function(r) {
      return { rotulo: r.querySelector('[data-rotulo]').value.trim(), endereco: r.querySelector('[data-endereco]').value.trim() };
    });
  }

  function salvarCartao() {
    var titulo = $('cTitulo').value.trim();
    if (!titulo) { toast('Escreva o título do cartão.', true); $('cTitulo').focus(); return; }
    var colunaId = Number($('cColuna').value);
    var c = cartaoId ? cartao(cartaoId) : null;
    var reg = {
      titulo: titulo, coluna_id: colunaId,
      responsavel: $('cResp').value || null,
      corresponsaveis: selCorresp.filter(function(u) { return u !== $('cResp').value; }), ligados: selLigados.slice(),
      prazo: $('cPrazo').value || null, prioridade: $('cPrio').value || null,
      etiquetas: $('cEtiquetas').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
      descricao: $('cDescricao').value.trim() || null,
      links: lerLinks().filter(function(l) { return l.endereco; }),
      obra: $('cObra').value.trim().toUpperCase() || null, versao: $('cVersao').value.trim() || null, sei: $('cSei').value.replace(/\s/g, '') || null
    };
    if (!c || c.coluna_id !== colunaId) { var ult = cartoesDaColuna(colunaId).slice(-1)[0]; reg.posicao = ult ? ult.posicao + 1 : 1; }
    $('cSalvar').disabled = true;
    var q = c ? sb.from('ger_cartoes').update(reg).eq('id', c.id).select() : sb.from('ger_cartoes').insert(Object.assign({ quadro_id: quadroId }, reg)).select();
    q.then(function(res) {
      $('cSalvar').disabled = false;
      if (res.error) { toast('Não foi possível salvar: ' + res.error.message, true); return; }
      if (!res.data.length) { toast('Só quem criou o cartão e os administradores podem alterá-lo.', true); return; }
      // o código DM.. é gravado pelo gatilho depois da inclusão: lê de novo
      return sb.from('ger_cartoes').select('*').eq('id', res.data[0].id).single().then(function(r2) {
        var novo = dados(r2);
        var i = cartoes.findIndex(function(x) { return x.id === novo.id; });
        if (i >= 0) cartoes[i] = novo; else cartoes.push(novo);
        toast(c ? 'Cartão salvo' : 'Cartão ' + novo.codigo + ' criado');
        renderQuadros(); renderColunas();
        abrirCartao(novo.id);
      });
    }).catch(function(e) { toast('Erro: ' + e.message, true); });
  }

  function excluirCartao() {
    var c = cartao(cartaoId); if (!c) return;
    if (!confirm('Excluir o cartão ' + c.codigo + ' (' + c.titulo + ')? Comentários e prints também serão apagados.')) return;
    sb.from('ger_anexos').select('caminho').eq('cartao_id', c.id).then(dados).then(function(anx) {
      return anx.length ? sb.storage.from(BUCKET).remove(anx.map(function(a) { return a.caminho; })) : null;
    }).then(function() {
      return sb.from('ger_cartoes').delete().eq('id', c.id).select('id');
    }).then(function(res) {
      if (res.error || !res.data.length) { toast(res.error ? 'Não foi possível excluir: ' + res.error.message : 'Sem permissão para excluir.', true); return; }
      cartoes = cartoes.filter(function(x) { return x.id !== c.id; });
      $('dlgCartao').close();
      toast('Cartão excluído');
      renderQuadros(); renderColunas();
    }).catch(function(e) { toast('Erro: ' + e.message, true); });
  }

  // ---------- Lado: prints, comentários, histórico ----------
  function renderLado() {
    var semCartao = !cartaoId;
    ['btnColar', 'btnComentar', 'novoComentario', 'arquivoPrint'].forEach(function(i) { $(i).disabled = semCartao; });
    if (semCartao) {
      $('anexos').innerHTML = '<span class="ger-vazio">Crie o cartão para anexar prints.</span>';
      $('comentarios').innerHTML = '<span class="ger-vazio">Crie o cartão para comentar.</span>';
      $('eventos').innerHTML = '';
      return;
    }
    var id = cartaoId;
    Promise.all([
      sb.from('ger_anexos').select('*').eq('cartao_id', id).order('id').then(dados),
      sb.from('ger_comentarios').select('*').eq('cartao_id', id).order('id').then(dados),
      sb.from('ger_eventos').select('*').eq('cartao_id', id).order('id', { ascending: false }).then(dados)
    ]).then(function(r) {
      if (id !== cartaoId) return;
      contAnexos[id] = r[0].length; contComent[id] = r[1].length;
      renderAnexos(r[0]);
      $('comentarios').innerHTML = r[1].map(function(m) {
        return '<div class="ger-comentario"><small><b>' + esc(nome(m.autor)) + '</b>' + fmtDataHora(m.criado_em) +
          (m.autor === eu() || admin() ? '<button type="button" data-tirar-comentario="' + m.id + '">excluir</button>' : '') + '</small><p>' + esc(m.texto) + '</p></div>';
      }).join('') || '<span class="ger-vazio">Nenhum comentário.</span>';
      $('eventos').innerHTML = r[2].map(function(ev) {
        var acao = { criou: 'criou em', moveu: 'moveu:', editou: 'alterou' }[ev.acao] || ev.acao;
        return '<li>' + fmtDataHora(ev.quando) + ' · <b>' + esc(nome(ev.usuario)) + '</b> ' + acao + ' ' + esc(ev.detalhe || '') + '</li>';
      }).join('');
      renderColunas();
    }).catch(function(e) { toast('Erro ao carregar o cartão: ' + e.message, true); });
  }

  function renderAnexos(lista) {
    if (!lista.length) { $('anexos').innerHTML = '<span class="ger-vazio">Nenhum print.</span>'; return; }
    sb.storage.from(BUCKET).createSignedUrls(lista.map(function(a) { return a.caminho; }), 3600).then(function(res) {
      var urls = {}; (res.data || []).forEach(function(u) { urls[u.path] = u.signedUrl; });
      $('anexos').innerHTML = lista.map(function(a) {
        var u = urls[a.caminho];
        return '<div class="ger-anexo" title="' + esc(nome(a.autor) + ' · ' + fmtDataHora(a.criado_em)) + '">' +
          (u ? '<img src="' + esc(u) + '" alt="Print" data-abrir="' + esc(u) + '" />' : '<span class="ger-vazio">indisponível</span>') +
          (a.autor === eu() || admin() ? '<button type="button" data-tirar-anexo="' + a.id + '" data-caminho="' + esc(a.caminho) + '" title="Apagar">×</button>' : '') + '</div>';
      }).join('');
    });
  }

  function comentar() {
    var t = $('novoComentario').value.trim(); if (!t || !cartaoId) return;
    $('btnComentar').disabled = true;
    sb.from('ger_comentarios').insert({ cartao_id: cartaoId, texto: t, autor: eu() }).then(function(res) {
      $('btnComentar').disabled = false;
      if (res.error) { toast('Não foi possível comentar: ' + res.error.message, true); return; }
      $('novoComentario').value = '';
      renderLado();
    });
  }

  // ---------- Print: colar, anotar e salvar ----------
  var editor = { img: null, formas: [], ferramenta: 'caneta', cor: '#e11d48', atual: null, escala: 1 };

  function imagemDaArea(itens) {
    for (var i = 0; i < (itens || []).length; i++) if (itens[i].type && itens[i].type.indexOf('image/') === 0) return itens[i].getAsFile();
    return null;
  }
  function colarPeloBotao() {
    if (!navigator.clipboard || !navigator.clipboard.read) { toast('Use Ctrl+V com o cartão aberto para colar o print.'); return; }
    navigator.clipboard.read().then(function(itens) {
      for (var i = 0; i < itens.length; i++) {
        var tipo = itens[i].types.find(function(t) { return t.indexOf('image/') === 0; });
        if (tipo) return itens[i].getType(tipo).then(abrirEditor);
      }
      toast('Não há imagem na área de transferência. Tire o print (Win+Shift+S) e tente de novo.', true);
    }).catch(function() { toast('O navegador não liberou a leitura. Use Ctrl+V com o cartão aberto.', true); });
  }

  function abrirEditor(arquivo) {
    if (!cartaoId) { toast('Crie o cartão antes de anexar prints.', true); return; }
    var url = URL.createObjectURL(arquivo);
    var img = new Image();
    img.onload = function() {
      var esc1 = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
      var cv = $('telaPrint');
      cv.width = Math.round(img.naturalWidth * esc1); cv.height = Math.round(img.naturalHeight * esc1);
      editor.img = img; editor.formas = []; editor.atual = null;
      desenhar();
      $('printInfo').textContent = cv.width + ' × ' + cv.height + ' px';
      $('dlgPrint').showModal();
    };
    img.onerror = function() { toast('Não foi possível abrir a imagem.', true); };
    img.src = url;
  }
  function espessura() { var cv = $('telaPrint'); return Math.max(3, Math.round(Math.max(cv.width, cv.height) / 380)); }
  function desenharForma(ctx, f) {
    ctx.strokeStyle = f.cor; ctx.fillStyle = f.cor; ctx.lineWidth = f.larg; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (f.tipo === 'caneta') {
      ctx.beginPath(); f.pontos.forEach(function(p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke();
    } else if (f.tipo === 'retangulo') {
      ctx.strokeRect(Math.min(f.x1, f.x2), Math.min(f.y1, f.y2), Math.abs(f.x2 - f.x1), Math.abs(f.y2 - f.y1));
    } else if (f.tipo === 'seta') {
      var ang = Math.atan2(f.y2 - f.y1, f.x2 - f.x1), cab = f.larg * 4.5;
      ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(f.x2, f.y2);
      ctx.lineTo(f.x2 - cab * Math.cos(ang - 0.45), f.y2 - cab * Math.sin(ang - 0.45));
      ctx.lineTo(f.x2 - cab * Math.cos(ang + 0.45), f.y2 - cab * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    } else if (f.tipo === 'texto') {
      ctx.font = 'bold ' + f.tam + 'px Inter, Arial, sans-serif'; ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(3, f.tam / 6); ctx.strokeStyle = '#fff'; ctx.strokeText(f.texto, f.x, f.y);
      ctx.fillText(f.texto, f.x, f.y);
    }
  }
  function desenhar() {
    var cv = $('telaPrint'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (editor.img) ctx.drawImage(editor.img, 0, 0, cv.width, cv.height);
    editor.formas.concat(editor.atual ? [editor.atual] : []).forEach(function(f) { desenharForma(ctx, f); });
  }
  function pontoNaTela(e) {
    var cv = $('telaPrint'), r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
  }
  function ligarEditor() {
    var cv = $('telaPrint');
    cv.addEventListener('pointerdown', function(e) {
      var p = pontoNaTela(e), larg = espessura();
      if (editor.ferramenta === 'texto') {
        var t = prompt('Texto da anotação:');
        if (t && t.trim()) { editor.formas.push({ tipo: 'texto', cor: editor.cor, larg: larg, texto: t.trim(), x: p[0], y: p[1], tam: Math.max(18, Math.round(cv.width / 45)) }); desenhar(); }
        return;
      }
      cv.setPointerCapture(e.pointerId);
      editor.atual = editor.ferramenta === 'caneta' ? { tipo: 'caneta', cor: editor.cor, larg: larg, pontos: [p] }
        : { tipo: editor.ferramenta, cor: editor.cor, larg: larg, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
    });
    cv.addEventListener('pointermove', function(e) {
      if (!editor.atual) return;
      var p = pontoNaTela(e);
      if (editor.atual.tipo === 'caneta') editor.atual.pontos.push(p); else { editor.atual.x2 = p[0]; editor.atual.y2 = p[1]; }
      desenhar();
    });
    function soltar() { if (editor.atual) { editor.formas.push(editor.atual); editor.atual = null; desenhar(); } }
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', soltar);
    $('ferramentas').addEventListener('click', function(e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ferramenta) {
        editor.ferramenta = b.dataset.ferramenta;
        $('ferramentas').querySelectorAll('[data-ferramenta]').forEach(function(x) { x.classList.toggle('ativo', x === b); });
      } else if (b.dataset.cor) {
        editor.cor = b.dataset.cor;
        $('ferramentas').querySelectorAll('[data-cor]').forEach(function(x) { x.classList.toggle('ativo', x === b); });
      }
    });
    $('btnDesfazer').onclick = function() { editor.formas.pop(); desenhar(); };
    $('btnSalvarPrint').onclick = salvarPrint;
    document.querySelector('[data-fechar-print]').onclick = function() {
      if (editor.formas.length && !confirm('Descartar este print e as anotações?')) return;
      $('dlgPrint').close();
    };
  }
  function paraArquivo(cv, qualidade) {
    return new Promise(function(ok) {
      cv.toBlob(function(b) {
        if (b && b.type === 'image/webp') return ok(b);
        cv.toBlob(ok, 'image/jpeg', qualidade);           // navegador sem WebP
      }, 'image/webp', qualidade);
    });
  }
  function salvarPrint() {
    var cv = $('telaPrint'), id = cartaoId;
    $('btnSalvarPrint').disabled = true;
    paraArquivo(cv, 0.82).then(function(b) {
      return b.size > 1900000 ? paraArquivo(cv, 0.6) : b;
    }).then(function(b) {
      var ext = b.type === 'image/webp' ? 'webp' : 'jpg';
      var caminho = id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      return sb.storage.from(BUCKET).upload(caminho, b, { contentType: b.type, upsert: false }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return sb.from('ger_anexos').insert({ cartao_id: id, caminho: caminho, nome: 'print.' + ext, bytes: b.size, largura: cv.width, altura: cv.height, autor: eu() });
      }).then(function(res) {
        if (res.error) { sb.storage.from(BUCKET).remove([caminho]); throw new Error(res.error.message); }
        toast('Print salvo (' + Math.round(b.size / 1024) + ' KB)');
        $('dlgPrint').close();
        if (id === cartaoId) renderLado();
      });
    }).catch(function(e) { toast('Não foi possível salvar o print: ' + e.message, true); })
      .then(function() { $('btnSalvarPrint').disabled = false; });
  }

  // ---------- Configurar quadros (administradores) ----------
  function renderConfig() {
    var cols = colunasDoQuadro(quadroId), q = quadros.find(function(x) { return x.id === quadroId; });
    $('config').innerHTML =
      '<div><h4>Quadros</h4>' + quadros.map(function(x, i) {
        var n = cartoes.filter(function(c) { return c.quadro_id === x.id; }).length;
        return '<div class="ger-config-linha" data-q="' + x.id + '"><input type="text" data-q-nome value="' + esc(x.nome) + '" />' +
          '<input type="text" data-q-desc value="' + esc(x.descricao || '') + '" placeholder="Descrição" />' +
          '<button type="button" class="mini" data-acao="q-subir"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button type="button" class="mini" data-acao="q-salvar">Salvar</button>' +
          '<button type="button" class="mini mini-perigo" data-acao="q-excluir"' + (n ? ' disabled title="Tem ' + n + ' cartão(ões)"' : '') + '>Excluir</button></div>';
      }).join('') +
      '<div class="ger-config-linha"><input type="text" id="novoQuadro" placeholder="Nome do novo quadro" /><button type="button" class="mini" data-acao="q-novo">Criar quadro</button>' +
      '<small>começa com as colunas A fazer, Fazendo e Concluído</small></div></div>' +
      (q ? '<div><h4>Colunas de "' + esc(q.nome) + '"</h4>' + cols.map(function(c, i) {
        var n = cartoes.filter(function(x) { return x.coluna_id === c.id; }).length;
        return '<div class="ger-config-linha" data-col="' + c.id + '"><input type="color" data-col-cor value="' + esc(c.cor || '#94a3b8') + '" />' +
          '<input type="text" data-col-nome value="' + esc(c.nome) + '" />' +
          '<label><input type="checkbox" data-col-fim' + (c.finaliza ? ' checked' : '') + ' /> conclui</label>' +
          '<button type="button" class="mini" data-acao="c-subir"' + (i ? '' : ' disabled') + '>←</button>' +
          '<button type="button" class="mini" data-acao="c-salvar">Salvar</button>' +
          '<button type="button" class="mini mini-perigo" data-acao="c-excluir"' + (n ? ' disabled title="Tem ' + n + ' cartão(ões)"' : '') + '>Excluir</button></div>';
      }).join('') +
      '<div class="ger-config-linha"><input type="text" id="novaColuna" placeholder="Nome da nova coluna" /><button type="button" class="mini" data-acao="c-nova">Criar coluna</button></div>' +
      '<small class="ger-vazio">"conclui": o cartão que entra nessa coluna conta como concluído. Coluna ou quadro com cartões não pode ser excluído.</small></div>' : '');
  }
  function aoClicarConfig(e) {
    var b = e.target.closest('[data-acao]'); if (!b) return;
    var linha = b.closest('.ger-config-linha'), a = b.dataset.acao, op = null;
    if (a === 'q-novo') {
      var nomeQ = $('novoQuadro').value.trim(); if (!nomeQ) return;
      op = sb.from('ger_quadros').insert({ nome: nomeQ, ordem: quadros.length + 1 }).select().single().then(function(res) {
        var q = dados(res);
        return sb.from('ger_colunas').insert([['A fazer', '#64748b', 1, false], ['Fazendo', '#2b7bd6', 2, false], ['Concluído', '#1e9538', 3, true]].map(function(c) {
          return { quadro_id: q.id, nome: c[0], cor: c[1], ordem: c[2], finaliza: c[3] };
        })).then(dados).then(function() { quadroId = q.id; });
      });
    } else if (a === 'q-salvar') {
      op = sb.from('ger_quadros').update({ nome: linha.querySelector('[data-q-nome]').value.trim(), descricao: linha.querySelector('[data-q-desc]').value.trim() || null }).eq('id', linha.dataset.q).then(dados);
    } else if (a === 'q-excluir') {
      if (!confirm('Excluir este quadro e as colunas dele?')) return;
      op = sb.from('ger_quadros').delete().eq('id', linha.dataset.q).then(dados);
    } else if (a === 'q-subir') {
      var iq = quadros.findIndex(function(x) { return String(x.id) === linha.dataset.q; });
      var ordemQ = quadros.map(function(x) { return x.id; }); ordemQ.splice(iq - 1, 0, ordemQ.splice(iq, 1)[0]);
      op = Promise.all(ordemQ.map(function(id, i) { return sb.from('ger_quadros').update({ ordem: i + 1 }).eq('id', id).then(dados); }));
    } else if (a === 'c-nova') {
      var nomeC = $('novaColuna').value.trim(); if (!nomeC) return;
      op = sb.from('ger_colunas').insert({ quadro_id: quadroId, nome: nomeC, ordem: colunasDoQuadro(quadroId).length + 1, cor: '#64748b' }).then(dados);
    } else if (a === 'c-salvar') {
      op = sb.from('ger_colunas').update({ nome: linha.querySelector('[data-col-nome]').value.trim(), cor: linha.querySelector('[data-col-cor]').value,
        finaliza: linha.querySelector('[data-col-fim]').checked }).eq('id', linha.dataset.col).then(dados);
    } else if (a === 'c-excluir') {
      if (!confirm('Excluir esta coluna?')) return;
      op = sb.from('ger_colunas').delete().eq('id', linha.dataset.col).then(dados);
    } else if (a === 'c-subir') {
      var cols = colunasDoQuadro(quadroId).map(function(x) { return x.id; }), ic = cols.indexOf(Number(linha.dataset.col));
      cols.splice(ic - 1, 0, cols.splice(ic, 1)[0]);
      op = Promise.all(cols.map(function(id, i) { return sb.from('ger_colunas').update({ ordem: i + 1 }).eq('id', id).then(dados); }));
    }
    if (!op) return;
    op.then(function() { return carregar(); }).then(function() { render(); renderConfig(); toast('Configuração salva'); })
      .catch(function(err) { toast('Não foi possível salvar: ' + err.message, true); });
  }

  // ---------- Início ----------
  Acesso.pronto.then(function(p) {
    perfil = p;
    if (!Acesso.podeVer('GERENCIA')) { $('restrito').hidden = false; return; }
    $('ger').hidden = false;
    $('btnConfig').hidden = !admin();
    try { quadroId = Number(localStorage.getItem(CHAVE_QUADRO)) || null; } catch (e) { /* sem storage */ }
    var q = new URLSearchParams(location.search);
    if (q.get('quadro')) quadroId = Number(q.get('quadro'));
    ligarArrastar();
    ligarEditor();

    $('quadros').addEventListener('click', function(e) {
      var b = e.target.closest('[data-quadro]'); if (!b) return;
      quadroId = Number(b.dataset.quadro);
      try { localStorage.setItem(CHAVE_QUADRO, String(quadroId)); } catch (er) { /* sem storage */ }
      renderQuadros(); renderColunas();
    });
    $('colunas').addEventListener('click', function(e) { var c = e.target.closest('[data-cartao]'); if (c) abrirCartao(c.dataset.cartao); });
    $('colunas').addEventListener('keydown', function(e) { var c = e.target.closest('[data-cartao]'); if (c && e.key === 'Enter') abrirCartao(c.dataset.cartao); });
    $('colunas').addEventListener('submit', function(e) {
      var f = e.target.closest('[data-rapido]'); if (!f) return;
      e.preventDefault();
      var t = f.titulo.value.trim(); if (!t) return;
      f.titulo.value = '';
      criarRapido(Number(f.dataset.rapido), t);
    });
    ['busca', 'filtroResp', 'soMeus', 'mostrarConcluidos'].forEach(function(id) { $(id).addEventListener('input', renderColunas); $(id).addEventListener('change', renderColunas); });
    $('btnNovo').onclick = function() { if (!quadroId) { toast('Nenhum quadro.', true); return; } abrirCartao(null); };
    $('btnAtualizar').onclick = function() { recarregar(); };
    $('btnConfig').onclick = function() { renderConfig(); $('dlgConfig').showModal(); };
    $('config').addEventListener('click', aoClicarConfig);

    // Ficha do cartão: links, prints e comentários
    $('cartaoDados').addEventListener('click', function(e) {
      var cp = e.target.closest('[data-copiar]');
      if (cp) {
        navigator.clipboard.writeText(cp.dataset.copiar).then(function() { toast('Caminho copiado: cole no Explorador de Arquivos (Ctrl+L, Ctrl+V)'); },
          function() { prompt('Copie o caminho:', cp.dataset.copiar); });
      }
      var tc = e.target.closest('[data-tirar-co]');
      if (tc) { selCorresp = selCorresp.filter(function(u) { return u !== tc.dataset.tirarCo; }); renderChips(cartao(cartaoId), true); return; }
      var tg = e.target.closest('[data-tirar-ligado]');
      if (tg) { selLigados = selLigados.filter(function(i) { return i !== Number(tg.dataset.tirarLigado); }); renderChips(cartao(cartaoId), true); return; }
      var ab = e.target.closest('[data-abrir-cartao]');
      if (ab) { abrirCartao(ab.dataset.abrirCartao); return; }
      var tl = e.target.closest('[data-tirar-link]');
      if (tl) { var l = lerLinks(); l.splice(Number(tl.dataset.tirarLink), 1); renderLinks(l, true); }
    });
    $('btnComentar').onclick = comentar;
    $('btnColar').onclick = colarPeloBotao;
    $('arquivoPrint').onchange = function() { if (this.files[0]) abrirEditor(this.files[0]); this.value = ''; };
    document.addEventListener('paste', function(e) {
      if (!$('dlgCartao').open || $('dlgPrint').open) return;
      var f = imagemDaArea(e.clipboardData && e.clipboardData.items);
      if (f) { e.preventDefault(); abrirEditor(f); }
    });
    $('anexos').addEventListener('click', function(e) {
      var img = e.target.closest('[data-abrir]'); if (img) { window.open(img.dataset.abrir, '_blank', 'noopener'); return; }
      var t = e.target.closest('[data-tirar-anexo]'); if (!t || !confirm('Apagar este print?')) return;
      sb.storage.from(BUCKET).remove([t.dataset.caminho]).then(function() {
        return sb.from('ger_anexos').delete().eq('id', t.dataset.tirarAnexo).select('id');
      }).then(function(res) {
        if (res.error || !res.data.length) toast('Não foi possível apagar o print.', true); else renderLado();
      });
    });
    $('comentarios').addEventListener('click', function(e) {
      var t = e.target.closest('[data-tirar-comentario]'); if (!t || !confirm('Excluir este comentário?')) return;
      sb.from('ger_comentarios').delete().eq('id', t.dataset.tirarComentario).select('id').then(function(res) {
        if (res.error || !res.data.length) toast('Não foi possível excluir o comentário.', true); else renderLado();
      });
    });
    $('dlgCartao').addEventListener('close', function() { cartaoId = null; history.replaceState(null, '', location.pathname); });

    // Volta para a aba depois de um tempo: busca de novo (outra pessoa pode ter mexido).
    window.addEventListener('focus', function() {
      if (Date.now() - carregadoEm > 60000 && !$('dlgCartao').open && !$('dlgPrint').open && !$('dlgConfig').open) recarregar(true);
    });

    $('colunas').innerHTML = '<p class="ger-vazio">Carregando…</p>';
    return carregar().then(function() {
      render();
      var cod = q.get('cartao');
      if (cod) {
        var c = cartoes.find(function(x) { return x.codigo === cod.toUpperCase(); });
        if (c) { quadroId = c.quadro_id; render(); abrirCartao(c.id); } else toast('Cartão ' + cod + ' não encontrado.', true);
      }
    });
  }).catch(function(e) { toast('Erro ao abrir os quadros: ' + e.message, true); });
})();
