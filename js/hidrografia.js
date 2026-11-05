// Hidrografia junto às rodovias (teste de 05/11/2026): data/hidro_rodo_goias.geojson, gerado por
// DADOS/hidrografia/filtrar_bho_cruza.py (2000 todos) a partir da BHO da ANA. Fica só no site, não no banco.
// Conteúdo: cursos d'água que cruzam rodovias (estaduais e federais) e a continuidade deles, recortados numa faixa de
// 2 km de cada lado; onde a linha sai da faixa, um trecho tracejado (papel = continua_fora) indica que o curso segue.
// Um arquivo só (~4 MB compactado pelo GitHub Pages), baixado na primeira vez que a camada é ligada.
// Usado pelo mapa (js/mapa.js: camada, legenda e popup do clique).

var Hidrografia = (function() {
  var ARQUIVO = 'data/hidro_rodo_goias.geojson';
  var COR = '#1f78c8';
  var dados = null, carregando = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function carregar() {
    if (dados) return Promise.resolve(dados);
    if (!carregando) {
      carregando = fetch(ARQUIVO).then(function(r) {
        if (!r.ok) throw new Error('hidrografia: HTTP ' + r.status);
        return r.json();
      }).then(function(j) {
        // Caixa de cada feição (para achar rápido a do clique).
        (j.features || []).forEach(function(f) {
          var x0 = 180, y0 = 90, x1 = -180, y1 = -90;
          linhasDe(f).forEach(function(l) { l.forEach(function(c) {
            if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
          }); });
          f._caixa = [x0, y0, x1, y1];
        });
        dados = j;
        return j;
      }).catch(function(e) { carregando = null; throw e; });
    }
    return carregando;
  }

  function linhasDe(f) {
    var g = f.geometry || {};
    return g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  }

  // Espessura pela ordem de Strahler (curso maior = mais grosso), um pouco maior de perto.
  function peso(props, z) {
    var s = Math.min(8, Math.max(1, Number(props.nustrahler) || 1));
    var fator = Math.max(0.6, Math.min(1.6, 1 + (z - 11) * 0.15));
    return (0.8 + s * 0.28) * fator;
  }

  function estilo(f, z) {
    var p = f.properties || {};
    var fora = p.papel === 'continua_fora';
    return { color: COR, weight: peso(p, z), opacity: fora ? 0.85 : 0.95, dashArray: fora ? '4 5' : null,
      lineCap: fora ? 'butt' : 'round', lineJoin: 'round' };
  }

  // Camada do mapa: grupo vazio na hora; as linhas entram quando o arquivo chega. Desenho em canvas (muitas linhas).
  function criarCamada(pane) {
    var grupo = L.layerGroup();
    var renderer = L.canvas({ pane: pane || 'overlayPane', padding: 0.3 });
    var geo = null;
    function restilizar() {
      if (geo && grupo._map) { var z = grupo._map.getZoom(); geo.setStyle(function(f) { return estilo(f, z); }); }
    }
    grupo.on('add', function() {
      var map = grupo._map;
      map.on('zoomend', restilizar);
      carregar().then(function(j) {
        if (!geo) {
          var z = map.getZoom();
          geo = L.geoJSON(j, { renderer: renderer, interactive: false, style: function(f) { return estilo(f, z); },
            filter: function(f) { return linhasDe(f).length > 0; } });   // só linhas (um ponto viraria marcador)
          grupo.addLayer(geo);
        }
        restilizar();
      }).catch(function(e) { console.warn(e); });
    });
    grupo.on('remove', function(e) { if (e.target && e.target._map) e.target._map.off('zoomend', restilizar); });
    grupo._mapaHidro = function() { return grupo._map; };
    return grupo;
  }

  // Curso d'água sob o clique (até ~7 px): o mais próximo; o trecho cheio ganha do tracejado.
  function consultar(camada, latlng) {
    var map = camada && camada._map;
    if (!dados || !map) return null;
    var tolPx = 7;
    var p0 = map.latLngToLayerPoint(latlng);
    var p1 = map.layerPointToLatLng(p0.add([tolPx, tolPx]));
    var dx = Math.abs(p1.lng - latlng.lng), dy = Math.abs(p1.lat - latlng.lat);
    var melhor = null, melhorD = tolPx + 0.01;
    dados.features.forEach(function(f) {
      var c = f._caixa;
      if (latlng.lng < c[0] - dx || latlng.lng > c[2] + dx || latlng.lat < c[1] - dy || latlng.lat > c[3] + dy) return;
      linhasDe(f).forEach(function(l) {
        var ant = null;
        l.forEach(function(coord) {
          var pt = map.latLngToLayerPoint([coord[1], coord[0]]);
          if (ant) {
            var d = L.LineUtil.pointToSegmentDistance(p0, ant, pt);
            if (f.properties.papel === 'continua_fora') d += 2;
            if (d < melhorD) { melhorD = d; melhor = f.properties; }
          }
          ant = pt;
        });
      });
    });
    return melhor;
  }

  function fmt(n, casas) {
    return n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas || 0 });
  }

  var PAPEL = { cruza_rodovia: 'Cruza a rodovia', continuidade: 'Continuidade (até 2 km da rodovia)', continua_fora: 'Segue além da faixa de 2 km' };

  function htmlPopup(p) {
    var linhas = [['Situação', PAPEL[p.papel] || '']];
    if (p.rodovias) linhas.push(['Rodovias', p.rodovias.split(', ').map(function(r) { return /^\d+$/.test(r) ? 'GO-' + r : r; }).join(', ')]);
    if (p.nuareamont != null) linhas.push(['Área de drenagem', fmt(p.nuareamont, 1) + ' km²']);
    if (p.nustrahler != null) linhas.push(['Ordem (Strahler)', fmt(p.nustrahler)]);
    return '<div class="popup-cabecalho"><div class="pc-sup">Hidrografia</div>' +
      '<div class="pc-titulo">' + esc(p.nome || 'Curso d’água sem nome') + '</div></div>' +
      '<div class="popup-hidro">' + linhas.map(function(l) { return '<div><b>' + esc(l[0]) + ':</b> ' + esc(l[1]) + '</div>'; }).join('') + '</div>';
  }

  function amostra(tracejado) {
    return '<svg width="48" height="12" viewBox="0 0 48 12" aria-hidden="true"><path d="M0 6 C12 1, 20 11, 32 5 S44 4, 48 6" fill="none" stroke="' +
      COR + '" stroke-width="2"' + (tracejado ? ' stroke-dasharray="4 4"' : ' stroke-linecap="round"') + '/></svg>';
  }

  function htmlLegenda() {
    return '<div class="legenda-item">' + amostra(false) + '<span>Curso d’água até 2 km da rodovia (cruza a rodovia ou é a continuidade)</span></div>' +
      '<div class="legenda-item">' + amostra(true) + '<span>Continua além da faixa</span></div>' +
      '<div class="legenda-item"><small>Mais grosso = curso maior. Clique para ver o nome.</small></div>';
  }

  return { criarCamada: criarCamada, consultar: consultar, htmlPopup: htmlPopup, htmlLegenda: htmlLegenda, carregar: carregar };
})();
