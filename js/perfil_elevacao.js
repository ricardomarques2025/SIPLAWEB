// Perfil de elevação (19/11/2026, homologação): gráfico distância × altitude de uma linha do mapa.
// Entradas: botão "Perfil de elevação" no popup de qualquer linha (abrirPopupNoPonto recebe a linha clicada) e a
// ferramenta "Perfil" (desenhar uma linha à mão; duplo clique conclui, Esc cancela).
// Altitude: Terrain Tiles públicos (AWS Open Data, formato Terrarium; no Brasil vêm do SRTM da NASA, ~30 m), lidos no
// navegador: cada pixel = (R*256 + G + B/256) - 32768 metros. Sem chave e sem servidor nosso. É o TERRENO natural (pode
// incluir vegetação/edificações), com erro de 5 a 10 m: serve para planejamento, não para greide de projeto.
var PerfilElevacao = (function() {
  var URL_TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var TAM = 256, MAX_PONTOS = 1500, PASSO_MIN = 15;   // amostra a cada >= 15 m, no máximo 1500 pontos
  var cacheTiles = {};                                // "z/x/y" -> Promise<Uint8ClampedArray|null>
  var painel = null, camadaLinha = null, marcador = null, atual = null;
  var desenhando = false, pontosDesenho = [], camadaDesenho = null, botaoFerramenta = null, dica = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, casas) { return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 }); }

  // ---------- Geometria ----------
  // Linhas (LineString/MultiLineString) -> lista única de [lat, lng], encadeando as partes pela ponta mais próxima.
  function caminho(geom) {
    if (!geom) return [];
    var partes = geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' ? geom.coordinates.slice() : [];
    partes = partes.filter(function(p) { return p && p.length > 1; }).map(function(p) { return p.map(function(c) { return [c[1], c[0]]; }); });
    if (!partes.length) return [];
    var res = partes.shift().slice();
    function d(a, b) { return L.latLng(a).distanceTo(L.latLng(b)); }
    while (partes.length) {
      var fim = res[res.length - 1], ini = res[0], melhor = null;
      partes.forEach(function(p, i) {
        [[d(fim, p[0]), i, false, false], [d(fim, p[p.length - 1]), i, true, false],
         [d(ini, p[p.length - 1]), i, false, true], [d(ini, p[0]), i, true, true]].forEach(function(o) { if (!melhor || o[0] < melhor[0]) melhor = o; });
      });
      var parte = partes.splice(melhor[1], 1)[0].slice();
      if (melhor[2]) parte.reverse();
      res = melhor[3] ? parte.concat(res) : res.concat(parte);
    }
    return res;
  }
  // Pontos igualmente espaçados ao longo do caminho: [{lat, lng, dist}]
  function amostrar(pts) {
    var acum = [0];
    for (var i = 1; i < pts.length; i++) acum.push(acum[i - 1] + L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i])));
    var total = acum[acum.length - 1];
    if (!total) return { total: 0, amostras: [] };
    var passo = Math.max(PASSO_MIN, total / MAX_PONTOS), amostras = [], k = 0;
    for (var s = 0; s <= total + 1e-6; s += passo) {
      while (k < acum.length - 2 && acum[k + 1] < s) k++;
      var seg = acum[k + 1] - acum[k] || 1, t = Math.min(1, Math.max(0, (s - acum[k]) / seg));
      amostras.push({ lat: pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, lng: pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, dist: s });
    }
    var ult = pts[pts.length - 1];
    if (total - amostras[amostras.length - 1].dist > 1) amostras.push({ lat: ult[0], lng: ult[1], dist: total });
    return { total: total, amostras: amostras };
  }

  // ---------- Altitude (Terrain Tiles) ----------
  function tile(z, x, y) {
    var chave = z + '/' + x + '/' + y;
    if (!cacheTiles[chave]) cacheTiles[chave] = new Promise(function(ok) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() {
        var c = document.createElement('canvas'); c.width = c.height = TAM;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        try { ok(ctx.getImageData(0, 0, TAM, TAM).data); } catch (e) { ok(null); }
      };
      img.onerror = function() { ok(null); };
      img.src = URL_TILE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    });
    return cacheTiles[chave];
  }
  function pixel(lat, lng, z) {
    var n = Math.pow(2, z), r = lat * Math.PI / 180;
    return { x: (lng + 180) / 360 * n * TAM, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * TAM };
  }
  function altitudes(amostras, z) {
    var precisos = {};
    var refs = amostras.map(function(a) {
      var p = pixel(a.lat, a.lng, z), px = p.x - 0.5, py = p.y - 0.5, x0 = Math.floor(px), y0 = Math.floor(py);
      var cantos = [[x0, y0], [x0 + 1, y0], [x0, y0 + 1], [x0 + 1, y0 + 1]].map(function(c) {
        var tx = Math.floor(c[0] / TAM), ty = Math.floor(c[1] / TAM), k = z + '/' + tx + '/' + ty;
        precisos[k] = [z, tx, ty];
        return { k: k, i: ((c[1] - ty * TAM) * TAM + (c[0] - tx * TAM)) * 4 };
      });
      return { fx: px - x0, fy: py - y0, cantos: cantos };
    });
    var chaves = Object.keys(precisos);
    if (chaves.length > 400) return Promise.reject(new Error('Linha longa demais para o perfil (' + chaves.length + ' blocos de altitude).'));
    return Promise.all(chaves.map(function(k) { var t = precisos[k]; return tile(t[0], t[1], t[2]).then(function(d) { return [k, d]; }); })).then(function(lista) {
      var dados = {}; lista.forEach(function(l) { dados[l[0]] = l[1]; });
      return refs.map(function(r) {
        var v = r.cantos.map(function(c) {
          var d = dados[c.k]; if (!d) return null;
          return d[c.i] * 256 + d[c.i + 1] + d[c.i + 2] / 256 - 32768;
        });
        if (v.some(function(x) { return x == null; })) return null;
        return (v[0] * (1 - r.fx) + v[1] * r.fx) * (1 - r.fy) + (v[2] * (1 - r.fx) + v[3] * r.fx) * r.fy;
      });
    });
  }

  // ---------- Números ----------
  function resumo(am) {
    var e = am.map(function(a) { return a.alt; });
    // suaviza (média móvel ~5 pontos) para subida/descida e rampas não somarem o ruído do SRTM
    var s = e.map(function(_, i) { var a = Math.max(0, i - 2), b = Math.min(e.length - 1, i + 2), t = 0; for (var k = a; k <= b; k++) t += e[k]; return t / (b - a + 1); });
    var sobe = 0, desce = 0;
    for (var i = 1; i < s.length; i++) { var d = s[i] - s[i - 1]; if (d > 0) sobe += d; else desce -= d; }
    // rampa em janelas de ~100 m
    var rampas = am.map(function() { return 0; }), j = 0, rmax = 0, rmaxDist = 0;
    for (i = 0; i < am.length; i++) {
      while (j < am.length - 1 && am[j].dist - am[i].dist < 100) j++;
      var dd = am[j].dist - am[i].dist;
      if (dd >= 50) { var r = (s[j] - s[i]) / dd * 100; rampas[i] = r; if (Math.abs(r) > Math.abs(rmax)) { rmax = r; rmaxDist = am[i].dist; } }
      else rampas[i] = i ? rampas[i - 1] : 0;
    }
    var min = Math.min.apply(null, e), max = Math.max.apply(null, e), total = am[am.length - 1].dist;
    return { min: min, max: max, sobe: sobe, desce: desce, rmax: rmax, rmaxDist: rmaxDist, rampas: rampas,
      rmedia: total ? (s[s.length - 1] - s[0]) / total * 100 : 0, ini: e[0], fim: e[e.length - 1] };
  }

  // ---------- Painel ----------
  function garantirPainel() {
    if (painel) return painel;
    painel = document.createElement('div');
    painel.className = 'perfil-elev';
    painel.innerHTML = '<div class="perfil-topo"><b>Perfil de elevação</b><span class="perfil-titulo"></span>' +
      '<button type="button" class="perfil-csv" title="Baixar os pontos (km, latitude, longitude, altitude)">Baixar CSV</button>' +
      '<button type="button" class="perfil-fechar" title="Fechar">×</button></div>' +
      '<div class="perfil-nums"></div><div class="perfil-grafico"></div>' +
      '<div class="perfil-nota">Altitude do terreno natural (SRTM/NASA, ~30 m, erro de 5 a 10 m; pode incluir vegetação e edificações). ' +
      'Para planejamento e comparação de alternativas, não para greide de projeto. Fonte: Terrain Tiles (AWS Open Data).</div>';
    document.body.appendChild(painel);
    painel.querySelector('.perfil-fechar').onclick = fechar;
    painel.querySelector('.perfil-csv').onclick = baixarCsv;
    return painel;
  }
  function fechar() {
    if (painel) painel.classList.remove('aberto');
    if (camadaLinha) { map.removeLayer(camadaLinha); camadaLinha = null; }
    if (marcador) { map.removeLayer(marcador); marcador = null; }
    atual = null;
  }

  function abrir(geom, titulo) {
    var pts = caminho(geom);
    if (pts.length < 2) { alert('Esta feição não tem uma linha para o perfil.'); return; }
    var a = amostrar(pts);
    if (!a.total) return;
    garantirPainel();
    map.closePopup();
    painel.classList.add('aberto');
    painel.querySelector('.perfil-titulo').textContent = titulo || '';
    painel.querySelector('.perfil-nums').innerHTML = '';
    painel.querySelector('.perfil-grafico').innerHTML = '<p class="perfil-carregando">Lendo as altitudes de ' + num(a.total / 1000, 2) + ' km…</p>';
    if (camadaLinha) map.removeLayer(camadaLinha);
    camadaLinha = L.polyline(pts, { color: '#ea580c', weight: 5, opacity: .9, interactive: false }).addTo(map);
    map.fitBounds(camadaLinha.getBounds(), { padding: [40, 40], paddingBottomRight: [40, 300], maxZoom: 15 });
    var z = a.total > 150000 ? 11 : a.total > 40000 ? 12 : 13;
    var pedido = atual = { titulo: titulo, amostras: a.amostras, total: a.total };
    altitudes(a.amostras, z).then(function(alts) {
      if (atual !== pedido) return;
      var am = a.amostras.map(function(p, i) { return { lat: p.lat, lng: p.lng, dist: p.dist, alt: alts[i] }; }).filter(function(p) { return p.alt != null; });
      if (am.length < 2) throw new Error('Sem altitude para este local.');
      pedido.amostras = am;
      pedido.res = resumo(am);
      desenharGrafico(pedido);
    }).catch(function(e) {
      if (atual === pedido) painel.querySelector('.perfil-grafico').innerHTML = '<p class="perfil-carregando">Não foi possível montar o perfil: ' + esc(e.message || e) + '</p>';
    });
  }

  function desenharGrafico(p) {
    var r = p.res, am = p.amostras, total = p.total;
    painel.querySelector('.perfil-nums').innerHTML = [
      ['Extensão', num(total / 1000, 2) + ' km'], ['Altitude', num(r.min) + ' a ' + num(r.max) + ' m'],
      ['Início → fim', num(r.ini) + ' → ' + num(r.fim) + ' m'], ['Subida total', '+' + num(r.sobe) + ' m'], ['Descida total', '−' + num(r.desce) + ' m'],
      ['Rampa média', num(r.rmedia, 1) + '%'], ['Rampa máxima', num(Math.abs(r.rmax), 1) + '% (' + (r.rmax >= 0 ? 'subindo' : 'descendo') + ', km ' + num(r.rmaxDist / 1000, 2) + ')']
    ].map(function(x) { return '<div><small>' + x[0] + '</small><b>' + x[1] + '</b></div>'; }).join('');

    var box = painel.querySelector('.perfil-grafico');
    var W = box.clientWidth || 800, H = 200, m = { e: 48, d: 12, t: 10, b: 26 };
    var faixa = Math.max(10, r.max - r.min), y0 = r.min - faixa * .08, y1 = r.max + faixa * .08;
    function X(d) { return m.e + d / total * (W - m.e - m.d); }
    function Y(v) { return m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b); }
    var linha = am.map(function(a, i) { return (i ? 'L' : 'M') + X(a.dist).toFixed(1) + ',' + Y(a.alt).toFixed(1); }).join('');
    var area = linha + 'L' + X(total).toFixed(1) + ',' + (H - m.b) + 'L' + X(0).toFixed(1) + ',' + (H - m.b) + 'Z';
    function passoBonito(v, n) { var p = Math.pow(10, Math.floor(Math.log10(v / n))), q = v / n / p; return (q > 5 ? 10 : q > 2 ? 5 : q > 1 ? 2 : 1) * p; }
    var py = passoBonito(y1 - y0, 4), px = passoBonito(total / 1000, 6), grade = '';
    for (var v = Math.ceil(y0 / py) * py; v <= y1; v += py) grade += '<line x1="' + m.e + '" x2="' + (W - m.d) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="g"/><text x="' + (m.e - 6) + '" y="' + (Y(v) + 4) + '" class="ty">' + num(v) + '</text>';
    for (var k = 0; k <= total / 1000 + 1e-9; k += px) grade += '<line y1="' + m.t + '" y2="' + (H - m.b) + '" x1="' + X(k * 1000) + '" x2="' + X(k * 1000) + '" class="g"/><text x="' + X(k * 1000) + '" y="' + (H - 8) + '" class="tx">' + num(k, px < 1 ? 1 : 0) + '</text>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '">' + grade +
      '<text x="' + (W - m.d) + '" y="' + (H - 8) + '" class="tx un">km</text><text x="6" y="' + (m.t + 4) + '" class="ty un">m</text>' +
      '<path d="' + area + '" class="area"/><path d="' + linha + '" class="linha"/>' +
      '<line class="cursor" y1="' + m.t + '" y2="' + (H - m.b) + '" visibility="hidden"/><circle class="ponto" r="4" visibility="hidden"/></svg>' +
      '<div class="perfil-tip" hidden></div>';
    var svg = box.querySelector('svg'), cur = svg.querySelector('.cursor'), pt = svg.querySelector('.ponto'), tip = box.querySelector('.perfil-tip');
    function mover(ev) {
      var rect = svg.getBoundingClientRect(), x = (ev.clientX - rect.left) * W / rect.width;
      var d = Math.max(0, Math.min(total, (x - m.e) / (W - m.e - m.d) * total)), i = 0;
      while (i < am.length - 1 && am[i + 1].dist < d) i++;
      if (i < am.length - 1 && am[i + 1].dist - d < d - am[i].dist) i++;
      var a = am[i];
      cur.setAttribute('x1', X(a.dist)); cur.setAttribute('x2', X(a.dist)); cur.setAttribute('visibility', 'visible');
      pt.setAttribute('cx', X(a.dist)); pt.setAttribute('cy', Y(a.alt)); pt.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = 'km <b>' + num(a.dist / 1000, 2) + '</b> · <b>' + num(a.alt) + ' m</b> · rampa ' + num(r.rampas[i], 1) + '%';
      tip.style.left = Math.min(rect.width - 180, Math.max(0, (ev.clientX - rect.left) + 10)) + 'px';
      if (!marcador) marcador = L.circleMarker([a.lat, a.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#ea580c', fillOpacity: 1, interactive: false }).addTo(map);
      else marcador.setLatLng([a.lat, a.lng]);
    }
    svg.addEventListener('mousemove', mover);
    svg.addEventListener('mouseleave', function() { cur.setAttribute('visibility', 'hidden'); pt.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  function baixarCsv() {
    if (!atual || !atual.res) return;
    var linhas = ['km;latitude;longitude;altitude_m'].concat(atual.amostras.map(function(a) {
      return [(a.dist / 1000).toFixed(3), a.lat.toFixed(6), a.lng.toFixed(6), a.alt.toFixed(1)].join(';').replace(/\./g, ',');
    }));
    var el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    el.download = 'perfil_elevacao_' + String(atual.titulo || 'linha').replace(/[^\w-]+/g, '_').slice(0, 40) + '.csv';
    el.click();
    setTimeout(function() { URL.revokeObjectURL(el.href); }, 1000);
  }

  // ---------- Botão no popup das linhas ----------
  var linhaDoPopup = null;
  function botaoPopup(layer) {
    if (!layer || !layer.toGeoJSON) return '';
    var g = layer.toGeoJSON().geometry;
    if (!g || !/LineString/.test(g.type)) return '';
    var pr = (layer.feature && layer.feature.properties) || {};
    linhaDoPopup = { geom: g, titulo: pr.GEOCOD || pr.codigo || pr.CODIGO || pr.sre || pr.SRE || pr.rodovia || pr.NOME || pr.nome || '' };
    return '<button type="button" class="perfil-btn-popup" onclick="PerfilElevacao.abrirDoPopup()">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19 9 9l4 6 3-4 5 8z"/></svg>Perfil de elevação</button>';
  }
  function abrirDoPopup() { if (linhaDoPopup) abrir(linhaDoPopup.geom, linhaDoPopup.titulo); }

  // ---------- Ferramenta: desenhar a linha ----------
  function redesenhar(prev) {
    camadaDesenho.clearLayers();
    var pts = pontosDesenho.concat(prev ? [prev] : []);
    if (pts.length > 1) L.polyline(pts, { color: '#ea580c', weight: 3, dashArray: '6 6', interactive: false }).addTo(camadaDesenho);
    pontosDesenho.forEach(function(p) { L.circleMarker(p, { radius: 4, color: '#ea580c', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(camadaDesenho); });
  }
  // Clique capturado no container ANTES das camadas: clicar em cima de uma rodovia também marca o ponto (as linhas
  // clicáveis do mapa não deixam o clique chegar ao mapa) e não abre o popup dela.
  function dentroDoMapa(ev) { return !(ev.target.closest && ev.target.closest('.leaflet-control, .leaflet-popup, .perfil-elev')); }
  function aoClicar(ev) {
    if (!desenhando || !dentroDoMapa(ev)) return;
    ev.stopPropagation(); ev.preventDefault();
    if (ev.detail >= 2) return concluir();
    pontosDesenho.push(map.mouseEventToLatLng(ev)); redesenhar();
  }
  function aoMover(ev) { if (desenhando && pontosDesenho.length && dentroDoMapa(ev)) redesenhar(map.mouseEventToLatLng(ev)); }
  function aoTecla(e) { if (desenhando && e.key === 'Escape') parar(); if (desenhando && e.key === 'Enter') concluir(); }
  function iniciar() {
    if (desenhando) return parar();
    desenhando = true; window.perfilDesenhando = true; pontosDesenho = [];
    if (!camadaDesenho) camadaDesenho = L.layerGroup().addTo(map);
    map.doubleClickZoom.disable();
    map.getContainer().classList.add('perfil-cursor');
    if (botaoFerramenta) botaoFerramenta.classList.add('ativo');
    if (!dica) { dica = document.createElement('div'); dica.className = 'perfil-dica'; map.getContainer().appendChild(dica); }
    dica.innerHTML = 'Clique os pontos da linha · <b>duplo clique</b> ou Enter conclui · Esc cancela';
    dica.hidden = false;
    var c = map.getContainer();
    c.addEventListener('click', aoClicar, true); c.addEventListener('mousemove', aoMover, true); document.addEventListener('keydown', aoTecla);
  }
  function parar() {
    desenhando = false; window.perfilDesenhando = false;
    var c = map.getContainer();
    c.removeEventListener('click', aoClicar, true); c.removeEventListener('mousemove', aoMover, true); document.removeEventListener('keydown', aoTecla);
    map.doubleClickZoom.enable();
    map.getContainer().classList.remove('perfil-cursor');
    if (botaoFerramenta) botaoFerramenta.classList.remove('ativo');
    if (dica) dica.hidden = true;
    if (camadaDesenho) camadaDesenho.clearLayers();
  }
  function concluir() {
    var pts = pontosDesenho.slice();
    parar();
    if (pts.length < 2) return;
    abrir({ type: 'LineString', coordinates: pts.map(function(p) { return [p.lng, p.lat]; }) }, 'linha desenhada');
  }

  function instalar() {
    if (typeof map === 'undefined' || !map.addControl) return;
    var Controle = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function() {
        var c = L.DomUtil.create('div', 'leaflet-bar medicao-control perfil-control');
        botaoFerramenta = L.DomUtil.create('button', 'medicao-btn', c);
        botaoFerramenta.type = 'button';
        botaoFerramenta.title = 'Perfil de elevação: desenhe uma linha no mapa';
        botaoFerramenta.textContent = 'Perfil';
        L.DomEvent.disableClickPropagation(c);
        L.DomEvent.on(botaoFerramenta, 'click', function(e) { L.DomEvent.preventDefault(e); iniciar(); });
        return c;
      }
    });
    map.addControl(new Controle());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar); else instalar();

  return { abrir: abrir, abrirDoPopup: abrirDoPopup, botaoPopup: botaoPopup, fechar: fechar };
})();
