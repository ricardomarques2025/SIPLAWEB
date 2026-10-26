// Tabela de edicao das obras da origem aberta (mapa.html?origem=DOR...). A origem pode mudar sem recarregar a pagina:
// o seletor no titulo lista SO as origens ligadas no mapa (trocar ali nao mexe no mapa) e, se a origem da tabela for
// desligada nos botoes, a tabela passa para a proxima ligada (trocarOrigem / origensMudaram).
// "Abrir tabela" no painel ORIGEM do menu esquerdo; tela cheia ou dividida com o mapa (como na Jurisdicao).
// Edicoes ficam pendentes (amarelo) ate "Revisar e salvar", que mostra o resumo antes -> depois, confere as
// regras e, se etapa/status mudaram, pede a data do fato para a linha do tempo. Depois de gravar, o mapa e
// recarregado sem perder o enquadramento. Ficha: dados, linha do tempo (notas, tramitar origem) e historico.
// Visual: reaproveita as classes da tabela da Jurisdicao (css/jurisdicao_tabela.css, escopo .jur-ui).
// Niveis (js/acesso.js): visualizador/gerenciador so consultam; editor basico edita, mas "salvar" vira proposta;
// editor pleno grava direto e decide as propostas em "Aprovações"; excluir, tramitar e notas sao do pleno.

