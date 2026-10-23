// Aba "Traçado" da ficha da obra (js/obras/painel.js).
// Linha e Área: o traçado é a lista de vínculos com feições das camadas de base ('sre_base:139EGO0105'),
// escolhidas pela lista (base -> rodovia/grupo -> busca, Shift marca intervalo) ou clicando no mapa
// (Shift+clique pega todos os trechos do mesmo grupo entre o último clicado e este).
// Ponto: coordenada digitada ou marcada no mapa (clique ou arraste), mais vínculo opcional (aeródromo, localidade).
// Nada grava direto: tudo vira pendência e passa pelo "Revisar e salvar". As bases são editadas fora do site.

var ObrasTracado = (function() {
  var LIMITE_LISTA = 400;
  var api = null;          // { toast, mostrarMapa, aoMudar, margens } (vem do painel)
  var uid = null;
  var estado = { base: null, grupo: '', busca: '', marcados: new Set(), ultimo: null, ultimoMapa: null };
  var modoMapa = null;     // null | 'vinculos' | 'ponto'
  var camada = null, marcador = null;
  var renderer = null;

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function partes(v) { var p = v.indexOf(':'); return [v.slice(0, p), v.slice(p + 1)]; }
  function indices() { return (typeof indicesBaseObrasMapa === 'function' && indicesBaseObrasMapa()) || {}; }
  function feicao(v) { var p = partes(v), i = indices()[p[0]]; return i ? i[p[1]] : null; }
  function propsDe(v) { var f = feicao(v); return f ? f.properties || {} : null; }
  function obra() { return ObrasStore.obter(uid); }
  function podeEditar() { return ObrasStore.podeAlterar(); }   // editor basico tambem (vira proposta)
  function vinculosAtuais() { return (ObrasStore.valorAtual(uid, 'vinculos') || []).slice(); }
  function vinculosOriginais() { return (obra().vinculos || []).slice(); }
  function pontoAtual() { var g = ObrasStore.valorAtual(uid, 'geom'); return g && g.type === 'Point' ? g.coordinates : null; }
  function fmtCoord(v) { return Number(v).toFixed(6); }

  function rotuloVinculo(v) {
    var p = partes(v), def = BASES_TRACADO[p[0]], pr = propsDe(v);
    if (!def || !pr) return { rotulo: p[1], detalhe: '(não encontrado na camada ' + p[0] + ')' };
    return { rotulo: def.rotulo(pr), detalhe: def.detalhe(pr) };
  }

  // Ordem de exibição: base, grupo, sequência no grupo.
  function chaveOrdem(v) {
    var p = partes(v), def = BASES_TRACADO[p[0]], pr = propsDe(v) || {};
    var ordem = def ? def.ordem(pr) : p[1];
    return [Object.keys(BASES_TRACADO).indexOf(p[0]), def ? String(def.grupo(pr) || '') : '', typeof ordem === 'number' ? ordem : String(ordem)];
  }
  function compararVinculos(a, b) {
    var ka = chaveOrdem(a), kb = chaveOrdem(b);
    for (var i = 0; i < 3; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; }
    return 0;
  }

  function kmTotal(lista) {
    return lista.reduce(function(s, v) { var p = partes(v), def = BASES_TRACADO[p[0]], pr = propsDe(v); return s + (def && def.km && pr ? def.km(pr) : 0); }, 0);
  }

  function definirVinculos(lista) {
    var unicos = Array.from(new Set(lista));
    ObrasStore.definirPendente(uid, 'vinculos', unicos);
    api.aoMudar();
    renderVinculados();
    renderResultados();
    restilizar();
  }
  function alternar(v, ligar) {
    var atual = vinculosAtuais(), i = atual.indexOf(v);
    if (ligar === undefined) ligar = i === -1;
    if (ligar && i === -1) atual.push(v);
    if (!ligar && i !== -1) atual.splice(i, 1);
    definirVinculos(atual);
  }

  // ---------- Feições da base escolhida ----------
  function feicoesBase(base) {
    var i = indices()[base];
    return i ? Object.keys(i).map(function(g) { return i[g]; }) : [];
  }
  function grupos(base) {
    var def = BASES_TRACADO[base], vistos = {};
    feicoesBase(base).forEach(function(f) { var g = def.grupo(f.properties || {}); if (g) vistos[g] = (vistos[g] || 0) + 1; });
    return Object.keys(vistos).sort(function(a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); }).map(function(g) { return [g, vistos[g]]; });
  }
  function resultados() {
    var base = estado.base, def = BASES_TRACADO[base];
    var termos = semAcento(estado.busca).split(/\s+/).filter(Boolean);
    return feicoesBase(base).filter(function(f) {
      var p = f.properties || {};
      if (estado.grupo && def.grupo(p) !== estado.grupo) return false;
      if (!termos.length) return true;
      var alvo = semAcento([p.GEOCOD, def.rotulo(p), def.detalhe(p), def.grupo(p)].join(' '));
      return termos.every(function(t) { return alvo.indexOf(t) !== -1; });
    }).map(function(f) { return base + ':' + f.properties.GEOCOD; }).sort(compararVinculos);
  }

  // ---------- Aba ----------
  function render(corpo, r, opcoes) {
    if (uid !== r.uid) { estado.marcados = new Set(); estado.ultimo = null; estado.ultimoMapa = null; estado.busca = ''; estado.grupo = ''; estado.base = null; }
    uid = r.uid;
    api = opcoes;
    var bases = BASES_POR_TIPO[r.tipo] || [];
    if (bases.indexOf(estado.base) === -1) {
      var usadas = vinculosAtuais().map(function(v) { return partes(v)[0]; });
      estado.base = bases.filter(function(b) { return usadas.indexOf(b) !== -1; })[0] || bases[0];
    }
    var html = '<div class="trc">';
    if (r.tipo === 'Ponto') html += blocoPonto();
    if (r.tipo === 'Linha' && ObrasStore.valorAtual(r.uid, 'geom')) {
      html += '<div class="obr-aviso-proposta">Esta obra tem <b>traçado desenhado</b> (importado do gpkg, porque cobre só parte dos segmentos SRE): ' +
        'é ele que aparece no mapa. Os segmentos abaixo ficam como referência.</div>';
    }
    html += '<div class="form-grupo"><h4>' + (r.tipo === 'Ponto' ? 'Vínculo com a base (opcional)' : 'Traçado pela base') + '</h4>' +
      '<div id="trcResumo" class="trc-resumo"></div><div id="trcVinculados" class="trc-lista"></div></div>';
    if (podeEditar() && bases.length) {
      html += '<div class="form-grupo"><h4>Adicionar</h4><div class="trc-filtros">' +
        (bases.length > 1 ? '<select id="trcBase" class="seletor">' + bases.map(function(b) { return '<option value="' + b + '"' + (b === estado.base ? ' selected' : '') + '>' + esc(BASES_TRACADO[b].nome) + '</option>'; }).join('') + '</select>'
          : '<span class="trc-base-unica">' + esc(BASES_TRACADO[estado.base].nome) + '</span>') +
        '<select id="trcGrupo" class="seletor"></select>' +
        '<label class="busca"><svg><use href="#o-search"/></svg><input id="trcBusca" type="search" placeholder="Código, km, nome…" autocomplete="off" value="' + esc(estado.busca) + '"></label>' +
        '</div>' +
        '<div class="trc-acoes"><button type="button" class="btn" id="trcMapa"></button><div class="espaco"></div>' +
        '<button type="button" class="btn btn-fantasma" id="trcMarcarTodos">Marcar todos</button>' +
        '<button type="button" class="btn btn-primario" id="trcAdicionar" disabled></button></div>' +
        '<p class="trc-dica">Marque na lista (Shift+clique marca um intervalo) ou use <b>Selecionar no mapa</b>: clique no trecho para incluir ou tirar; Shift+clique inclui todos os trechos da mesma rodovia entre o último clicado e este.</p>' +
        '<div id="trcResultados" class="trc-lista trc-resultados"></div></div>';
    }
    html += '</div>';
    corpo.innerHTML = html;
    if ($('trcGrupo')) preencherGrupos();
    renderVinculados();
    renderResultados();
    atualizarBotaoMapa();
    ligar(corpo);
    if (modoMapa === 'vinculos') desenharCamada();
  }

  function blocoPonto() {
    var c = pontoAtual(), editado = ObrasStore.pendente(uid, 'geom') ? ' editado' : '', dis = podeEditar() ? '' : ' disabled';
    return '<div class="form-grupo"><h4>Coordenada do ponto</h4><div class="form-grade">' +
      '<div class="campo' + editado + '"><label><span class="marcador"></span>Latitude</label><input id="trcLat" inputmode="decimal" placeholder="-16.680000"' + dis + ' value="' + (c ? fmtCoord(c[1]) : '') + '"></div>' +
      '<div class="campo' + editado + '"><label><span class="marcador"></span>Longitude</label><input id="trcLon" inputmode="decimal" placeholder="-49.250000"' + dis + ' value="' + (c ? fmtCoord(c[0]) : '') + '"></div>' +
      '</div>' + (podeEditar() ? '<div class="trc-acoes"><button type="button" class="btn" id="trcPonto"></button>' +
        (c ? '<button type="button" class="btn btn-fantasma" id="trcApagarPonto">Tirar o ponto</button>' : '') +
        '<span class="obr-aviso" id="trcAvisoPonto"></span></div>' : '') + '</div>';
  }

  function preencherGrupos() {
    var def = BASES_TRACADO[estado.base], sel = $('trcGrupo');
    var lista = grupos(estado.base);
    sel.hidden = !def.rotuloGrupo || !lista.length;
    sel.innerHTML = '<option value="">Qualquer ' + esc(def.rotuloGrupo.toLowerCase()) + '</option>' +
      lista.map(function(g) { return '<option value="' + esc(g[0]) + '"' + (g[0] === estado.grupo ? ' selected' : '') + '>' + esc(g[0]) + ' (' + g[1] + ')</option>'; }).join('');
  }

  function renderVinculados() {
    var el = $('trcVinculados');
    if (!el) return;
    var atuais = vinculosAtuais().sort(compararVinculos), originais = vinculosOriginais();
    var removidos = originais.filter(function(v) { return atuais.indexOf(v) === -1; }).sort(compararVinculos);
    var r = obra(), km = kmTotal(atuais);
    var item = atuais.length ? BASES_TRACADO[partes(atuais[0])[0]] : BASES_TRACADO[estado.base];
    $('trcResumo').innerHTML = atuais.length
      ? '<b>' + atuais.length + '</b> ' + esc(item ? item.item : 'vínculo') + (atuais.length === 1 ? '' : 's') + (km ? ' · <b>' + kmObra(km) + ' km</b>' : '') +
        (ObrasStore.pendente(uid, 'vinculos') ? ' <span class="trc-tag trc-tag-pend">alterado, falta salvar</span>' : '')
      : (r.tipo === 'Ponto' ? 'Sem vínculo (o ponto vale pela coordenada).' : 'Nenhum trecho vinculado: a obra não aparece no mapa.');
    var linha = function(v, removido) {
      var t = rotuloVinculo(v), novo = !removido && originais.indexOf(v) === -1;
      return '<div class="trc-item' + (novo ? ' novo' : '') + (removido ? ' removido' : '') + '" data-trc-foco="' + esc(v) + '">' +
        '<div class="trc-texto"><b>' + esc(t.rotulo) + '</b>' + (novo ? ' <span class="trc-tag trc-tag-novo">novo</span>' : '') + (removido ? ' <span class="trc-tag trc-tag-rem">sai</span>' : '') +
        '<span>' + esc(t.detalhe) + '</span></div>' +
        (podeEditar() ? (removido ? '<button type="button" class="link" data-trc-desfazer="' + esc(v) + '">desfazer</button>'
          : '<button type="button" class="btn-icone" title="Tirar do traçado" data-trc-tirar="' + esc(v) + '"><svg><use href="#o-x"/></svg></button>') : '') +
        '</div>';
    };
    el.innerHTML = atuais.map(function(v) { return linha(v, false); }).join('') + removidos.map(function(v) { return linha(v, true); }).join('');
  }

  function renderResultados() {
    var el = $('trcResultados');
    if (!el) return;
    var lista = resultados(), atuais = vinculosAtuais();
    estado.listaVisivel = lista.slice(0, LIMITE_LISTA);
    var disponiveis = estado.listaVisivel.filter(function(v) { return atuais.indexOf(v) === -1; });
    el.innerHTML = estado.listaVisivel.length ? estado.listaVisivel.map(function(v) {
      var t = rotuloVinculo(v), ja = atuais.indexOf(v) !== -1;
      return '<label class="trc-opcao' + (ja ? ' ja' : '') + '"><input type="checkbox" data-trc-marcar="' + esc(v) + '"' +
        (ja ? ' checked disabled' : estado.marcados.has(v) ? ' checked' : '') + '><span class="trc-texto"><b>' + esc(t.rotulo) + '</b>' +
        (ja ? ' <span class="trc-tag">já no traçado</span>' : '') + '<span>' + esc(t.detalhe) + '</span></span></label>';
    }).join('') + (lista.length > LIMITE_LISTA ? '<div class="vazio">Mostrando ' + LIMITE_LISTA + ' de ' + lista.length + '. Escolha a rodovia ou refine a busca.</div>' : '')
      : '<div class="vazio">Nada encontrado com esse filtro.</div>';
    $('trcMarcarTodos').hidden = !disponiveis.length;
    $('trcMarcarTodos').textContent = 'Marcar todos (' + disponiveis.length + ')';
    atualizarBotaoAdicionar();
  }
  function atualizarBotaoAdicionar() {
    var b = $('trcAdicionar'); if (!b) return;
    var n = estado.marcados.size;
    b.disabled = !n;
    b.innerHTML = '<svg><use href="#o-plus"/></svg>Adicionar' + (n ? ' ' + n + ' marcado' + (n === 1 ? '' : 's') : '');
  }
  function atualizarBotaoMapa() {
    var b = $('trcMapa');
    if (b) { b.classList.toggle('ativo', modoMapa === 'vinculos'); b.innerHTML = '<svg><use href="#o-pin"/></svg>' + (modoMapa === 'vinculos' ? 'Parar seleção no mapa' : 'Selecionar no mapa'); }
    var p = $('trcPonto');
    if (p) { p.classList.toggle('ativo', modoMapa === 'ponto'); p.innerHTML = '<svg><use href="#o-pin"/></svg>' + (modoMapa === 'ponto' ? 'Concluir marcação' : 'Marcar no mapa'); }
  }

  // ---------- Eventos da aba ----------
  function ligar(corpo) {
    function on(id, ev, fn) { if ($(id)) $(id).addEventListener(ev, fn); }
    on('trcBase', 'change', function() {
      estado.base = this.value; estado.grupo = ''; estado.marcados = new Set(); estado.ultimo = null;
      preencherGrupos(); renderResultados();
      if (modoMapa === 'vinculos') desenharCamada();
    });
    on('trcGrupo', 'change', function() {
      estado.grupo = this.value; estado.ultimo = null; renderResultados(); restilizar();
      if (modoMapa === 'vinculos' && estado.grupo) enquadrar(resultados());
    });
    var t = null;
    on('trcBusca', 'input', function() { var v = this.value; clearTimeout(t); t = setTimeout(function() { estado.busca = v.trim(); renderResultados(); }, 150); });
    on('trcMarcarTodos', 'click', function() {
      var atuais = vinculosAtuais();
      estado.listaVisivel.forEach(function(v) { if (atuais.indexOf(v) === -1) estado.marcados.add(v); });
      renderResultados();
    });
    on('trcAdicionar', 'click', function() {
      var n = estado.marcados.size;
      definirVinculos(vinculosAtuais().concat(Array.from(estado.marcados)));
      estado.marcados = new Set(); estado.ultimo = null;
      renderResultados();
      api.toast(n + ' adicionado(s) ao traçado (pendente: falta revisar e salvar)');
    });
    on('trcMapa', 'click', function() { modoMapa === 'vinculos' ? encerrarMapa() : iniciarMapaVinculos(); });
    on('trcPonto', 'click', function() { modoMapa === 'ponto' ? encerrarMapa() : iniciarMapaPonto(); });
    on('trcApagarPonto', 'click', function() { definirPonto(null); });
    ['trcLat', 'trcLon'].forEach(function(id) {
      on(id, 'change', function() {
        var lat = $('trcLat').value.trim().replace(',', '.'), lon = $('trcLon').value.trim().replace(',', '.');
        if (!lat && !lon) { definirPonto(null); return; }
        if (!lat || !lon) return;
        definirPonto([Number(lat), Number(lon)]);
      });
    });
    corpo.addEventListener('click', function(e) {
      var marcar = e.target.closest('[data-trc-marcar]');
      if (marcar) { aoMarcar(marcar, e); return; }
      var tirar = e.target.closest('[data-trc-tirar]');
      if (tirar) { e.stopPropagation(); alternar(tirar.dataset.trcTirar, false); return; }
      var desfazer = e.target.closest('[data-trc-desfazer]');
      if (desfazer) { e.stopPropagation(); alternar(desfazer.dataset.trcDesfazer, true); return; }
      var foco = e.target.closest('[data-trc-foco]');
      if (foco && !e.target.closest('button')) enquadrar([foco.dataset.trcFoco]);
    });
  }

  // Shift+clique: marca (ou desmarca) tudo entre o último clicado e este, na ordem da lista.
  function aoMarcar(input, e) {
    var v = input.dataset.trcMarcar, lista = estado.listaVisivel, atuais = vinculosAtuais();
    var i = lista.indexOf(v), j = estado.ultimo ? lista.indexOf(estado.ultimo) : -1;
    var faixa = e.shiftKey && j !== -1 ? lista.slice(Math.min(i, j), Math.max(i, j) + 1) : [v];
    faixa.forEach(function(x) { if (atuais.indexOf(x) !== -1) return; input.checked ? estado.marcados.add(x) : estado.marcados.delete(x); });
    estado.ultimo = v;
    if (faixa.length > 1) renderResultados(); else atualizarBotaoAdicionar();
    restilizar();
  }

  // ---------- Ponto ----------
  function definirPonto(latlon) {
    var aviso = $('trcAvisoPonto');
    if (latlon) {
      var erro = validarPontoObra(latlon[0], latlon[1]);
      if (aviso) aviso.textContent = erro;
      if (erro) return;
      ObrasStore.definirPendente(uid, 'geom', { type: 'Point', coordinates: [Number(latlon[1].toFixed(6)), Number(latlon[0].toFixed(6))] });
    } else {
      ObrasStore.definirPendente(uid, 'geom', null);
    }
    if (aviso) aviso.textContent = '';
    var c = pontoAtual();
    if ($('trcLat')) { $('trcLat').value = c ? fmtCoord(c[1]) : ''; $('trcLon').value = c ? fmtCoord(c[0]) : ''; }
    document.querySelectorAll('#trcLat, #trcLon').forEach(function(i) { i.closest('.campo').classList.toggle('editado', ObrasStore.pendente(uid, 'geom')); });
    if (marcador) { if (c) marcador.setLatLng([c[1], c[0]]).addTo(map); else map.removeLayer(marcador); }
    api.aoMudar();
  }

  function iniciarMapaPonto() {
    encerrarMapa();
    modoMapa = 'ponto';
    window.obrasSelecaoTracadoAtiva = true;
    api.mostrarMapa().then(function() {
      if (modoMapa !== 'ponto') return;
      var c = pontoAtual();
      marcador = L.marker(c ? [c[1], c[0]] : map.getCenter(), { draggable: true, zIndexOffset: 1000, title: 'Arraste para ajustar' });
      marcador.on('dragend', function() { var ll = marcador.getLatLng(); definirPonto([ll.lat, ll.lng]); });
      if (c) { marcador.addTo(map); map.panTo([c[1], c[0]]); }
      map.on('click', cliquePonto);
      map.getContainer().classList.add('trc-mira');
      api.toast('Clique no mapa para posicionar o ponto (ou arraste o marcador)');
    });
    atualizarBotaoMapa();
  }
  function cliquePonto(e) { definirPonto([e.latlng.lat, e.latlng.lng]); }

  // ---------- Selecao no mapa ----------
  function estilo(f) {
    var v = estado.base + ':' + f.properties.GEOCOD, def = BASES_TRACADO[estado.base];
    var noTracado = vinculosAtuais().indexOf(v) !== -1, marcado = estado.marcados.has(v);
    var doGrupo = estado.grupo && def.grupo(f.properties) === estado.grupo;
    var poligono = /Polygon/.test(f.geometry.type);
    var cor = noTracado ? '#f59e0b' : marcado ? '#16a34a' : doGrupo ? '#2563eb' : '#475569';
    return {
      color: cor, weight: noTracado || marcado ? 6 : doGrupo ? 4 : poligono ? 1 : 2.5, opacity: noTracado || marcado || doGrupo ? 0.95 : 0.55,
      fill: poligono, fillColor: cor, fillOpacity: poligono ? (noTracado ? 0.35 : doGrupo ? 0.12 : 0.03) : 0,
      radius: noTracado || marcado ? 8 : 5
    };
  }
  function desenharCamada() {
    if (camada) { map.removeLayer(camada); camada = null; }
    if (!renderer) {
      map.createPane('obrasTracadoPane').style.zIndex = 640;
      renderer = L.canvas({ pane: 'obrasTracadoPane', tolerance: 8 });
    }
    var def = BASES_TRACADO[estado.base];
    camada = L.geoJSON({ type: 'FeatureCollection', features: feicoesBase(estado.base) }, {
      pane: 'obrasTracadoPane', renderer: renderer, style: estilo,
      pointToLayer: function(f, ll) { return L.circleMarker(ll, Object.assign({ pane: 'obrasTracadoPane', renderer: renderer }, estilo(f))); },
      onEachFeature: function(f, l) {
        var p = f.properties || {};
        l.bindTooltip('<b>' + esc(def.rotulo(p)) + '</b><br>' + esc(def.detalhe(p)), { sticky: true, direction: 'top', className: 'trc-tooltip' });
        l.on('click', function(e) { L.DomEvent.stopPropagation(e); cliqueFeicao(f, e.originalEvent && e.originalEvent.shiftKey); });
      }
    }).addTo(map);
  }
  function restilizar() {
    if (!camada) return;
    camada.eachLayer(function(l) { l.setStyle(estilo(l.feature)); if (vinculosAtuais().indexOf(estado.base + ':' + l.feature.properties.GEOCOD) !== -1 && l.bringToFront) l.bringToFront(); });
  }

  // Clique: inclui/tira. Shift+clique: inclui todos do mesmo grupo entre o último clicado e este (ordem da base).
  function cliqueFeicao(f, shift) {
    var def = BASES_TRACADO[estado.base], v = estado.base + ':' + f.properties.GEOCOD;
    var anterior = estado.ultimoMapa && propsDe(estado.ultimoMapa);
    if (shift && anterior && def.grupo(anterior) === def.grupo(f.properties)) {
      var g = def.grupo(f.properties);
      var doGrupo = feicoesBase(estado.base).filter(function(x) { return def.grupo(x.properties) === g; })
        .map(function(x) { return estado.base + ':' + x.properties.GEOCOD; }).sort(compararVinculos);
      var i = doGrupo.indexOf(estado.ultimoMapa), j = doGrupo.indexOf(v);
      var faixa = doGrupo.slice(Math.min(i, j), Math.max(i, j) + 1);
      definirVinculos(vinculosAtuais().concat(faixa));
      api.toast(faixa.length + ' trecho(s) de ' + g + ' no traçado');
    } else {
      alternar(v);
    }
    estado.ultimoMapa = v;
  }

  function iniciarMapaVinculos() {
    encerrarMapa();
    modoMapa = 'vinculos';
    window.obrasSelecaoTracadoAtiva = true;
    atualizarBotaoMapa();
    api.mostrarMapa().then(function() {
      if (modoMapa !== 'vinculos') return;
      desenharCamada();
      var atuais = vinculosAtuais().filter(function(v) { return partes(v)[0] === estado.base; });
      if (atuais.length) enquadrar(atuais); else if (estado.grupo) enquadrar(resultados());
      api.toast('Clique nos trechos para incluir ou tirar; Shift+clique pega o intervalo');
    });
  }

  function encerrarMapa() {
    if (camada) { map.removeLayer(camada); camada = null; }
    if (marcador) { map.removeLayer(marcador); marcador = null; }
    map.off('click', cliquePonto);
    map.getContainer().classList.remove('trc-mira');
    window.obrasSelecaoTracadoAtiva = false;
    var estava = modoMapa;
    modoMapa = null;
    atualizarBotaoMapa();
    if (estava && api && api.aoEncerrar) api.aoEncerrar();
  }

  function enquadrar(lista) {
    var b = L.latLngBounds([]);
    lista.forEach(function(v) { var f = feicao(v); if (f && f.geometry) b.extend(L.geoJSON(f).getBounds()); });
    if (!b.isValid()) return;
    api.mostrarMapa().then(function() {
      var mg = api.margens();
      map.fitBounds(b, { paddingTopLeft: [mg[0] + 50, 50], paddingBottomRight: [mg[1] + 50, 50], maxZoom: 14 });
    });
  }

  // ---------- Texto da conferencia e do historico ----------
  function descrever(campo, antes, depois) {
    if (campo === 'geom') {
      var f = function(g) { return g && g.coordinates ? fmtCoord(g.coordinates[1]) + ', ' + fmtCoord(g.coordinates[0]) : ''; };
      return { antes: f(antes), depois: f(depois) };
    }
    var a = antes || [], d = depois || [];
    var mais = d.filter(function(v) { return a.indexOf(v) === -1; }).sort(compararVinculos);
    var menos = a.filter(function(v) { return d.indexOf(v) === -1; }).sort(compararVinculos);
    function nomes(l) { return l.map(function(v) { return rotuloVinculo(v).rotulo; }).join(', '); }
    return {
      antes: a.length + ' vínculo(s)' + (menos.length ? ' · sai: ' + nomes(menos) : ''),
      depois: d.length + ' vínculo(s)' + (mais.length ? ' · entra: ' + nomes(mais) : '') + (kmTotal(d) ? ' · ' + kmObra(kmTotal(d)) + ' km' : '')
    };
  }

  return { render: render, encerrar: encerrarMapa, descrever: descrever, ativo: function() { return modoMapa; } };
})();
