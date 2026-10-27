// Editor de camadas no mapa (mapa.html): botão "Editar camadas" para quem pode editar alguma camada
// (Acesso.perfil().camadas, vindo de siplaweb.meu_acesso). Quem pode: administrador; perfil que edita camadas, com a camada liberada
// pelo administrador (painel.html > Configurações); e, na malha complementar, quem edita camadas na Jurisdição.
// Camadas: extra_base (malha complementar), geo_lin_base (linhas genéricas), geo_pt_base (pontos genéricos) e
// geo_pol_base (áreas de estudo). As bases principais (SRE, municípios...) não entram.
// Criar: desenhar (Geoman, carregado só aqui) ou importar GeoJSON; editar dados e vértices; excluir. Cada alteração e
// exclusão deixa uma cópia arquivada no banco (só administradores veem). Banco: supabase/014_camadas_editaveis.sql.
// Aprovação (016_camadas_aprovacao.sql): quem não grava direto (o editor pleno) salva o desenho em
// siplaweb.camadas_propostas e a camada oficial só muda quando alguém que aprova o perfil dele decidir; até lá o
// desenho aparece TRACEJADO para quem edita camadas. Quem aprova abre mapa.html?proposta_camada=<n> (vem do Painel).

var CamadasEdicao = (function() {
  var GEOMAN = {
    css: 'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css',
    js: 'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.js'
  };
  // Campos do formulário por camada (a extra_base tem rodovia e trecho; as genéricas, nome e descrição).
  var CAMPOS = {
    extra_base: [['rodovia', 'Rodovia', 'Ex.: VICINAL, GO-020'], ['trecho', 'Descrição do trecho', 'Ex.: Entr. GO-020 – Povoado X']],
    padrao: [['NOME', 'Nome', 'Ex.: Contorno de Anápolis (estudo)'], ['DESCRICAO', 'Descrição (opcional)', 'Processo SEI, finalidade, observações']]
  };
  var DESENHO = { 'Ponto': 'Marker', 'Linha': 'Line', 'Área': 'Polygon' };
  var COR = '#7c3aed', COR_PENDENTE = '#ea580c';
  var NOMES = { extra_base: 'Malha complementar', geo_lin_base: 'Linhas genéricas', geo_pt_base: 'Pontos genéricos', geo_pol_base: 'Áreas de estudo' };
  var ACAO = { criar: 'nova feição', alterar: 'alteração', excluir: 'exclusão' };

  var camadas = [], atual = null;          // atual = { codigo, nome, geometria }
  var visao = null, destaque = null;       // camada no mapa enquanto o painel está aberto
  var form = null;                         // { geocod|null, grupo (featureGroup das partes), editando }
  var geomanPronto = null, busca = '';
  var pendentes = [], visaoPendentes = null;   // propostas pendentes da camada aberta (desenho tracejado)

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function num(n, c) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: c == null ? 2 : c }); }
  function toast(msg, erro) {
    var t = document.createElement('div');
    t.className = 'ce-toast' + (erro ? ' erro' : '');
    t.textContent = msg;
    map.getContainer().appendChild(t);
    setTimeout(function() { t.remove(); }, erro ? 7000 : 3500);
  }
  function rpc(nome, args) {
    return Acesso.cliente.rpc(nome, args).then(function(res) { if (res.error) throw new Error(res.error.message); return res.data; });
  }
  function feicoes() { var fc = camadaBaseMapa(atual.codigo); return (fc && fc.features) || []; }
  // Grava direto (sem aprovação): administrador ou perfil com "gravar" numa área em que edita camadas.
  function gravaDireto() {
    var p = Acesso.perfil();
    return p.admin || Object.keys(p.areas).some(function(a) { return Acesso.podeCamadas(a) && Acesso.podeEditar(a); });
  }
  function eu() { return Acesso.perfil().user_id; }
  function quando(v) { return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  function carregarPendentes() {
    if (!atual) return Promise.resolve();
    var codigo = atual.codigo;
    return Acesso.cliente.from('camadas_propostas').select('pid,acao,geocod,dados,geojson,criado_por,criado_em,area,perfil_autor')
      .eq('camada', codigo).eq('situacao', 'pendente').order('pid').then(function(res) {
        if (res.error) throw new Error(res.error.message);
        if (atual && atual.codigo === codigo) pendentes = res.data;
      });
  }
  function pendenteDe(geocod) { return pendentes.find(function(p) { return p.geocod === geocod; }) || null; }
  function campos() { return CAMPOS[atual.codigo] || CAMPOS.padrao; }
  function rotulo(p) { return atual.codigo === 'extra_base' ? (p.rodovia || '') + ' · ' + (p.trecho || '') : p.NOME || ''; }
  function medida(p) {
    if (p.EXT_KM != null) return num(p.EXT_KM) + ' km';
    if (p.AREA_KM2 != null) return num(p.AREA_KM2, 3) + ' km²';
    return '';
  }

  // Mesmo esquema do traçado da jurisdição (js/jurisdicao/tracado.js): opt-in, só as camadas da edição
  // (pmIgnore:false) entram no Geoman. Se o outro módulo já carregou, só liga ao mapa.
  function ligarGeoman() {
    L.PM.setOptIn(true);
    if (!map.pm) map.pm = new L.PM.Map(map);
    map.pm.setLang('pt_br');
  }
  // Durante a edição o desenho fica num pane próprio e o resto do mapa não recebe clique (css/camadas_edicao.css):
  // as faixas de clique das rodovias e os ícones das obras engoliam o clique e o vértice não nascia.
  var PANES_GEOMAN = { vertexPane: 'markerPane', layerPane: 'overlayPane', markerPane: 'markerPane' };
  function modoDesenho(sim) {
    if (!map.getPane('ceEdicaoPane')) map.createPane('ceEdicaoPane').style.zIndex = 660;
    map.getContainer().classList.toggle('ce-desenhando', sim);
    map.pm.setGlobalOptions({ panes: sim ? { vertexPane: 'ceEdicaoPane', layerPane: 'ceEdicaoPane', markerPane: 'ceEdicaoPane' } : PANES_GEOMAN });
  }
  function carregarGeoman() {
    if (L.PM) { ligarGeoman(); return Promise.resolve(); }
    if (!geomanPronto) {
      geomanPronto = new Promise(function(ok, falha) {
        var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = GEOMAN.css; document.head.appendChild(css);
        var s = document.createElement('script'); s.src = GEOMAN.js; s.onload = function() { ligarGeoman(); ok(); };
        s.onerror = function() { geomanPronto = null; falha(new Error('Não foi possível carregar o desenhista (Geoman). Verifique a internet.')); };
        document.head.appendChild(s);
      });
    }
    return geomanPronto;
  }

  // ---------- Interface ----------
  function montar() {
    var caixa = document.createElement('div');
    caixa.className = 'ce';
    caixa.innerHTML =
      '<button type="button" class="ce-abrir" id="ceAbrir" title="Criar, alterar e excluir feições das camadas liberadas para você">' +
        '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>Editar camadas</button>' +
      '<section class="ce-painel" id="cePainel" hidden>' +
        '<div class="ce-topo"><b>Editar camadas</b><button type="button" class="ce-fechar" id="ceFechar" title="Fechar">×</button></div>' +
        '<select id="ceCamada" class="ce-select"></select>' +
        '<div id="ceCorpo" class="ce-corpo"></div>' +
      '</section>';
    map.getContainer().appendChild(caixa);
    L.DomEvent.disableClickPropagation(caixa);
    L.DomEvent.disableScrollPropagation(caixa);
    $('ceCamada').innerHTML = camadas.map(function(c) { return '<option value="' + esc(c.codigo) + '">' + esc(c.nome) + '</option>'; }).join('');
    $('ceAbrir').addEventListener('click', function() { abrir(true); });
    $('ceFechar').addEventListener('click', function() {
      if (form && !confirm('Descartar a feição que está sendo editada?')) return;
      abrir(false);
    });
    $('ceCamada').addEventListener('change', function() {
      if (form && !confirm('Descartar a feição que está sendo editada?')) { this.value = atual.codigo; return; }
      encerrarForm();
      escolher(this.value);
    });
    $('ceCorpo').addEventListener('click', aoClicar);
    $('ceCorpo').addEventListener('input', function(e) { if (e.target.id === 'ceBusca') { busca = e.target.value; renderLista(); } });
    $('ceCorpo').addEventListener('change', function(e) { if (e.target.id === 'ceArquivo') importar(e.target.files[0]); });
  }

  function abrir(sim) {
    $('cePainel').hidden = !sim;
    $('ceAbrir').hidden = sim;
    if (sim) escolher($('ceCamada').value);
    else { encerrarForm(); limparVisao(); }
  }

  function escolher(codigo) {
    atual = camadas.find(function(c) { return c.codigo === codigo; });
    busca = '';
    pendentes = [];
    desenharVisao();
    renderLista();
    carregarPendentes().then(function() { if (!form && atual && atual.codigo === codigo) { desenharVisao(); renderLista(); } })
      .catch(function(e) { toast('Pendentes: ' + e.message, true); });
  }

  // Camada inteira no mapa enquanto o painel está aberto; clicar numa feição abre a edição.
  function desenharVisao() {
    limparVisao();
    visao = L.geoJSON({ type: 'FeatureCollection', features: feicoes() }, {
      style: function() { return { color: COR, weight: 4, opacity: 0.85, fillColor: COR, fillOpacity: 0.15 }; },
      pointToLayer: function(f, ll) { return L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: COR, fillOpacity: 1 }); },
      onEachFeature: function(f, l) {
        var p = f.properties;
        l.bindTooltip('<b>' + esc(p.GEOCOD) + '</b> ' + esc(rotulo(p)), { sticky: true, direction: 'top' });
        l.on('click', function(e) { if (form) return; L.DomEvent.stopPropagation(e); abrirForm(p.GEOCOD); });
      }
    }).addTo(map);
    // Propostas pendentes: tracejado laranja por cima (exclusão = a feição atual tracejada em vermelho).
    var fs = pendentes.map(function(p) {
      var atualF = p.geocod ? feicoes().find(function(f) { return f.properties.GEOCOD === p.geocod; }) : null;
      var g = p.acao === 'excluir' ? atualF && atualF.geometry : p.geojson;
      return g ? { type: 'Feature', geometry: g, properties: { pid: p.pid, acao: p.acao, geocod: p.geocod, rotulo: rotulo(p.acao === 'excluir' && atualF ? atualF.properties : p.dados) } } : null;
    }).filter(Boolean);
    if (fs.length) visaoPendentes = L.geoJSON({ type: 'FeatureCollection', features: fs }, {
      style: function(f) { var cor = f.properties.acao === 'excluir' ? '#dc2626' : COR_PENDENTE; return { color: cor, weight: 4, dashArray: '8 6', opacity: 0.95, fillColor: cor, fillOpacity: 0.1 }; },
      pointToLayer: function(f, ll) { return L.circleMarker(ll, { radius: 8, color: f.properties.acao === 'excluir' ? '#dc2626' : COR_PENDENTE, weight: 3, dashArray: '3 3', fillOpacity: 0.15 }); },
      onEachFeature: function(f, l) {
        l.bindTooltip('◷ ' + esc(ACAO[f.properties.acao]) + ' aguardando aprovação' + (f.properties.geocod ? ' · <b>' + esc(f.properties.geocod) + '</b>' : '') + ' ' + esc(f.properties.rotulo), { sticky: true, direction: 'top' });
      }
    }).addTo(map);
  }
  function limparVisao() {
    if (visao) { map.removeLayer(visao); visao = null; }
    if (visaoPendentes) { map.removeLayer(visaoPendentes); visaoPendentes = null; }
    if (destaque) { map.removeLayer(destaque); destaque = null; }
  }

  function renderLista() {
    var termo = semAcento(busca);
    var lista = feicoes().filter(function(f) { var p = f.properties; return !termo || semAcento(p.GEOCOD + ' ' + rotulo(p) + ' ' + (p.DESCRICAO || '')).indexOf(termo) !== -1; })
      .sort(function(a, b) { return a.properties.GEOCOD < b.properties.GEOCOD ? -1 : 1; });
    var admin = Acesso.perfil().admin;
    var buscaEl = $('ceBusca'), foco = buscaEl && document.activeElement === buscaEl;
    $('ceCorpo').innerHTML =
      '<div class="ce-linha"><input id="ceBusca" type="search" class="ce-input" placeholder="Buscar código ou nome…" value="' + esc(busca) + '">' +
      '<button type="button" class="ce-btn ce-primario" data-acao="nova">+ Nova</button></div>' +
      '<p class="ce-nota">' + feicoes().length + ' feição(ões) · ' + esc(atual.geometria.toLowerCase()) + '. Clique numa feição do mapa para editar.' +
        (gravaDireto() ? '' : ' Suas alterações ficam <b>aguardando aprovação</b> (tracejadas) e só valem para todos depois de aprovadas.') + '</p>' +
      (pendentes.length ? '<h4 class="ce-titulo ce-pendentes">◷ Aguardando aprovação (' + pendentes.length + ')</h4><div class="ce-lista">' + pendentes.map(function(p) {
        return '<div class="ce-item pendente"><div><b>' + esc(p.geocod || 'nova') + '</b> ' + esc(ACAO[p.acao]) + ' · ' + esc(rotulo(p.dados)) +
          '<small>' + esc(Acesso.cliente && p.criado_por === eu() ? 'sua' : 'de outra pessoa') + ' · ' + quando(p.criado_em) + '</small></div>' +
          '<span class="ce-acoes">' + (p.acao !== 'excluir' ? '<button type="button" class="ce-link" data-ver-pendente="' + p.pid + '">ver</button>' : '') +
          (p.criado_por === eu() ? '<button type="button" class="ce-link perigo" data-cancelar="' + p.pid + '">cancelar</button>' : '') + '</span></div>';
      }).join('') + '</div>' : '') +
      '<div class="ce-lista">' + (lista.length ? lista.map(function(f) {
        var p = f.properties, pend = pendenteDe(p.GEOCOD);
        return '<div class="ce-item' + (pend ? ' com-pendente' : '') + '"><div><b>' + esc(p.GEOCOD) + '</b> ' + esc(rotulo(p)) + (pend ? ' <span class="ce-selo">◷ ' + esc(ACAO[pend.acao]) + ' pendente</span>' : '') +
          '<small>' + esc([medida(p), p.DESCRICAO].filter(Boolean).join(' · ')) + '</small></div>' +
          '<span class="ce-acoes"><button type="button" class="ce-link" data-ver="' + esc(p.GEOCOD) + '">ver</button>' +
          '<button type="button" class="ce-link" data-editar="' + esc(p.GEOCOD) + '">editar</button>' +
          '<button type="button" class="ce-link perigo" data-excluir="' + esc(p.GEOCOD) + '">excluir</button></span></div>';
      }).join('') : '<div class="ce-vazio">' + (busca ? 'Nada encontrado.' : 'Nenhuma feição ainda. Use "+ Nova".') + '</div>') + '</div>' +
      (admin ? '<button type="button" class="ce-link" data-acao="arquivo">ver cópias arquivadas (backup)</button><div id="ceArquivoLista"></div>' : '');
    if (foco) { $('ceBusca').focus(); $('ceBusca').setSelectionRange(busca.length, busca.length); }
  }

  function enquadrar(geojson) {
    var b = L.geoJSON(geojson).getBounds();
    if (b.isValid()) map.fitBounds(b, { maxZoom: 16, padding: [60, 60] });
  }
  function ver(f, tracejado) {   // tracejado: desenho ainda aguardando aprovação
    if (destaque) map.removeLayer(destaque);
    destaque = L.geoJSON(f, {
      style: { color: tracejado ? COR_PENDENTE : '#f59e0b', weight: 8, opacity: 0.9, fillOpacity: 0.25, dashArray: tracejado ? '10 8' : null },
      pointToLayer: function(x, ll) { return L.circleMarker(ll, { radius: 11, color: '#f59e0b', weight: 4, fillOpacity: 0.2 }); },
      interactive: false
    }).addTo(map);
    enquadrar(f);
  }

  function aoClicar(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var por = function(cod) { return feicoes().find(function(f) { return f.properties.GEOCOD === cod; }); };
    if (b.dataset.ver) return ver(por(b.dataset.ver));
    if (b.dataset.editar) return abrirForm(b.dataset.editar);
    if (b.dataset.excluir) return excluir(b.dataset.excluir);
    if (b.dataset.arquivoVer) return ver(JSON.parse(decodeURIComponent(b.dataset.arquivoVer)));
    if (b.dataset.verPendente) { var pp = pendentes.find(function(x) { return x.pid === Number(b.dataset.verPendente); }); if (pp) ver({ type: 'Feature', geometry: pp.geojson, properties: {} }, true); return; }
    if (b.dataset.cancelar) {
      if (!confirm('Cancelar esta alteração pendente? O desenho proposto é descartado.')) return;
      return rpc('cancelar_camada', { p_pid: Number(b.dataset.cancelar) }).then(function() {
        toast('Alteração pendente cancelada');
        return carregarPendentes().then(function() { desenharVisao(); renderLista(); });
      }).catch(function(e) { toast(e.message, true); });
    }
    var acao = b.dataset.acao;
    if (acao === 'nova') abrirForm(null);
    else if (acao === 'arquivo') mostrarArquivo();
    else if (acao === 'desenhar') desenhar();
    else if (acao === 'vertices') alternarVertices();
    else if (acao === 'importar') $('ceArquivo').click();
    else if (acao === 'limpar') { form.grupo.clearLayers(); renderResumoGeom(); }
    else if (acao === 'salvar') salvar();
    else if (acao === 'cancelar') { encerrarForm(); desenharVisao(); renderLista(); }
  }

  // ---------- Formulário (nova ou edição) ----------
  function abrirForm(geocod) {
    carregarGeoman().then(function() {
      var f = geocod ? feicoes().find(function(x) { return x.properties.GEOCOD === geocod; }) : null;
      // Já tem alteração SUA pendente: continua a partir do desenho proposto (salvar refaz a mesma proposta).
      var pend = geocod ? pendenteDe(geocod) : null;
      if (pend && pend.criado_por === eu() && pend.acao === 'alterar') f = { type: 'Feature', geometry: pend.geojson, properties: Object.assign({ GEOCOD: geocod }, pend.dados) };
      var p = f ? f.properties : {};
      modoDesenho(true);
      form = { geocod: geocod, grupo: L.featureGroup().addTo(map), editando: false };
      map.on('pm:create', aoCriar);
      window.obrasSelecaoTracadoAtiva = true;   // enquanto edita, clique no mapa é do desenho (sem popups)
      map.closePopup();
      if (f) { separarPartes(f.geometry).forEach(adicionarParte); enquadrar(f); }
      if (visao) visao.setStyle({ opacity: 0.35, fillOpacity: 0.05 });
      $('ceCamada').disabled = true;
      $('ceCorpo').innerHTML =
        '<h4 class="ce-titulo">' + (geocod ? 'Editar ' + esc(geocod) : 'Nova feição · ' + esc(atual.nome)) + '</h4>' +
        campos().map(function(c) {
          return '<label class="ce-campo">' + c[1] + '<input class="ce-input" data-campo="' + c[0] + '" placeholder="' + esc(c[2]) + '" value="' + esc(p[c[0]] || '') + '"></label>';
        }).join('') +
        '<div class="ce-geom"><b>Geometria</b><span id="ceResumoGeom"></span>' +
          '<div class="ce-linha ce-quebra">' +
            '<button type="button" class="ce-btn" data-acao="desenhar">' + (atual.geometria === 'Ponto' ? 'Marcar ponto' : 'Desenhar parte') + '</button>' +
            '<button type="button" class="ce-btn" data-acao="vertices" id="ceVertices">Mover vértices</button>' +
            '<button type="button" class="ce-btn" data-acao="importar">Importar GeoJSON</button>' +
            '<button type="button" class="ce-btn" data-acao="limpar">Limpar</button></div>' +
          '<input type="file" id="ceArquivo" accept=".geojson,.json,application/geo+json,application/json" hidden>' +
          '<p class="ce-nota" id="ceDica"></p></div>' +
        '<p class="ce-aviso" id="ceAviso"></p>' +
        '<div class="ce-linha"><button type="button" class="ce-btn" data-acao="cancelar">Cancelar</button><span class="ce-espaco"></span>' +
          '<button type="button" class="ce-btn ce-primario" data-acao="salvar">Salvar</button></div>';
      renderResumoGeom();
      if (!f) desenhar();
    }).catch(function(e) { toast(e.message, true); });
  }

  function separarPartes(g) {
    if (!g) return [];
    if (g.type === 'MultiLineString') return g.coordinates.map(function(c) { return { type: 'LineString', coordinates: c }; });
    if (g.type === 'MultiPolygon') return g.coordinates.map(function(c) { return { type: 'Polygon', coordinates: c }; });
    if (g.type === 'MultiPoint') return g.coordinates.map(function(c) { return { type: 'Point', coordinates: c }; });
    if (g.type === 'GeometryCollection') return g.geometries.reduce(function(a, x) { return a.concat(separarPartes(x)); }, []);
    return [g];
  }
  function adicionarParte(g) {
    L.geoJSON(g, {
      pane: 'ceEdicaoPane', pmIgnore: false, snapIgnore: true,
      style: { color: '#f59e0b', weight: 5, fillColor: '#f59e0b', fillOpacity: 0.2 },
      pointToLayer: function(x, ll) { return L.marker(ll, { pane: 'ceEdicaoPane', pmIgnore: false, snapIgnore: true }); }
    }).eachLayer(function(l) { form.grupo.addLayer(l); if (form.editando && l.pm) l.pm.enable({ snappable: true }); });
  }
  function partes() {
    var lista = [];
    form.grupo.eachLayer(function(l) { lista = lista.concat(separarPartes(l.toGeoJSON().geometry)); });
    return lista;
  }
  // Vértices repetidos em sequência saem (terminar com duplo clique cria dois no mesmo lugar e o banco recusa o
  // polígono por auto-interseção). Anel do polígono continua fechado.
  function semRepetidos(coords) {
    var r6 = function(c) { return [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7]; };
    return coords.map(r6).filter(function(c, i, a) { return i === 0 || c[0] !== a[i - 1][0] || c[1] !== a[i - 1][1]; });
  }
  // Junta as partes no tipo da camada: Point, MultiLineString ou MultiPolygon.
  function geometria() {
    var ps = partes();
    if (!ps.length) return null;
    if (atual.geometria === 'Ponto') return ps.filter(function(p) { return p.type === 'Point'; }).pop() || null;
    if (atual.geometria === 'Linha') {
      return { type: 'MultiLineString', coordinates: ps.filter(function(p) { return p.type === 'LineString'; })
        .map(function(p) { return semRepetidos(p.coordinates); }).filter(function(l) { return l.length >= 2; }) };
    }
    return { type: 'MultiPolygon', coordinates: ps.filter(function(p) { return p.type === 'Polygon'; }).map(function(p) {
      return p.coordinates.map(function(anel) {
        var a = semRepetidos(anel);
        if (a.length && (a[0][0] !== a[a.length - 1][0] || a[0][1] !== a[a.length - 1][1])) a.push(a[0].slice());
        return a;
      }).filter(function(anel) { return anel.length >= 4; });
    }).filter(function(pol) { return pol.length; }) };
  }
  function metros(a, b) {
    var R = 6371008.8, f1 = a[1] * Math.PI / 180, f2 = b[1] * Math.PI / 180, df = f2 - f1, dl = (b[0] - a[0]) * Math.PI / 180;
    var h = Math.sin(df / 2) * Math.sin(df / 2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function renderResumoGeom() {
    var g = geometria(), txt;
    if (!g) txt = 'nenhuma ainda';
    else if (g.type === 'Point') txt = 'ponto em ' + g.coordinates[1].toFixed(6) + ', ' + g.coordinates[0].toFixed(6);
    else if (g.type === 'MultiLineString') {
      var km = g.coordinates.reduce(function(s, p) { for (var i = 1; i < p.length; i++) s += metros(p[i - 1], p[i]); return s; }, 0) / 1000;
      txt = g.coordinates.length + (g.coordinates.length === 1 ? ' parte' : ' partes') + ' · ' + num(km) + ' km';
    } else txt = g.coordinates.length + (g.coordinates.length === 1 ? ' polígono' : ' polígonos') + ' (a área é calculada ao salvar)';
    $('ceResumoGeom').textContent = ' · ' + txt;
  }

  function desenhar() {
    if (form.editando) alternarVertices();
    // Só depois que o clique do botão ("+ Nova", "Desenhar parte") terminar: com o Geoman já carregado, o mesmo
    // clique chegava ao mapa e virava um vértice fantasma no lugar do botão.
    setTimeout(ligarDesenho, 0);
  }
  function ligarDesenho() {
    if (!form) return;
    var tipo = DESENHO[atual.geometria];
    if (atual.geometria === 'Ponto') form.grupo.clearLayers();   // um ponto por feição
    map.pm.enableDraw(tipo, { snappable: true, snapDistance: 15, finishOn: tipo === 'Marker' ? null : 'dblclick', templineStyle: { color: '#f59e0b' },
      hintlineStyle: { color: '#f59e0b', dashArray: '5,5' }, pathOptions: { pmIgnore: true }, markerStyle: { pmIgnore: true } });
    $('ceDica').textContent = atual.geometria === 'Ponto' ? 'Clique no mapa para marcar o ponto.'
      : 'Clique no mapa para cada vértice; termine com duplo clique no último' + (atual.geometria === 'Área' ? ' (ou clique no primeiro vértice para fechar)' : '') + '. Esc cancela.';
  }
  // Ligado só com o formulário aberto (o traçado da jurisdição também desenha com o Geoman).
  function aoCriar(e) {
    if (!form) return;
    map.removeLayer(e.layer);
    adicionarParte(e.layer.toGeoJSON().geometry);
    $('ceDica').textContent = atual.geometria === 'Ponto' ? '' : 'Parte incluída. Desenhe outra ou salve.';
    renderResumoGeom();
  }
  function alternarVertices() {
    form.editando = !form.editando;
    form.grupo.eachLayer(function(l) { if (!l.pm) return; if (form.editando) l.pm.enable({ snappable: true }); else l.pm.disable(); });
    $('ceVertices').classList.toggle('ativo', form.editando);
    $('ceVertices').textContent = form.editando ? 'Concluir vértices' : 'Mover vértices';
    $('ceDica').textContent = form.editando ? 'Arraste os vértices; clique no meio de um lado para criar vértice; clique direito apaga um vértice.' : '';
    if (!form.editando) renderResumoGeom();
  }

  // GeoJSON em latitude/longitude (como o QGIS exporta em EPSG:4326/4674). Substitui a geometria do formulário.
  function importar(arquivo) {
    if (!arquivo) return;
    arquivo.text().then(function(txt) {
      var j = JSON.parse(txt);
      var geoms = j.type === 'FeatureCollection' ? j.features.map(function(f) { return f.geometry; }) : j.type === 'Feature' ? [j.geometry] : [j];
      var ps = geoms.reduce(function(a, g) { return a.concat(separarPartes(g)); }, []);
      var tipo = { 'Ponto': 'Point', 'Linha': 'LineString', 'Área': 'Polygon' }[atual.geometria];
      var servem = ps.filter(function(p) { return p.type === tipo; });
      if (!servem.length) throw new Error('O arquivo não tem ' + atual.geometria.toLowerCase() + '(s).');
      var c = servem[0].type === 'Point' ? servem[0].coordinates : servem[0].type === 'LineString' ? servem[0].coordinates[0] : servem[0].coordinates[0][0];
      if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) throw new Error('Coordenadas não parecem latitude/longitude (UTM?). Exporte em EPSG:4674 ou 4326.');
      form.grupo.clearLayers();
      (atual.geometria === 'Ponto' ? servem.slice(0, 1) : servem).forEach(adicionarParte);
      renderResumoGeom();
      enquadrar(geometria());
      toast(servem.length + ' parte(s) importada(s)' + (ps.length > servem.length ? ' (' + (ps.length - servem.length) + ' de outro tipo ignorada[s])' : ''));
    }).catch(function(e) { toast('Importar: ' + e.message, true); });
    $('ceArquivo').value = '';
  }

  function salvar() {
    var dados = {};
    $('ceCorpo').querySelectorAll('[data-campo]').forEach(function(i) { dados[i.dataset.campo] = i.value.trim(); });
    var g = geometria();
    var obrigatorio = campos()[0];
    if (!dados[obrigatorio[0]] || (atual.codigo === 'extra_base' && !dados.trecho)) { $('ceAviso').textContent = 'Preencha ' + (atual.codigo === 'extra_base' ? 'rodovia e descrição do trecho' : 'o nome') + '.'; return; }
    if (!g || !g.coordinates.length) { $('ceAviso').textContent = 'Desenhe ou importe a geometria.'; return; }
    $('ceAviso').textContent = 'Salvando…';
    var codigo = atual.codigo;
    rpc('camada_salvar', { p_camada: codigo, p_geocod: form.geocod, p_dados: dados, p_geojson: g }).then(function(cod) {
      if (/^proposta:/.test(cod)) {
        toast('Salvo e enviado para aprovação: ' + (form.geocod ? 'alteração de ' + form.geocod : 'feição nova') + ' só vale para todos depois de aprovada');
        encerrarForm();
        return carregarPendentes().then(function() { depoisDeRecarregar(codigo); });
      }
      toast((form.geocod ? 'Feição ' + cod + ' alterada' : 'Feição ' + cod + ' criada') + ' em ' + atual.nome);
      encerrarForm();
      renderLista();
      return recarregarCamadaMapa(codigo).then(function() {
        if (!depoisDeRecarregar(codigo)) return;
        var f = feicoes().find(function(x) { return x.properties.GEOCOD === cod; });
        if (f) ver(f);
      });
    }).catch(function(e) { if ($('ceAviso')) $('ceAviso').textContent = e.message; });
  }

  function excluir(geocod) {
    var direto = gravaDireto();
    if (!confirm((direto ? 'Excluir ' : 'Propor a exclusão de ') + geocod + ' de ' + atual.nome + '? ' +
      (direto ? 'Fica uma cópia arquivada (só administradores veem).' : 'A feição só sai da camada depois de aprovada.') + ' Feição ligada a obra não pode ser excluída.')) return;
    var codigo = atual.codigo;
    rpc('camada_excluir', { p_camada: codigo, p_geocod: geocod }).then(function(res) {
      if (/^proposta:/.test(res || '')) {
        toast('Exclusão de ' + geocod + ' enviada para aprovação');
        return carregarPendentes().then(function() { depoisDeRecarregar(codigo); });
      }
      toast(geocod + ' excluída (cópia guardada)');
      return recarregarCamadaMapa(codigo).then(function() { depoisDeRecarregar(codigo); });
    }).catch(function(e) { toast(e.message, true); });
  }

  // A releitura (camada + obras) leva alguns segundos: só redesenha se a pessoa continua na lista da mesma camada.
  function depoisDeRecarregar(codigo) {
    if (form || $('cePainel').hidden || !atual || atual.codigo !== codigo) return false;
    desenharVisao();
    renderLista();
    return true;
  }

  function mostrarArquivo() {
    rpc('camada_arquivo', { p_camada: atual.codigo }).then(function(fc) {
      $('ceArquivoLista').innerHTML = '<h4 class="ce-titulo">Cópias arquivadas (' + fc.features.length + ')</h4><div class="ce-lista">' +
        (fc.features.length ? fc.features.map(function(f) {
          var p = f.properties;
          return '<div class="ce-item arquivado"><div><b>' + esc(p.GEOCOD) + '</b> ' + (p.motivo === 'excluido' ? 'excluída' : 'versão anterior') +
            '<small>' + new Date(p.arquivado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + (p.arquivado_por ? ' por ' + esc(p.arquivado_por) : '') +
            ' · ' + esc(rotulo(p)) + '</small></div><span class="ce-acoes"><button type="button" class="ce-link" data-arquivo-ver="' + encodeURIComponent(JSON.stringify(f)) + '">ver</button></span></div>';
        }).join('') : '<div class="ce-vazio">Nenhuma cópia arquivada ainda.</div>') + '</div>';
    }).catch(function(e) { toast(e.message, true); });
  }

  function encerrarForm() {
    if (!form) return;
    if (map.pm) map.pm.disableDraw();
    map.off('pm:create', aoCriar);
    window.obrasSelecaoTracadoAtiva = false;
    modoDesenho(false);
    form.grupo.eachLayer(function(l) { if (l.pm) l.pm.disable(); });
    map.removeLayer(form.grupo);
    form = null;
    $('ceCamada').disabled = false;
  }

  // ---------- Ver uma proposta no mapa (link do Painel: mapa.html?proposta_camada=<n>) ----------
  // Desenha o proposto (tracejado laranja) e a versão atual (cinza) e mostra o cartão com Aprovar / Recusar
  // para quem decide (o banco confere de novo).
  function verProposta(pid) {
    var cartao = document.createElement('div');
    cartao.className = 'ce-proposta';
    map.getContainer().appendChild(cartao);
    L.DomEvent.disableClickPropagation(cartao);
    var camadasNoMapa = [];
    function limpar() { camadasNoMapa.forEach(function(l) { map.removeLayer(l); }); camadasNoMapa = []; }
    function render() {
      return Acesso.cliente.from('camadas_propostas').select('*').eq('pid', pid).maybeSingle().then(function(res) {
        if (res.error) throw new Error(res.error.message);
        var p = res.data;
        if (!p) { cartao.innerHTML = '<b>Proposta de camada nº ' + pid + '</b><p>Não encontrada ou sem permissão para ver.</p>'; return; }
        limpar();
        var base = camadaBaseMapa(p.camada), atualF = p.geocod && base ? (base.features || []).find(function(f) { return f.properties.GEOCOD === p.geocod; }) : null;
        if (atualF && p.situacao === 'pendente') camadasNoMapa.push(L.geoJSON(atualF, { style: { color: '#64748b', weight: 5, opacity: 0.6 }, pointToLayer: function(f, ll) { return L.circleMarker(ll, { radius: 8, color: '#64748b' }); }, interactive: false }).addTo(map));
        var g = p.acao === 'excluir' ? atualF && atualF.geometry : p.geojson, cor = p.acao === 'excluir' ? '#dc2626' : COR_PENDENTE;
        if (g) camadasNoMapa.push(L.geoJSON(g, { style: { color: cor, weight: 5, dashArray: '8 6', fillOpacity: 0.12 }, pointToLayer: function(f, ll) { return L.circleMarker(ll, { radius: 10, color: cor, weight: 3, dashArray: '3 3' }); }, interactive: false }).addTo(map));
        var todos = L.featureGroup(camadasNoMapa);
        if (todos.getLayers().length) { var bb = todos.getBounds(); if (bb.isValid()) map.fitBounds(bb, { maxZoom: 16, padding: [80, 80] }); }
        var nomes = [], d = p.dados || {};
        Object.keys(d).forEach(function(k) { if (d[k]) nomes.push('<div><small>' + esc(k) + '</small> ' + esc(d[k]) + '</div>'); });
        var decide = p.situacao === 'pendente' && Acesso.podeAprovar(p.area, p.perfil_autor, p.criado_por);
        cartao.innerHTML = '<div class="ce-topo"><b>' + esc(NOMES[p.camada] || p.camada) + ' · ' + esc(ACAO[p.acao]) + (p.geocod ? ' ' + esc(p.geocod) : '') + '</b>' +
            '<button type="button" class="ce-fechar" data-fechar title="Fechar">×</button></div>' +
          '<p class="ce-nota">' + (p.situacao === 'pendente' ? '◷ Aguardando aprovação' : 'Situação: ' + esc(p.situacao)) + ' · enviada em ' + quando(p.criado_em) +
            (p.perfil_autor ? ' · ' + esc(Acesso.nomePerfil(p.perfil_autor)) : '') + '</p>' +
          (nomes.join('') || '') + (p.motivo ? '<p class="ce-nota">Motivo: ' + esc(p.motivo) + '</p>' : '') +
          '<p class="ce-legenda"><i style="border-color:' + cor + '"></i>' + (p.acao === 'excluir' ? 'feição a excluir' : 'desenho proposto') +
            (atualF && p.acao === 'alterar' ? ' <i class="atual"></i>versão atual' : '') + '</p>' +
          (decide ? '<textarea class="ce-input" rows="2" placeholder="Motivo (obrigatório para recusar)"></textarea>' +
            '<div class="ce-linha"><button type="button" class="ce-btn" data-recusar>Recusar</button><button type="button" class="ce-btn ce-primario" data-aprovar>Aprovar</button></div>' : '');
      });
    }
    cartao.addEventListener('click', function(e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-fechar')) { limpar(); cartao.remove(); return; }
      var feito = b.hasAttribute('data-aprovar') ? rpc('aprovar_camada', { p_pid: pid, p_forcar: false }).catch(function(err) {
          if (/CONFLITO/.test(err.message) && confirm(err.message.replace('CONFLITO: ', '') + '.\n\nAprovar mesmo assim? O desenho proposto substitui o atual.')) return rpc('aprovar_camada', { p_pid: pid, p_forcar: true });
          throw err;
        })
        : b.hasAttribute('data-recusar') ? (function() {
          var m = cartao.querySelector('textarea').value.trim();
          if (!m) { toast('Escreva o motivo da recusa', true); return null; }
          return rpc('recusar_camada', { p_pid: pid, p_motivo: m });
        })() : null;
      if (!feito) return;
      feito.then(function(res) {
        if (res === undefined) return;
        toast(b.hasAttribute('data-aprovar') ? 'Aprovada: a camada já mostra a versão nova' : 'Proposta recusada');
        return (typeof recarregarCamadaMapa === 'function' ? recarregarCamadaMapa(cartaoCamada).catch(function() {}) : null);
      }).then(render).catch(function(err) { toast(err.message, true); });
    });
    var cartaoCamada = null;
    cartao.innerHTML = '<p class="ce-nota">Carregando a proposta…</p>';
    Acesso.cliente.from('camadas_propostas').select('camada').eq('pid', pid).maybeSingle().then(function(res) {
      cartaoCamada = res.data && res.data.camada;
      // A camada precisa estar carregada no mapa para mostrar a versão atual.
      return cartaoCamada && typeof recarregarCamadaMapa === 'function' && !camadaBaseMapa(cartaoCamada) ? recarregarCamadaMapa(cartaoCamada).catch(function() {}) : null;
    }).then(render).catch(function(err) { cartao.innerHTML = '<p class="ce-nota">Erro: ' + esc(err.message) + '</p>'; });
  }

  function iniciar() {
    Acesso.pronto.then(function(perfil) {
      if (typeof map === 'undefined') return;
      var pid = Number(new URLSearchParams(location.search).get('proposta_camada'));
      if (pid) setTimeout(function() { verProposta(pid); }, 1500);   // depois do mapa e das camadas iniciais
      camadas = perfil.camadas || [];
      if (!camadas.length) return;
      montar();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  return { abrir: abrir };
})();