var ObrasPainel = (function() {
  var ORIGEM = String(new URLSearchParams(location.search).get('origem') || '').toUpperCase();
  if (!ORIGEM) return null;

  var LIBS = {
    tabulatorCss: 'https://unpkg.com/tabulator-tables@6.3.1/dist/css/tabulator.min.css',
    tabulatorJs: 'https://unpkg.com/tabulator-tables@6.3.1/dist/js/tabulator.min.js',
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
  };
  var CHAVE_LARGURA = 'siplaweb.obras.larguraTabela';
  function chaveColunas() { return 'siplaweb.obras.colunas.' + ORIGEM; }
  var LARGURA_MIN = 30, LARGURA_MAX = 80;
  var ACOES = { criado: 'Cadastrou', editado: 'Editou', tracado: 'Alterou o traçado', tramitou_origem: 'Tramitou de origem', excluido: 'Excluiu', restaurado: 'Restaurou' };
  var EVENTOS = { cadastro: 'Cadastro', situacao: 'Situação', origem: 'Mudança de origem', nota: 'Nota' };

  var modo = 'fechado';
  var tabelaPronta = null;
  var grade = null;
  var fichaUid = null;
  var abaFicha = 'dados';
  var selecionadoUid = null;
  var halo = null;
  var legendaRecolhidaPorNos = false;
  var filtros = { busca: '', etapa: '', status: '', tracado: '' };

  map.createPane('obrasHaloPane').style.zIndex = 515;

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function hojeIso() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function fmtData(v) { if (!v) return ''; var p = String(v).slice(0, 10).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtDataHora(v) { return v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
  function campo(c) { return CAMPOS_OBRA.find(function(x) { return x.campo === c; }); }
  function exibir(c, v) {
    if (v === null || v === undefined || v === '') return '';
    if (c.tipo === 'data') return fmtData(v);
    if (c.tipo === 'numero') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    return String(v);
  }
  // Traçado considera o que está pendente (o halo e o "Ver no mapa" já mostram a escolha antes de salvar).
  function temTracado(r) { var v = ObrasStore.valorAtual(r.uid, 'vinculos'); return !!((v && v.length) || ObrasStore.valorAtual(r.uid, 'geom')); }
  var CAMPOS_TRACADO = { vinculos: 'Traçado (vínculos)', geom: 'Coordenada do ponto' };
  // Antes/depois em texto: campos comuns pelo CAMPOS_OBRA, traçado pelo ObrasTracado.
  function textoMudanca(c, antes, depois) {
    if (CAMPOS_TRACADO[c]) { var t = ObrasTracado.descrever(c, antes, depois); return { titulo: CAMPOS_TRACADO[c], antes: t.antes, depois: t.depois }; }
    if (c === 'tipo') return { titulo: 'Tipo de traçado', antes: antes || '', depois: depois || '' };
    var def = campo(c) || { titulo: c };
    return { titulo: def.titulo, antes: exibir(def, antes), depois: exibir(def, depois) };
  }

  function toast(msg, erro) {
    var el = document.createElement('div');
    el.className = 'toast' + (erro ? ' toast-erro' : '');
    el.textContent = msg;
    $('obrToasts').appendChild(el);
    setTimeout(function() { el.remove(); }, erro ? 8000 : 3500);
  }
  function carregarScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script'); s.src = url; s.onload = resolve;
      s.onerror = function() { reject(new Error('Falha ao carregar ' + url)); };
      document.head.appendChild(s);
    });
  }
  function carregarCss(url) {
    if (document.querySelector('link[href="' + url + '"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l);
  }

  // ---------- Montagem ----------
  var SPRITE = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="o-table" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M3 15h18M9 10v11"/></symbol>' +
    '<symbol id="o-split" viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 3v18"/></symbol>' +
    '<symbol id="o-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></symbol>' +
    '<symbol id="o-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>' +
    '<symbol id="o-down" viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></symbol>' +
    '<symbol id="o-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></symbol>' +
    '<symbol id="o-cols" viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 4h4v16h-4z"/></symbol>' +
    '<symbol id="o-pin" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></symbol>' +
    '<symbol id="o-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></symbol>' +
    '<symbol id="o-filter-x" viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4zM16 16l5 5M21 16l-5 5"/></symbol>' +
    '<symbol id="o-check" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></symbol>' +
    '</svg>';

  function montar() {
    var ui = document.createElement('div');
    ui.className = 'jur-ui obr-ui';
    ui.id = 'obrUi';
    ui.innerHTML = SPRITE +
      '<section class="jur-tabela" id="obrTabela" hidden data-modo="cheia">' +
        '<div class="jur-tabela-topo">' +
          '<label class="jur-tabela-titulo obr-titulo"><select id="obrOrigem" title="Trocar a origem da tabela (o mapa acompanha)"></select> · Obras</label><span class="lt-selo" hidden></span>' +
          '<nav class="segmentado" aria-label="Modo da tabela">' +
            '<button type="button" data-obr-modo="cheia"><svg><use href="#o-table"/></svg>Tela cheia</button>' +
            '<button type="button" data-obr-modo="dividida"><svg><use href="#o-split"/></svg>Dividida com o mapa</button>' +
          '</nav>' +
          // Pendencias a esquerda: continuam visiveis com a ficha aberta (ela cobre o lado direito).
          '<button type="button" class="btn btn-primario so-editor" id="obrRevisar" disabled><svg><use href="#o-check"/></svg>Revisar e salvar</button>' +
          '<span class="obr-pendentes" id="obrPendentes" hidden></span>' +
          '<button type="button" class="btn btn-fantasma so-editor" id="obrDescartar" hidden>Descartar</button>' +
          '<button type="button" class="btn so-editor" id="obrAprovacoes"></button>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="btn" id="obrExportar" data-exportar><svg><use href="#o-down"/></svg>Excel</button>' +
          '<button type="button" class="btn-icone" id="obrFechar" title="Fechar a tabela e voltar ao mapa"><svg><use href="#o-x"/></svg></button>' +
        '</div>' +
        '<section class="ferramentas">' +
          '<label class="busca"><svg><use href="#o-search"/></svg><input id="obrBusca" type="search" placeholder="Buscar código, descrição, município, SEI…" autocomplete="off"></label>' +
          '<select id="obrFEtapa" class="seletor"><option value="">Todas as etapas</option></select>' +
          '<select id="obrFStatus" class="seletor"><option value="">Todos os status</option></select>' +
          '<select id="obrFTracado" class="seletor"><option value="">Com e sem traçado</option><option value="com">Com traçado</option><option value="sem">Sem traçado</option></select>' +
          '<button type="button" class="btn btn-fantasma" id="obrLimpar" title="Limpar filtros"><svg><use href="#o-filter-x"/></svg></button>' +
          '<span class="contador" id="obrContador"></span>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="btn" id="obrColunas"><svg><use href="#o-cols"/></svg>Colunas</button>' +
          '<button type="button" class="btn btn-primario so-editor" id="obrNova"><svg><use href="#o-plus"/></svg>Nova obra</button>' +
        '</section>' +
        '<div class="painel-tabela"><div id="obrGrade"></div></div>' +
        '<div class="jur-redimensionar" id="obrRedimensionar" title="Arraste para aumentar ou diminuir a tabela"></div>' +
      '</section>' +
      '<aside class="gaveta" id="obrFicha" aria-hidden="true">' +
        '<div class="gaveta-topo"><div><div class="gaveta-sup" id="obrFichaSup"></div><h2 id="obrFichaTitulo"></h2></div>' +
          '<button type="button" class="btn-icone" id="obrFecharFicha" title="Fechar"><svg><use href="#o-x"/></svg></button></div>' +
        '<div class="gaveta-abas"><button type="button" class="ativo" data-aba="dados">Dados</button><button type="button" data-aba="tracado">Traçado</button><button type="button" data-aba="tempo">Linha do tempo</button><button type="button" data-aba="historico">Histórico</button></div>' +
        '<div class="gaveta-corpo" id="obrFichaCorpo"></div>' +
        '<div class="gaveta-rodape">' +
          '<button type="button" class="btn btn-perigo-fantasma so-editor so-pleno" id="obrExcluir"><svg><use href="#o-trash"/></svg>Excluir</button>' +
          '<div class="espaco"></div>' +
          '<button type="button" class="btn btn-primario" id="obrVerMapa"><svg><use href="#o-pin"/></svg>Ver no mapa</button>' +
        '</div>' +
      '</aside>' +
      '<dialog id="obrDlgRevisao" class="dialogo"><div class="dialogo-topo"><h3 id="obrRevisaoTitulo">Conferir antes de salvar</h3><button type="button" class="btn-icone" data-obr-fechar><svg><use href="#o-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="obrRevisaoCorpo"></div>' +
        '<div class="dialogo-rodape"><span class="obr-aviso" id="obrRevisaoAviso"></span><div class="espaco"></div>' +
          '<button type="button" class="btn" data-obr-fechar>Voltar e corrigir</button>' +
          '<button type="button" class="btn btn-primario" id="obrConfirmar"><svg><use href="#o-check"/></svg>Confirmar e salvar</button></div></dialog>' +
      '<dialog id="obrDlgNova" class="dialogo dialogo-pequeno"><form id="obrFormNova"><div class="dialogo-topo"><h3 id="obrNovaTitulo">Nova obra · ' + esc(ORIGEM) + '</h3><button type="button" class="btn-icone" data-obr-fechar><svg><use href="#o-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="obrNovaCorpo"></div>' +
        '<div class="dialogo-rodape"><span class="obr-aviso" id="obrNovaAviso"></span><div class="espaco"></div><button type="submit" class="btn btn-primario"><svg><use href="#o-check"/></svg>Cadastrar</button></div></form></dialog>' +
      '<dialog id="obrDlgColunas" class="dialogo dialogo-pequeno"><div class="dialogo-topo"><h3>Colunas visíveis</h3><button type="button" class="btn-icone" data-obr-fechar><svg><use href="#o-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="obrColunasCorpo"></div></dialog>' +
      '<dialog id="obrDlgAprov" class="dialogo"><div class="dialogo-topo"><h3 id="obrAprovTitulo">Aprovações</h3><button type="button" class="btn-icone" data-obr-fechar><svg><use href="#o-x"/></svg></button></div>' +
        '<div class="dialogo-corpo" id="obrAprovCorpo"></div></dialog>' +
      '<div class="toasts" id="obrToasts"></div>';
    document.body.appendChild(ui);
    Acesso.aplicarExportacao();
    if (window.LinhaTempo) LinhaTempo.atualizarSelos();

    // "Abrir tabela de obras" sempre a vista, no topo do menu esquerdo (acima do painel ORIGEM).
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.id = 'obrAbrirTabela';
    botao.className = 'jur-abrir-tabela obr-abrir-tabela';
    botao.textContent = 'Abrir tabela de obras';
    var conteudo = $('sidebar-left-content');
    conteudo.insertBefore(botao, conteudo.firstElementChild);
    botao.addEventListener('click', function() { definirModo('cheia'); });
    ligarEventos();
  }

  // ---------- Origem da tabela ----------
  // Origens ligadas no mapa que a pessoa ve, na ordem dos botoes (js/mapa.js: origensAtivasMapa).
  function origensAtivas() {
    var ligadas = typeof origensAtivasMapa === 'function' ? origensAtivasMapa() : [ORIGEM];
    return Array.prototype.map.call(document.querySelectorAll('.servico-btn[data-servico]'), function(b) { return b.dataset.servico; })
      .filter(function(o) { return ligadas.indexOf(o) !== -1 && Acesso.podeVer(o); });
  }
  // Lista do titulo: as ligadas (sem nenhuma ligada, so a origem atual da tabela).
  function preencherSeletorOrigem() {
    var lista = origensAtivas();
    if (lista.indexOf(ORIGEM) === -1) lista = lista.length ? lista : [ORIGEM];
    $('obrOrigem').innerHTML = lista.map(function(o) {
      return '<option value="' + esc(o) + '"' + (o === ORIGEM ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    $('obrOrigem').disabled = lista.length < 2;
    $('obrOrigem').title = lista.length < 2 ? 'Ligue mais origens no mapa para alternar entre elas aqui' : 'Alternar entre as origens ligadas no mapa';
  }

  // Troca a tabela para outra origem: confere pendencias e recarrega as obras (o mapa nao muda).
  // Devolve false se a pessoa preferiu nao descartar o que estava pendente.
  function trocarOrigem(nova) {
    nova = String(nova || '').toUpperCase();
    if (!nova || nova === ORIGEM || !Acesso.podeVer(nova)) return true;
    var n = ObrasStore.totalPendentes();
    if (n && !confirm('A tabela de ' + ORIGEM + ' tem ' + n + ' alteração(ões) não salvas. Trocar para ' + nova + ' descarta essas alterações.\n\nTrocar mesmo assim?')) {
      $('obrOrigem').value = ORIGEM;
      return false;
    }
    if (ObrasTracado.ativo()) ObrasTracado.encerrar();
    fecharFicha();
    limparHalo();
    ORIGEM = nova;
    preencherSeletorOrigem();
    $('obrNovaTitulo').textContent = 'Nova obra · ' + nova;
    $('obrAbrirTabela').textContent = 'Abrir tabela de obras';
    filtros = { busca: '', etapa: '', status: '', tracado: '' };
    ['obrBusca', 'obrFEtapa', 'obrFStatus', 'obrFTracado'].forEach(function(id) { $(id).value = ''; });
    if (grade) { grade.destroy(); grade = null; }
    tabelaPronta = null;
    // Endereco acompanha (recarregar ou mandar o link abre esta origem).
    var url = new URL(location.href);
    url.searchParams.set('origem', nova);
    history.replaceState(null, '', url.toString());
    if (modo !== 'fechado') definirModo(modo);
    else contarAprovacoes();
    return true;
  }

  // Botoes de origem do mapa: a lista acompanha; se a origem da tabela foi desligada, vai para a primeira ligada.
  function origensMudaram() {
    var ligadas = origensAtivas();
    if (ligadas.length && ligadas.indexOf(ORIGEM) === -1) trocarOrigem(ligadas[0]);
    preencherSeletorOrigem();
  }

  function contarAprovacoes() {
    if (!Acesso.podeEditar(ORIGEM)) return;
    var origem = ORIGEM;
    Acesso.cliente.from('propostas').select('pid', { count: 'exact', head: true }).eq('origem', origem).eq('situacao', 'pendente').then(function(res) {
      if (!res.error && res.count && !grade && origem === ORIGEM) $('obrAbrirTabela').textContent = 'Abrir tabela de obras · ' + res.count + ' para aprovar';
    });
  }

  // ---------- Modos (como na tabela da Jurisdicao) ----------
  function posicionar() {
    var topo = $('topbar');
    $('obrUi').style.setProperty('--jur-topo', (topo ? topo.getBoundingClientRect().bottom : 60) + 'px');
  }
  function larguraSalva() {
    var v = NaN;
    try { v = Number(localStorage.getItem(CHAVE_LARGURA)); } catch (e) { /* sem storage */ }
    return v >= LARGURA_MIN && v <= LARGURA_MAX ? v : 55;
  }
  function aplicarLargura(pct) { $('obrUi').style.setProperty('--jur-largura', pct + 'vw'); }
  function recolherLegenda(recolher) {
    var barra = $('sidebar-right'), botao = $('toggleSidebarRight');
    if (!barra || typeof definirSidebarRecolhida !== 'function') return;
    var recolhida = barra.classList.contains('sidebar-colapsed');
    if (recolher && !recolhida) { definirSidebarRecolhida('sidebar-right', 'sidebar-right-collapsed', botao, true); legendaRecolhidaPorNos = true; }
    else if (!recolher && legendaRecolhidaPorNos) { definirSidebarRecolhida('sidebar-right', 'sidebar-right-collapsed', botao, false); legendaRecolhidaPorNos = false; }
  }

  function iniciarTabela() {
    if (!tabelaPronta) {
      carregarCss(LIBS.tabulatorCss);
      tabelaPronta = Promise.all([window.Tabulator ? null : carregarScript(LIBS.tabulatorJs), ObrasStore.carregar(ORIGEM)]).then(function() {
        $('obrUi').classList.toggle('somente-leitura', !ObrasStore.podeAlterar());
        $('obrUi').classList.toggle('sem-pleno', !ObrasStore.podeGravar());
        atualizarAprovacoes();
        atualizarPendentes();
        preencherFiltros();
        criarGrade();
        return new Promise(function(resolve) { grade.on('tableBuilt', resolve); });
      }).then(aplicarFiltros);
    }
    return tabelaPronta;
  }

  function definirModo(novo) {
    var anterior = modo;
    if (anterior === 'fechado' && novo !== 'fechado') origensMudaram();   // abre já numa origem ligada no mapa
    modo = novo;
    var painel = $('obrTabela');
    recolherLegenda(novo === 'dividida');
    if (novo === 'fechado') { painel.hidden = true; fecharFicha(); limparHalo(); return Promise.resolve(); }
    posicionar();
    aplicarLargura(larguraSalva());
    painel.dataset.modo = novo;
    if (anterior === 'fechado') { painel.classList.remove('jur-entrando'); void painel.offsetWidth; painel.classList.add('jur-entrando'); }
    painel.hidden = false;
    document.querySelectorAll('[data-obr-modo]').forEach(function(b) { b.classList.toggle('ativo', b.dataset.obrModo === novo); });
    return iniciarTabela().then(function() {
      setTimeout(function() { grade.redraw(); map.invalidateSize(); }, 380);
      if (novo === 'dividida') centralizar(420);
    }).catch(function(e) { toast('Não foi possível abrir a tabela: ' + e.message, true); });
  }

  // ---------- Grade ----------
  function colunasVisiveisPadrao() {
    var lista = ObrasStore.lista();
    return CAMPOS_OBRA.filter(function(c) {
      return c.comum || lista.some(function(r) { return r[c.campo] !== null && r[c.campo] !== undefined && r[c.campo] !== ''; });
    }).map(function(c) { return c.campo; });
  }
  function colunasVisiveis() {
    try { var v = JSON.parse(localStorage.getItem(chaveColunas())); if (Array.isArray(v)) return v; } catch (e) { /* sem storage */ }
    return colunasVisiveisPadrao();
  }

  function formatador(c) {
    return function(cell) {
      var uid = cell.getRow().getData().uid;
      var v = ObrasStore.valorAtual(uid, c.campo);
      cell.getElement().classList.toggle('celula-editada', ObrasStore.pendente(uid, c.campo));
      if (c.campo === 'etapa' && v) return '<span class="badge" style="--c:' + (CORES_ETAPA_OBRA[v] || '#64748b') + '">' + esc(v) + '</span>';
      var txt = exibir(c, v);
      return c.tipo === 'numero' ? '<span class="num">' + esc(txt) + '</span>' : esc(txt);
    };
  }

  function editorDe(c) {
    if (c.somenteLeitura) return {};
    var pode = { editable: function() { return ObrasStore.podeAlterar(); } };
    var listas = ObrasStore.listas();
    if (c.tipo === 'lista') return Object.assign(pode, { editor: 'list', editorParams: { values: [''].concat(listas[c.campo] || []), autocomplete: true, listOnEmpty: true } });
    if (c.tipo === 'numero') return Object.assign(pode, { editor: 'number', editorParams: { step: 0.01, min: 0 } });
    if (c.tipo === 'longo') return Object.assign(pode, { editor: 'textarea', editorParams: { verticalNavigation: 'hybrid' } });
    if (c.tipo === 'data') return Object.assign(pode, { editor: 'date', editorParams: { max: hojeIso() } });
    return Object.assign(pode, { editor: 'input' });
  }

  function criarGrade() {
    var visiveis = colunasVisiveis();
    var cols = [{
      title: '', field: '_ficha', width: 40, headerSort: false, frozen: true, hozAlign: 'center', cssClass: 'col-acao',
      formatter: function(cell) {
        return ObrasStore.propostaPendente(cell.getRow().getData().uid) ? '<span class="obr-relogio" title="Proposta aguardando aprovação">◷</span>'
          : '<svg style="color:#8a93a3"><use href="#o-split"/></svg>';
      },
      cellClick: function(e, cell) { e.stopPropagation(); abrirFicha(cell.getRow().getData().uid); }
    }, {
      title: '', field: '_mapa', width: 40, headerSort: false, frozen: true, hozAlign: 'center', cssClass: 'col-acao',
      formatter: function(cell) { return '<svg class="' + (temTracado(cell.getRow().getData()) ? 'geo-ok' : 'geo-sem') + '"><use href="#o-pin"/></svg>'; },
      tooltip: function(e, cell) { return temTracado(cell.getRow().getData()) ? 'Ver no mapa' : 'Sem traçado'; },
      cellClick: function(e, cell) { e.stopPropagation(); verNoMapa(cell.getRow().getData().uid); }
    }];
    CAMPOS_OBRA.forEach(function(c) {
      cols.push(Object.assign({
        title: c.titulo, field: c.campo, width: c.largura, frozen: !!c.fixa, visible: visiveis.indexOf(c.campo) !== -1,
        formatter: formatador(c), hozAlign: c.tipo === 'numero' ? 'right' : 'left',
        sorter: c.tipo === 'numero' ? 'number' : 'string', headerTooltip: c.titulo,
        tooltip: c.tipo === 'longo' ? function(e, cell) { return ObrasStore.valorAtual(cell.getRow().getData().uid, c.campo) || ''; } : false,
        bottomCalc: c.campo === 'codigo' ? 'count' : undefined
      }, editorDe(c)));
    });
    grade = new Tabulator('#obrGrade', {
      data: ObrasStore.lista().map(function(r) { return Object.assign({}, r); }),
      index: 'uid', height: '100%', layout: 'fitDataFill', columns: cols,
      initialSort: [{ column: 'codigo', dir: 'asc' }], selectableRows: 1, editTriggerEvent: 'dblclick',
      movableColumns: true, placeholder: 'Nenhuma obra com os filtros atuais', columnDefaults: { headerHozAlign: 'left', resizable: true },
      rowFormatter: function(row) { row.getElement().classList.toggle('em-aprovacao', !!ObrasStore.propostaPendente(row.getData().uid)); }
    });
    grade.on('rowClick', function(e, row) {
      grade.deselectRow(); row.select();
      selecionar(row.getData().uid);
    });
    grade.on('cellEdited', function(cell) {
      var c = campo(cell.getField());
      var v = cell.getValue();
      if (c.tipo === 'numero') v = v === '' || v == null ? null : Number(String(v).replace(',', '.'));
      if (typeof v === 'string') v = v.trim();
      ObrasStore.definirPendente(cell.getRow().getData().uid, c.campo, v);
      cell.getRow().reformat();
    });
    grade.on('dataFiltered', function(f, linhas) { atualizarContador(linhas.length); });
  }

  function atualizarLinha(uid) {
    if (!grade) return;
    var r = ObrasStore.obter(uid), row = grade.getRow(uid);
    if (!r) { if (row) row.delete(); return; }
    if (row) { row.update(Object.assign({}, r)); row.reformat(); } else grade.addRow(Object.assign({}, r), true);
  }

  function recarregarGrade() {
    if (!grade) return;
    grade.replaceData(ObrasStore.lista().map(function(r) { return Object.assign({}, r); })).then(aplicarFiltros);
  }

  // ---------- Filtros ----------
  function preencherFiltros() {
    var l = ObrasStore.listas();
    (l.etapa || []).forEach(function(v) { $('obrFEtapa').add(new Option(v, v)); });
    (l.status || []).forEach(function(v) { $('obrFStatus').add(new Option(v, v)); });
  }
  function atende(r) {
    if (filtros.etapa && ObrasStore.valorAtual(r.uid, 'etapa') !== filtros.etapa) return false;
    if (filtros.status && ObrasStore.valorAtual(r.uid, 'status') !== filtros.status) return false;
    if (filtros.tracado && (filtros.tracado === 'com') !== temTracado(r)) return false;
    if (filtros.busca) {
      var alvo = semAcento(CAMPOS_OBRA.map(function(c) { return ObrasStore.valorAtual(r.uid, c.campo); }).join(' '));
      if (!semAcento(filtros.busca).split(/\s+/).every(function(t) { return alvo.indexOf(t) !== -1; })) return false;
    }
    return true;
  }
  function aplicarFiltros() {
    if (!grade) return;
    grade.setFilter(function(d) { return atende(ObrasStore.obter(d.uid) || d); });
    [['obrFEtapa', 'etapa'], ['obrFStatus', 'status'], ['obrFTracado', 'tracado']].forEach(function(p) { $(p[0]).classList.toggle('ativo', !!filtros[p[1]]); });
    atualizarContador(grade.getDataCount('active'));
  }
  function atualizarContador(n) { $('obrContador').textContent = n + ' de ' + ObrasStore.lista().length + ' obras'; }

  function atualizarPendentes() {
    var n = ObrasStore.totalPendentes();
    $('obrPendentes').hidden = !n;
    $('obrPendentes').textContent = n + (n === 1 ? ' alteração pendente' : ' alterações pendentes');
    $('obrDescartar').hidden = !n;
    $('obrRevisar').disabled = !n;
    $('obrRevisar').lastChild.textContent = ObrasStore.modoProposta() ? 'Revisar e enviar' : 'Revisar e salvar';
  }

  // ---------- Revisar e salvar ----------
  function abrirRevisao() {
    var itens = ObrasStore.resumoPendentes();
    if (!itens.length) return;
    var erros = 0, mudaSituacao = false;
    var html = itens.map(function(it) {
      if (it.mudaSituacao) mudaSituacao = true;
      return '<div class="rev-obra"><div class="rev-cab"><b>' + esc(it.codigo) + '</b> ' + esc(String(it.descricao || '').slice(0, 90)) + '</div>' +
        it.campos.map(function(c) {
          if (c.erro) erros++;
          var t = textoMudanca(c.campo, c.antes, c.depois);
          return '<div class="rev-campo' + (c.erro ? ' rev-erro' : '') + '"><span class="rev-rotulo">' + esc(t.titulo) + '</span>' +
            '<span class="de">' + esc(t.antes || '(vazio)') + '</span><span class="rev-seta">→</span>' +
            '<span class="para">' + esc(t.depois || '(vazio)') + '</span>' +
            (c.erro ? '<span class="rev-msg">' + esc(c.erro) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    }).join('');
    if (mudaSituacao) {
      html = '<div class="rev-data campo"><label for="obrDataFato">Data do fato (vai para a linha do tempo das obras que mudaram etapa ou status)</label>' +
        '<input type="date" id="obrDataFato" value="' + hojeIso() + '" max="' + hojeIso() + '"></div>' + html;
    }
    $('obrRevisaoCorpo').innerHTML = '<p class="rev-resumo">' + itens.length + (itens.length === 1 ? ' obra' : ' obras') + ' · ' +
      ObrasStore.totalPendentes() + ' campo(s) alterado(s)</p>' + html;
    var proposta = ObrasStore.modoProposta();
    $('obrRevisaoTitulo').textContent = proposta ? 'Conferir antes de enviar para aprovação' : 'Conferir antes de salvar';
    $('obrConfirmar').lastChild.textContent = proposta ? 'Enviar para aprovação' : 'Confirmar e salvar';
    $('obrRevisaoAviso').textContent = erros ? 'Corrija ' + erros + ' valor(es) em vermelho antes de ' + (proposta ? 'enviar.' : 'salvar.')
      : proposta ? 'As mudanças só valem depois que o editor pleno aprovar.' : '';
    $('obrConfirmar').disabled = erros > 0;
    $('obrDlgRevisao').showModal();
  }

  function confirmarSalvar() {
    var dataFato = $('obrDataFato') ? $('obrDataFato').value : null;
    if ($('obrDataFato') && (!dataFato || dataFato > hojeIso())) { $('obrRevisaoAviso').textContent = 'Informe uma data do fato válida (não pode ser futura).'; return; }
    $('obrConfirmar').disabled = true;
    $('obrRevisaoAviso').textContent = 'Salvando…';
    ObrasStore.salvar(dataFato).then(function(res) {
      $('obrDlgRevisao').close();
      if (res.gravadas.length) toast(res.proposta
        ? res.gravadas.length + (res.gravadas.length === 1 ? ' proposta enviada' : ' propostas enviadas') + ' para aprovação'
        : res.gravadas.length + (res.gravadas.length === 1 ? ' obra salva' : ' obras salvas') + ' no banco');
      res.recusadas.forEach(function(r) { toast(r.codigo + ': ' + r.motivo, true); });
      recarregarGrade();
      if (fichaUid) renderFicha();
      return res.proposta ? null : recarregarMapa();
    }).catch(function(e) { toast('Falha ao salvar: ' + e.message, true); })
      .then(function() { $('obrConfirmar').disabled = false; atualizarPendentes(); });
  }

  function recarregarMapa() {
    return typeof recarregarObrasDoMapa === 'function' ? recarregarObrasDoMapa().then(desenharHalo) : Promise.resolve();
  }

  // ---------- Selecao, mapa ----------
  function selecionar(uid) {
    selecionadoUid = uid;
    desenharHalo();
    if (fichaUid && fichaUid !== uid) abrirFicha(uid);
    if (modo === 'dividida') centralizar(fichaUid ? 250 : 0);
  }

  // Feicoes da obra: o ponto/traçado desenhado e as feicoes das camadas de base vinculadas.
  function feicoesDaObra(r) {
    var feicoes = [];
    var geom = ObrasStore.valorAtual(r.uid, 'geom');
    if (geom) feicoes.push({ type: 'Feature', properties: {}, geometry: geom });
    // Linha com desenho próprio: é ele o traçado (os vínculos SRE ficam só como referência).
    if (geom && r.tipo === 'Linha') return feicoes;
    var indices = typeof indicesBaseObrasMapa === 'function' ? indicesBaseObrasMapa() : null;
    (ObrasStore.valorAtual(r.uid, 'vinculos') || []).forEach(function(v) {
      var p = v.indexOf(':'), base = v.slice(0, p), geocod = v.slice(p + 1);
      var f = indices && indices[base] && indices[base][geocod];
      if (f && f.geometry) feicoes.push({ type: 'Feature', properties: {}, geometry: f.geometry });
    });
    return feicoes;
  }

  function limparHalo() { if (halo) { map.removeLayer(halo); halo = null; } }
  function desenharHalo() {
    limparHalo();
    var r = selecionadoUid && ObrasStore.obter(selecionadoUid);
    if (!r || modo === 'fechado') return;
    var feicoes = feicoesDaObra(r);
    if (!feicoes.length) return;
    halo = L.geoJSON({ type: 'FeatureCollection', features: feicoes }, {
      pane: 'obrasHaloPane', interactive: false,
      style: function(f) { return /Polygon/.test(f.geometry.type) ? { color: '#facc15', weight: 4, fillColor: '#facc15', fillOpacity: 0.25 } : { color: '#facc15', weight: 16, opacity: 0.6 }; },
      pointToLayer: function(f, ll) { return L.circleMarker(ll, { pane: 'obrasHaloPane', radius: 16, color: '#facc15', weight: 5, fillColor: '#fef9c3', fillOpacity: 0.5 }); }
    }).addTo(map);
  }

  function margensVisiveis() {
    var m = map.getContainer().getBoundingClientRect();
    var esquerda = modo === 'dividida' ? Math.max(0, $('obrTabela').getBoundingClientRect().right - m.left) : 0;
    var g = $('obrFicha');
    var direita = g.classList.contains('aberta') ? Math.max(0, m.right - (window.innerWidth - g.offsetWidth)) : 0;
    return [esquerda, direita];
  }
  var tempoCentralizar = null;
  function centralizar(atraso) {
    clearTimeout(tempoCentralizar);
    tempoCentralizar = setTimeout(function() {
      if (!halo || modo === 'cheia') return;
      map.invalidateSize();
      var b = halo.getBounds(), mg = margensVisiveis();
      if (b.isValid()) map.fitBounds(b, { paddingTopLeft: [mg[0] + 50, 50], paddingBottomRight: [mg[1] + 50, 50], maxZoom: 14 });
    }, atraso || 0);
  }

  function verNoMapa(uid) {
    var r = ObrasStore.obter(uid);
    if (!r || !temTracado(r)) { toast('Obra ' + (r ? r.codigo : '') + ' ainda não tem traçado'); return; }
    selecionadoUid = uid;
    var mudou = modo !== 'dividida';
    (mudou ? definirModo('dividida') : Promise.resolve()).then(function() {
      if (grade) grade.selectRow(uid);
      desenharHalo();
      centralizar(mudou ? 420 : 0);
    });
  }

  // ---------- Ficha ----------
  function abrirFicha(uid) {
    if (!ObrasStore.obter(uid)) return;
    if (uid !== fichaUid) ObrasTracado.encerrar();
    fichaUid = uid;
    selecionadoUid = uid;
    posicionar();
    if (grade) { grade.deselectRow(); grade.selectRow(uid); }
    desenharHalo();
    renderFicha();
    $('obrFicha').classList.add('aberta');
    $('obrFicha').setAttribute('aria-hidden', 'false');
  }
  function fecharFicha() {
    ObrasTracado.encerrar();
    fichaUid = null;
    $('obrFicha').classList.remove('aberta');
    $('obrFicha').setAttribute('aria-hidden', 'true');
  }

  function renderFicha() {
    var r = ObrasStore.obter(fichaUid);
    if (!r) { fecharFicha(); return; }
    var etapa = ObrasStore.valorAtual(r.uid, 'etapa');
    $('obrFichaSup').innerHTML = esc(r.codigo) + ' · ' + esc(r.origem) + ' · ' + esc(r.tipo) +
      (etapa ? ' <span class="badge" style="--c:' + (CORES_ETAPA_OBRA[etapa] || '#64748b') + '">' + esc(etapa) + '</span>' : '');
    $('obrFichaTitulo').textContent = ObrasStore.valorAtual(r.uid, 'intervencao') || ObrasStore.valorAtual(r.uid, 'descricao') || r.codigo;
    $('obrVerMapa').disabled = !temTracado(r);
    document.querySelectorAll('#obrFicha .gaveta-abas button').forEach(function(b) { b.classList.toggle('ativo', b.dataset.aba === abaFicha); });
    if (abaFicha !== 'tracado') ObrasTracado.encerrar();
    if (abaFicha === 'tracado') return ObrasTracado.render($('obrFichaCorpo'), r, apiTracado);
    if (abaFicha === 'tempo') return renderLinhaTempo(r);
    if (abaFicha === 'historico') return renderHistorico(r);
    var grupos = [];
    CAMPOS_OBRA.forEach(function(c) { if (grupos.indexOf(c.grupo) === -1) grupos.push(c.grupo); });
    var autor = ObrasStore.nomeUsuario(r.atualizado_por);
    $('obrFichaCorpo').innerHTML = avisoProposta(r) + '<div class="carimbo">Última alteração: ' + fmtDataHora(r.atualizado_em) + (autor ? ' · ' + esc(autor) : '') +
      (r.grupo_codigo ? ' · Grupo ' + esc(r.grupo_codigo) : '') + '</div>' +
      grupos.map(function(g) {
        return '<div class="form-grupo"><h4>' + g + '</h4><div class="form-grade">' +
          CAMPOS_OBRA.filter(function(c) { return c.grupo === g && c.campo !== 'grupo_codigo'; }).map(function(c) { return campoFicha(c, r); }).join('') + '</div></div>';
      }).join('');
  }

  function avisoProposta(r) {
    var p = ObrasStore.propostaPendente(r.uid);
    if (!p) return '';
    return '<div class="obr-aviso-proposta">◷ Proposta de <b>' + esc(ObrasStore.nomeUsuario(p.criado_por) || '—') + '</b> em ' + fmtDataHora(p.criado_em) +
      ' aguardando aprovação (' + Object.keys(p.mudancas).map(function(c) { return textoMudanca(c).titulo; }).join(', ') + ').' +
      ' <button type="button" class="link" data-abrir-aprovacoes>Ver</button></div>';
  }

  function campoFicha(c, r) {
    var v = ObrasStore.valorAtual(r.uid, c.campo);
    v = v == null ? '' : v;
    var largo = c.tipo === 'longo' ? ' largo' : '';
    var editado = ObrasStore.pendente(r.uid, c.campo) ? ' editado' : '';
    var bloqueio = ObrasStore.podeAlterar() && !c.somenteLeitura ? '' : ' disabled';
    var entrada;
    if (c.tipo === 'lista') {
      var opcoes = ObrasStore.listas()[c.campo] || [];
      if (v && opcoes.indexOf(v) === -1) opcoes = opcoes.concat([v]);
      entrada = '<select data-campo="' + c.campo + '"' + bloqueio + '><option value=""></option>' +
        opcoes.map(function(o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
    } else if (c.tipo === 'longo') {
      entrada = '<textarea data-campo="' + c.campo + '" rows="3"' + bloqueio + '>' + esc(v) + '</textarea>';
    } else {
      var tipoHtml = c.tipo === 'numero' ? ' type="number" step="any" min="0"' : c.tipo === 'data' ? ' type="date" max="' + hojeIso() + '"' : '';
      entrada = '<input data-campo="' + c.campo + '"' + tipoHtml + bloqueio + ' value="' + esc(v) + '">';
    }
    return '<div class="campo' + largo + editado + '" data-wrap="' + c.campo + '"><label><span class="marcador"></span>' + c.titulo + '</label>' + entrada + '</div>';
  }

  function aoEditarFicha(e) {
    var t = e.target;
    if (!fichaUid || !t.dataset.campo || !ObrasStore.podeAlterar()) return;
    var c = campo(t.dataset.campo);
    var v = t.value.trim();
    if (c.tipo === 'numero') v = v === '' ? null : Number(v);
    ObrasStore.definirPendente(fichaUid, c.campo, v);
    t.closest('.campo').classList.toggle('editado', ObrasStore.pendente(fichaUid, c.campo));
    atualizarLinha(fichaUid);
  }

  // O que a aba Traçado (js/obras/tracado.js) usa do painel.
  var apiTracado = {
    toast: toast,
    margens: function() { return margensVisiveis(); },
    // Selecionando no mapa: a tabela encolhe ao mínimo para sobrar mapa entre ela e a ficha; volta ao terminar.
    mostrarMapa: function() {
      return (modo === 'dividida' ? Promise.resolve() : definirModo('dividida')).then(function() {
        if (!ObrasTracado.ativo()) return;
        aplicarLargura(LARGURA_MIN);
        return new Promise(function(resolve) { setTimeout(function() { grade.redraw(); map.invalidateSize(); resolve(); }, 380); });
      });
    },
    aoEncerrar: function() {
      if (modo !== 'dividida') return;
      aplicarLargura(larguraSalva());
      setTimeout(function() { grade.redraw(); map.invalidateSize(); }, 380);
    },
    aoMudar: function() {
      if (!fichaUid) return;
      atualizarLinha(fichaUid);
      desenharHalo();
      $('obrVerMapa').disabled = !temTracado(ObrasStore.obter(fichaUid));
    }
  };

  function renderLinhaTempo(r) {
    var corpo = $('obrFichaCorpo');
    var html = '';
    if (ObrasStore.podeGravar()) {
      html += '<form class="form-tramite" id="obrFormNota"><h4>Registrar nota</h4><div class="form-grade">' +
        '<div class="campo"><label>Data</label><input type="date" name="data" required value="' + hojeIso() + '" max="' + hojeIso() + '"></div>' +
        '<div class="campo"><label>SEI (opcional)</label><input name="sei"></div>' +
        '<div class="campo largo"><label>Descrição</label><textarea name="descricao" rows="2" required></textarea></div></div>' +
        '<div class="form-tramite-acoes"><span class="dica-tramite">A nota entra na linha do tempo; os dados da obra não mudam.</span>' +
        '<button class="btn btn-primario" type="submit"><svg><use href="#o-check"/></svg>Registrar</button></div></form>' +
        '<form class="form-tramite" id="obrFormOrigem"><h4>Tramitar para outra origem</h4><div class="form-grade">' +
        '<div class="campo"><label>Nova origem</label><select name="origem" required id="obrSelOrigem"><option value="">Carregando…</option></select></div>' +
        '<div class="campo"><label>Data</label><input type="date" name="data" required value="' + hojeIso() + '" max="' + hojeIso() + '"></div>' +
        '<div class="campo largo"><label>Motivo</label><textarea name="descricao" rows="2" required></textarea></div></div>' +
        '<div class="form-tramite-acoes"><span class="dica-tramite">O código ' + esc(r.codigo) + ' não muda; a obra sai desta tabela e vai para a origem escolhida.</span>' +
        '<button class="btn" type="submit">Tramitar</button></div></form>';
    }
    html += '<div class="linha-tempo" id="obrLinhaTempo"><div class="vazio">Carregando…</div></div>';
    corpo.innerHTML = html;
    if ($('obrSelOrigem')) {
      ObrasStore.origensDisponiveis().then(function(lista) {
        $('obrSelOrigem').innerHTML = '<option value=""></option>' + lista.filter(function(o) { return o.codigo !== ORIGEM; })
          .map(function(o) { return '<option value="' + esc(o.codigo) + '">' + esc(o.codigo) + (o.nome !== o.codigo ? ' — ' + esc(o.nome) : '') + '</option>'; }).join('');
      });
      $('obrFormNota').addEventListener('submit', function(e) {
        e.preventDefault();
        var d = Object.fromEntries(new FormData(this));
        ObrasStore.anotar(r.uid, d.data, d.descricao.trim(), d.sei.trim()).then(function() { toast('Nota registrada'); renderFicha(); })
          .catch(function(err) { toast(err.message, true); });
      });
      $('obrFormOrigem').addEventListener('submit', function(e) {
        e.preventDefault();
        var d = Object.fromEntries(new FormData(this));
        if (!confirm('Tramitar ' + r.codigo + ' de ' + ORIGEM + ' para ' + d.origem + '?')) return;
        ObrasStore.tramitarOrigem([r.uid], d.origem, d.data, d.descricao.trim()).then(function() {
          toast(r.codigo + ' tramitada para ' + d.origem);
          fecharFicha(); limparHalo(); recarregarGrade(); return recarregarMapa();
        }).catch(function(err) { toast(err.message, true); });
      });
    }
    ObrasStore.tramitacoes(r.uid).then(function(itens) {
      if (fichaUid !== r.uid || abaFicha !== 'tempo') return;
      $('obrLinhaTempo').innerHTML = itens.length ? itens.map(function(t) {
        var titulo = EVENTOS[t.evento] || t.evento;
        var detalhe = t.evento === 'origem' ? esc(t.origem_anterior) + ' → ' + esc(t.origem)
          : [t.etapa ? '<span class="badge" style="--c:' + (CORES_ETAPA_OBRA[t.etapa] || '#64748b') + '">' + esc(t.etapa) + '</span>' : '', esc(t.status || '')].join(' ');
        return '<div class="tramite"><div class="tramite-data">' + fmtData(t.data_fato) + '</div><div class="tramite-corpo">' +
          '<b>' + esc(titulo) + '</b><div>' + detalhe + '</div>' +
          (t.descricao ? '<div class="tramite-desc">' + esc(t.descricao) + '</div>' : '') +
          (t.sei ? '<div class="tramite-sei">SEI ' + esc(t.sei) + '</div>' : '') +
          '<div class="tramite-autor">Lançado em ' + fmtDataHora(t.criado_em) + (ObrasStore.nomeUsuario(t.criado_por) ? ' por ' + esc(ObrasStore.nomeUsuario(t.criado_por)) : '') + '</div>' +
          '</div></div>';
      }).join('') : '<div class="vazio">Nenhum registro na linha do tempo.</div>';
    }).catch(function(e) { $('obrLinhaTempo').innerHTML = '<div class="vazio">Erro: ' + esc(e.message) + '</div>'; });
  }

  function renderHistorico(r) {
    var corpo = $('obrFichaCorpo');
    corpo.innerHTML = '<div class="vazio">Carregando histórico…</div>';
    ObrasStore.historico(r.uid).then(function(itens) {
      if (fichaUid !== r.uid || abaFicha !== 'historico') return;
      if (!itens.length) { corpo.innerHTML = '<div class="vazio">Nenhuma alteração registrada.</div>'; return; }
      var admin = !!(Acesso.perfil() && Acesso.perfil().admin);
      corpo.innerHTML = itens.map(function(h, i) {
        var detalhe = h.acao === 'editado' || h.acao === 'tracado' ? (h.campos || []).filter(function(c) { return campo(c) || CAMPOS_TRACADO[c]; }).map(function(c) {
          var t = textoMudanca(c, h.antes && h.antes[c], h.depois && h.depois[c]);
          return '<div class="mudanca"><b>' + esc(t.titulo) + '</b><div class="de">' + esc(t.antes || '(vazio)') + '</div>' +
            '<div class="para">' + esc(t.depois || '(vazio)') + '</div></div>';
        }).join('') : '';
        var restaurar = admin && i > 0 && h.depois && h.acao !== 'excluido'
          ? ' · <button type="button" class="link" data-restaurar="' + h.hid + '">voltar a esta versão</button>' : '';
        return '<div class="historico-item"><div class="quando">' + fmtDataHora(h.quando) + ' · <b>' + esc(h.usuario_nome || '—') + '</b> · ' +
          esc(ACOES[h.acao] || h.acao) + (h.proposto_por_nome ? ' · proposta de <b>' + esc(h.proposto_por_nome) + '</b>' : '') + restaurar + '</div>' + detalhe + '</div>';
      }).join('');
    }).catch(function(e) { corpo.innerHTML = '<div class="vazio">Erro: ' + esc(e.message) + '</div>'; });
  }

  // ---------- Nova obra ----------
  function abrirNova() {
    var l = ObrasStore.listas();
    function opcoes(lista) { return '<option value=""></option>' + (lista || []).map(function(v) { return '<option>' + esc(v) + '</option>'; }).join(''); }
    $('obrNovaCorpo').innerHTML = '<div class="form-grade">' +
      '<div class="campo"><label>Tipo de traçado</label><select name="tipo" required><option>Linha</option><option>Ponto</option><option>Área</option></select></div>' +
      '<div class="campo"><label>Intervenção</label><select name="intervencao">' + opcoes(l.intervencao) + '</select></div>' +
      '<div class="campo largo"><label>Descrição</label><textarea name="descricao" rows="3" required></textarea></div>' +
      '<div class="campo"><label>Etapa</label><select name="etapa">' + opcoes(l.etapa) + '</select></div>' +
      '<div class="campo"><label>Status</label><select name="status">' + opcoes(l.status) + '</select></div>' +
      '<div class="campo"><label>Data de referência</label><input type="date" name="data_referencia" value="' + hojeIso() + '" max="' + hojeIso() + '" required></div>' +
      '<div class="campo"><label>SEI</label><input name="sei" placeholder="15 dígitos"></div>' +
      '</div><p class="nota">' + (ObrasStore.modoProposta()
        ? 'A obra entra como proposta: o código e o cadastro saem quando o editor pleno aprovar. O traçado é proposto depois, na ficha.'
        : 'O código (OB' + String(new Date().getFullYear()).slice(2) + '-…) é gerado pelo banco. Depois de cadastrar, a ficha abre na aba Traçado.') + '</p>';
    $('obrNovaAviso').textContent = '';
    $('obrDlgNova').showModal();
  }
  function cadastrarNova(e) {
    e.preventDefault();
    var d = Object.fromEntries(new FormData($('obrFormNova')));
    Object.keys(d).forEach(function(k) { d[k] = String(d[k]).trim(); if (d[k] === '') d[k] = null; });
    var erro = ['sei', 'data_referencia', 'intervencao', 'etapa', 'status'].map(function(k) { var m = validarCampoObra(k, d[k], ObrasStore.listas()); return m ? campo(k).titulo + ': ' + m : ''; }).filter(Boolean)[0];
    if (erro) { $('obrNovaAviso').textContent = erro; return; }
    ObrasStore.criar(d).then(function(r) {
      $('obrDlgNova').close();
      if (r.proposta) { toast('Obra nova enviada para aprovação (o código sai quando o editor pleno aprovar)'); atualizarAprovacoes(); return; }
      toast('Obra ' + r.codigo + ' cadastrada');
      atualizarLinha(r.uid);
      abaFicha = 'tracado';   // obra nova: o próximo passo é definir o traçado
      abrirFicha(r.uid);
      return recarregarMapa();
    }).catch(function(err) { $('obrNovaAviso').textContent = err.message; });
  }

  // ---------- Aprovações ----------
  var SITUACAO = { pendente: 'Aguardando', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' };
  function eu() { var p = Acesso.perfil(); return p && p.user_id; }

  function atualizarAprovacoes() {
    var b = $('obrAprovacoes');
    if (!b || !ObrasStore.podeAlterar()) return;
    var pleno = ObrasStore.podeGravar();
    var pend = ObrasStore.propostas().filter(function(p) { return p.situacao === 'pendente' && (pleno || p.criado_por === eu()); }).length;
    b.innerHTML = (pleno ? 'Aprovações' : 'Minhas propostas') + (pend ? ' <span class="obr-contagem">' + pend + '</span>' : '');
    b.classList.toggle('tem-pendente', pleno && pend > 0);
    var menu = $('obrAbrirTabela');
    if (menu) menu.textContent = 'Abrir tabela de obras' + (pleno && pend ? ' · ' + pend + ' para aprovar' : '');
  }

  function abrirAprovacoes() {
    renderAprovacoes();
    if (!$('obrDlgAprov').open) $('obrDlgAprov').showModal();
  }

  function cartaoProposta(p) {
    var pleno = ObrasStore.podeGravar(), r = p.obra_uid ? ObrasStore.obter(p.obra_uid) : null;
    var titulo = p.tipo === 'nova' ? (p.situacao === 'aprovada' && r ? esc(r.codigo) + ' · obra nova' : 'Obra nova') : esc(r ? r.codigo : '(obra fora desta origem)');
    var conflito = p.situacao === 'pendente' && p.tipo === 'edicao' && r && r.versao !== p.versao_base;
    // Antes -> depois so enquanto pendente (depois de decidida, o "antes" atual ja nao e o da epoca).
    var comAntes = p.tipo === 'edicao' && p.situacao === 'pendente' && r;
    var campos = Object.keys(p.mudancas).map(function(c) {
      var geom = c === 'geom' && typeof p.mudancas[c] === 'string' ? ewktParaGeojson(p.mudancas[c]) : p.mudancas[c];
      var t = textoMudanca(c, comAntes ? r[c] : null, geom);
      return '<div class="rev-campo"><span class="rev-rotulo">' + esc(t.titulo) + '</span>' +
        (!comAntes ? '<span></span><span></span>' : '<span class="de">' + esc(t.antes || '(vazio)') + '</span><span class="rev-seta">→</span>') +
        '<span class="para">' + esc(t.depois || '(vazio)') + '</span></div>';
    }).join('');
    var acoes = '';
    if (p.situacao === 'pendente') {
      if (pleno) acoes = '<button type="button" class="btn btn-fantasma" data-recusar="' + p.pid + '">Recusar</button>' +
        '<button type="button" class="btn btn-primario" data-aprovar="' + p.pid + '"><svg><use href="#o-check"/></svg>Aprovar</button>';
      else if (p.criado_por === eu()) acoes = '<button type="button" class="btn btn-fantasma" data-cancelar="' + p.pid + '">Cancelar proposta</button>';
    }
    if (r) acoes = '<button type="button" class="link" data-abrir-obra="' + r.uid + '">abrir a obra</button>' + acoes;
    var decisao = p.situacao === 'pendente' ? '' : '<div class="aprov-decisao aprov-' + p.situacao + '">' + SITUACAO[p.situacao] +
      (p.decidido_por && p.decidido_por !== p.criado_por ? ' por ' + esc(ObrasStore.nomeUsuario(p.decidido_por)) : '') + ' em ' + fmtDataHora(p.decidido_em) +
      (p.motivo ? ' · motivo: ' + esc(p.motivo) : '') + '</div>';
    return '<div class="rev-obra aprov-' + p.situacao + '" data-pid="' + p.pid + '"><div class="rev-cab"><b>' + titulo + '</b> ' +
      esc(String((r && r.descricao) || p.mudancas.descricao || '').slice(0, 90)) + '</div>' +
      '<div class="aprov-autor">Proposta de <b>' + esc(ObrasStore.nomeUsuario(p.criado_por) || '—') + '</b> em ' + fmtDataHora(p.criado_em) + '</div>' +
      (conflito ? '<div class="aprov-conflito">A obra foi alterada depois desta proposta (versão ' + p.versao_base + ' → ' + r.versao + '). Confira os valores atuais antes de aprovar.</div>' : '') +
      campos + decisao +
      '<div class="aprov-recusa" hidden><textarea rows="2" placeholder="Motivo da recusa (o autor vai ver)"></textarea>' +
        '<button type="button" class="btn btn-perigo-fantasma" data-confirmar-recusa="' + p.pid + '">Confirmar recusa</button></div>' +
      (acoes ? '<div class="aprov-acoes">' + acoes + '</div>' : '') + '</div>';
  }

  function renderAprovacoes() {
    var pleno = ObrasStore.podeGravar();
    var todas = ObrasStore.propostas().filter(function(p) { return pleno || p.criado_por === eu(); });
    var pend = todas.filter(function(p) { return p.situacao === 'pendente'; }), dec = todas.filter(function(p) { return p.situacao !== 'pendente'; });
    $('obrAprovTitulo').textContent = (pleno ? 'Aprovações · ' : 'Minhas propostas · ') + ORIGEM;
    $('obrAprovCorpo').innerHTML =
      '<h4 class="aprov-secao">Aguardando decisão (' + pend.length + ')</h4>' +
      (pend.length ? pend.map(cartaoProposta).join('') : '<div class="vazio">' + (pleno ? 'Nenhuma proposta para aprovar.' : 'Nenhuma proposta sua aguardando.') + '</div>') +
      (dec.length ? '<h4 class="aprov-secao">Decididas nos últimos 30 dias</h4>' + dec.map(cartaoProposta).join('') : '');
  }

  function ewktParaGeojson(t) {
    var m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(t);
    return m ? { type: 'Point', coordinates: [Number(m[1]), Number(m[2])] } : null;
  }

  function aprovar(pid, forcar) {
    ObrasStore.aprovar(pid, forcar).then(function(r) {
      toast('Proposta aprovada' + (r ? ': ' + r.codigo : ''));
      if (r) atualizarLinha(r.uid);
      renderAprovacoes();
      if (fichaUid) renderFicha();
      return recarregarMapa();
    }).catch(function(e) {
      if (/CONFLITO/.test(e.message) && confirm(e.message.replace('CONFLITO: ', '') + '.\n\nAprovar mesmo assim? Os campos da proposta sobrescrevem os valores atuais.')) return aprovar(pid, true);
      toast(e.message, true);
      return ObrasStore.carregarPropostas().then(renderAprovacoes);
    });
  }

  function aoClicarAprovacoes(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.aprovar) return aprovar(Number(b.dataset.aprovar));
    if (b.dataset.recusar) { var caixa = b.closest('.rev-obra').querySelector('.aprov-recusa'); caixa.hidden = false; caixa.querySelector('textarea').focus(); return; }
    if (b.dataset.confirmarRecusa) {
      var motivo = b.closest('.aprov-recusa').querySelector('textarea').value.trim();
      if (!motivo) { toast('Escreva o motivo da recusa', true); return; }
      return ObrasStore.recusar(Number(b.dataset.confirmarRecusa), motivo).then(function() { toast('Proposta recusada'); renderAprovacoes(); recarregarGrade(); if (fichaUid) renderFicha(); })
        .catch(function(err) { toast(err.message, true); });
    }
    if (b.dataset.cancelar) {
      if (!confirm('Cancelar esta proposta?')) return;
      return ObrasStore.cancelar(Number(b.dataset.cancelar)).then(function() { toast('Proposta cancelada'); renderAprovacoes(); recarregarGrade(); if (fichaUid) renderFicha(); })
        .catch(function(err) { toast(err.message, true); });
    }
    if (b.dataset.abrirObra) { $('obrDlgAprov').close(); abaFicha = 'dados'; abrirFicha(b.dataset.abrirObra); }
  }

  // ---------- Exportar ----------
  function exportar() {
    if (!Acesso.podeExportar(ORIGEM)) return;   // visualizador nao exporta
    (window.XLSX ? Promise.resolve() : carregarScript(LIBS.xlsx)).then(function() {
      var visiveis = CAMPOS_OBRA.filter(function(c) { var col = grade.getColumn(c.campo); return col && col.isVisible(); });
      var linhas = grade.getData('active').map(function(d) {
        var o = {}; visiveis.forEach(function(c) { var v = ObrasStore.valorAtual(d.uid, c.campo); o[c.titulo] = v == null ? '' : v; }); return o;
      });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), ORIGEM);
      XLSX.writeFile(wb, new Date().toISOString().slice(0, 10).replace(/-/g, '_') + '_Obras_' + ORIGEM + '.xlsx');
      Acesso.registrarEvento('exportou', 'Excel de obras ' + ORIGEM + ' (' + linhas.length + ')');
    }).catch(function(e) { toast(e.message, true); });
  }

  // ---------- Eventos ----------
  function ligarEventos() {
    document.querySelectorAll('[data-obr-modo]').forEach(function(b) { b.addEventListener('click', function() { definirModo(b.dataset.obrModo); }); });
    $('obrFechar').addEventListener('click', function() {
      if (ObrasStore.totalPendentes() && !confirm('Há alterações pendentes não salvas. Fechar a tabela mesmo assim? (elas continuam pendentes até você salvar ou descartar)')) return;
      definirModo('fechado');
    });
    var t = null;
    $('obrBusca').addEventListener('input', function() { clearTimeout(t); var v = this.value; t = setTimeout(function() { filtros.busca = v.trim(); aplicarFiltros(); }, 150); });
    [['obrFEtapa', 'etapa'], ['obrFStatus', 'status'], ['obrFTracado', 'tracado']].forEach(function(p) {
      $(p[0]).addEventListener('change', function() { filtros[p[1]] = this.value; aplicarFiltros(); });
    });
    $('obrLimpar').addEventListener('click', function() {
      filtros = { busca: '', etapa: '', status: '', tracado: '' };
      ['obrBusca', 'obrFEtapa', 'obrFStatus', 'obrFTracado'].forEach(function(id) { $(id).value = ''; });
      aplicarFiltros();
    });
    $('obrRevisar').addEventListener('click', abrirRevisao);
    $('obrConfirmar').addEventListener('click', confirmarSalvar);
    $('obrDescartar').addEventListener('click', function() {
      if (!confirm('Descartar ' + ObrasStore.totalPendentes() + ' alteração(ões) pendente(s)?')) return;
      ObrasStore.descartar(); recarregarGrade(); if (fichaUid) renderFicha();
    });
    $('obrExportar').addEventListener('click', exportar);
    $('obrOrigem').addEventListener('change', function() { trocarOrigem(this.value); });
    $('obrOrigem').addEventListener('mousedown', preencherSeletorOrigem);   // ligou/desligou origens por outro caminho
    $('obrAprovacoes').addEventListener('click', abrirAprovacoes);
    $('obrAprovCorpo').addEventListener('click', aoClicarAprovacoes);
    $('obrNova').addEventListener('click', abrirNova);
    $('obrFormNova').addEventListener('submit', cadastrarNova);
    $('obrColunas').addEventListener('click', function() {
      $('obrColunasCorpo').innerHTML = CAMPOS_OBRA.filter(function(c) { return !c.fixa; }).map(function(c) {
        return '<label class="chk"><input type="checkbox" data-coluna="' + c.campo + '"' + (grade.getColumn(c.campo).isVisible() ? ' checked' : '') + '> ' + c.titulo + '</label>';
      }).join('') + '<p class="nota"><button type="button" class="link" id="obrColunasPadrao">Voltar às colunas desta origem</button></p>';
      $('obrDlgColunas').showModal();
    });
    $('obrColunasCorpo').addEventListener('change', function(e) {
      var c = e.target.dataset.coluna; if (!c) return;
      var col = grade.getColumn(c); e.target.checked ? col.show() : col.hide();
      var visiveis = CAMPOS_OBRA.filter(function(x) { return grade.getColumn(x.campo).isVisible(); }).map(function(x) { return x.campo; });
      try { localStorage.setItem(chaveColunas(), JSON.stringify(visiveis)); } catch (x) { /* sem storage */ }
    });
    $('obrColunasCorpo').addEventListener('click', function(e) {
      if (e.target.id !== 'obrColunasPadrao') return;
      try { localStorage.removeItem(chaveColunas()); } catch (x) { /* sem storage */ }
      var padrao = colunasVisiveisPadrao();
      CAMPOS_OBRA.forEach(function(c) { var col = grade.getColumn(c.campo); padrao.indexOf(c.campo) !== -1 ? col.show() : col.hide(); });
      $('obrDlgColunas').close();
    });
    document.querySelectorAll('[data-obr-fechar]').forEach(function(b) { b.addEventListener('click', function() { b.closest('dialog').close(); }); });
    $('obrFecharFicha').addEventListener('click', fecharFicha);
    document.querySelectorAll('#obrFicha .gaveta-abas button').forEach(function(b) { b.addEventListener('click', function() { abaFicha = b.dataset.aba; renderFicha(); }); });
    $('obrFichaCorpo').addEventListener('change', aoEditarFicha);
    $('obrFichaCorpo').addEventListener('click', function(e) {
      if (e.target.closest('[data-abrir-aprovacoes]')) { abrirAprovacoes(); return; }
      var b = e.target.closest('[data-restaurar]');
      if (!b || !confirm('Voltar a obra para como estava nesta versão? (a restauração também fica no histórico)')) return;
      ObrasStore.restaurarVersao(fichaUid, Number(b.dataset.restaurar)).then(function() {
        toast('Versão restaurada'); atualizarLinha(fichaUid); renderFicha(); return recarregarMapa();
      }).catch(function(err) { toast(err.message, true); });
    });
    $('obrVerMapa').addEventListener('click', function() { verNoMapa(fichaUid); });
    $('obrExcluir').addEventListener('click', function() {
      var r = ObrasStore.obter(fichaUid);
      if (!r || !confirm('Excluir a obra ' + r.codigo + '? Ela sai do mapa e da tabela; o administrador pode restaurá-la pelo histórico.')) return;
      ObrasStore.excluir(r.uid).then(function() {
        toast('Obra ' + r.codigo + ' excluída'); fecharFicha(); limparHalo(); atualizarLinha(r.uid); return recarregarMapa();
      }).catch(function(err) { toast(err.message, true); });
    });
    // Alca de largura (modo dividido)
    var alca = $('obrRedimensionar'), painel = $('obrTabela');
    alca.addEventListener('pointerdown', function(e) {
      e.preventDefault(); alca.setPointerCapture(e.pointerId); painel.classList.add('arrastando');
      function mover(ev) { aplicarLargura(Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, ev.clientX / window.innerWidth * 100)).toFixed(1)); }
      function soltar() {
        alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', soltar); painel.classList.remove('arrastando');
        try { localStorage.setItem(CHAVE_LARGURA, (painel.getBoundingClientRect().width / window.innerWidth * 100).toFixed(1)); } catch (x) { /* sem storage */ }
        grade.redraw(); centralizar(50);
      }
      alca.addEventListener('pointermove', mover); alca.addEventListener('pointerup', soltar);
    });
    ObrasStore.ouvir(function(evento) {
      if (evento === 'pendentes' || evento === 'salvo') atualizarPendentes();
      if (evento === 'propostas') { atualizarAprovacoes(); if (grade) grade.getRows().forEach(function(r) { r.reformat(); }); }
      // Linha do tempo: data passada = só leitura, só as obras que existiam, etapa/status daquela data.
      if (evento === 'visao') {
        ObrasTracado.encerrar();
        $('obrUi').classList.toggle('somente-leitura', !ObrasStore.podeAlterar());
        $('obrUi').classList.toggle('sem-pleno', !ObrasStore.podeGravar());
        recarregarGrade();
        if (fichaUid) { if (ObrasStore.lista().some(function(r) { return r.uid === fichaUid; })) renderFicha(); else fecharFicha(); }
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]') || document.querySelector('.tabulator-editing')) return;
      if (ObrasTracado.ativo()) ObrasTracado.encerrar(); else fecharFicha();
    });
    window.addEventListener('resize', posicionar);
    window.addEventListener('beforeunload', function(e) { if (ObrasStore.totalPendentes()) { e.preventDefault(); e.returnValue = ''; } });
  }

  // So para quem pode ver a origem; quem so ve, consulta (os botoes de edicao somem).
  Acesso.pronto.then(function() {
    if (!Acesso.podeVer(ORIGEM)) return;
    montar();
    preencherSeletorOrigem();
    contarAprovacoes();
    var t = new URLSearchParams(location.search).get('tabela');
    if (t) definirModo(t === 'dividida' ? 'dividida' : 'cheia');
  });

  return { definirModo: definirModo, abrirFicha: abrirFicha, trocarOrigem: trocarOrigem, origensMudaram: origensMudaram,
    origem: function() { return ORIGEM; } };
})();
