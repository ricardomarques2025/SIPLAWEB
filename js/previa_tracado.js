// Prévia do traçado nas telas de aprovação (19/11/2026): Painel › Alterações e aprovações, Aprovações das obras e da
// Jurisdição no mapa. Um mapinha com o traçado atual e o proposto, nas cores:
//   incluído (laranja) = entra com a proposta; mantido (verde) = já existe e continua; retirado (vermelho tracejado) = sai.
// Trechos de base ('sre_base:306EGO0101', 'extra_base:TRE0055'...) vêm do banco por siplaweb.feicoes_tracado (031), só
// os citados; desenho próprio (geom: GeoJSON ou EWKT de ponto/linha) é desenhado direto. O mapa só é montado quando o
// quadro aparece na tela (dentro de diálogos e listas longas).
var PreviaTracado = (function() {
  var COR = { incluido: '#ea580c', mantido: '#15803d', retirado: '#dc2626' };
  var NOME = { incluido: 'Incluído', mantido: 'Mantido', retirado: 'Retirado' };
  var cache = {};       // vinculo -> geometry
  var seq = 0, observador = null, pendentes = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // geom em qualquer forma que as propostas guardam -> GeoJSON geometry (ou null)
  function geometria(g) {
    if (!g) return null;
    if (typeof g === 'object') return g.type === 'Feature' ? g.geometry : g;
    var t = String(g).replace(/^SRID=\d+;/i, '').trim(), m;
    function pares(s) { return s.split(',').map(function(p) { var n = p.trim().split(/\s+/).map(Number); return [n[0], n[1]]; }); }
    if ((m = /^POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)/i.exec(t))) return { type: 'Point', coordinates: [Number(m[1]), Number(m[2])] };
    if ((m = /^LINESTRING\s*\((.*)\)$/i.exec(t))) return { type: 'LineString', coordinates: pares(m[1]) };
    if ((m = /^MULTILINESTRING\s*\(\((.*)\)\)$/i.exec(t))) return { type: 'MultiLineString', coordinates: m[1].split(/\)\s*,\s*\(/).map(pares) };
    try { return geometria(JSON.parse(t)); } catch (e) { return null; }
  }
  function mesmaGeom(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // A proposta mexe no traçado? (campos geom/vinculos nas mudanças, feição de camada)
  function mudaTracado(m) { return !!m && (Object.prototype.hasOwnProperty.call(m, 'geom') || Object.prototype.hasOwnProperty.call(m, 'vinculos')); }

  function buscar(vinculos) {
    var faltam = vinculos.filter(function(v) { return !(v in cache); });
    if (!faltam.length) return Promise.resolve();
    var lotes = [];
    for (var i = 0; i < faltam.length; i += 500) lotes.push(faltam.slice(i, i + 500));
    return Promise.all(lotes.map(function(l) {
      return Acesso.cliente.rpc('feicoes_tracado', { p_vinculos: l }).then(function(r) {
        if (r.error) throw r.error;
        l.forEach(function(v) { cache[v] = null; });
        (r.data.features || []).forEach(function(f) { cache[f.properties.vinculo] = f.geometry; });
      });
    }));
  }

  // html(chave): quadro vazio no cartão da proposta. Depois de pôr o HTML na página, cada tela chama
  // ligar(container, function(chave) { return cfg; }) com:
  // cfg: { antes: { vinculos: [], geom }, depois: { vinculos (só se a proposta muda), geom, mudaGeom }, semAntes, depoisPromise }
  //  - semAntes: proposta decidida ou sem registro atual -> tudo o que vem aparece como "Proposto" (laranja), sem comparar.
  function html(chave) { return '<div class="previa-tracado" data-chave="' + esc(chave) + '"><div class="previa-mapa"></div><div class="previa-legenda">Carregando o traçado…</div></div>'; }
  function ligar(raiz, cfgDe) {
    if (!raiz) return;
    Array.prototype.forEach.call(raiz.querySelectorAll('.previa-tracado:not([data-pronto])'), function(el) {
      var cfg = null;
      try { cfg = cfgDe(el.dataset.chave); } catch (e) { cfg = null; }
      if (cfg) anexar(el, cfg); else el.remove();
    });
  }

  function anexar(el, cfg) {
    el.setAttribute('data-pronto', '1');
    el.dataset.previa = String(++seq);
    pendentes[el.dataset.previa] = cfg;
    if (!('IntersectionObserver' in window)) return montar(el);
    if (!observador) observador = new IntersectionObserver(function(entradas) {
      entradas.forEach(function(e) { if (e.isIntersecting) { observador.unobserve(e.target); montar(e.target); } });
    });
    observador.observe(el);
  }

  function montar(el) {
    var cfg = pendentes[el.dataset.previa]; delete pendentes[el.dataset.previa];
    if (!cfg || typeof L === 'undefined') { el.querySelector('.previa-legenda').textContent = 'Mapa indisponível nesta tela.'; return; }
    var antes = cfg.antes || {}, depois = cfg.depois || {};
    var vA = antes.vinculos || [], vD = depois.vinculos;
    var temVinc = Array.isArray(vD);
    if (!temVinc) vD = vA;                                // proposta não mexe nos vínculos: os atuais continuam
    Promise.all([buscar(vA.concat(vD)), cfg.depoisPromise || Promise.resolve(depois.geom)]).then(function(r) {
      var gD = depois.mudaGeom || cfg.depoisPromise ? geometria(r[1]) : geometria(antes.geom);
      var gA = geometria(antes.geom);
      var feicoes = [];
      function add(geom, tipo, rotulo) { if (geom) feicoes.push({ type: 'Feature', geometry: geom, properties: { tipo: tipo, rotulo: rotulo } }); }
      if (cfg.semAntes) {
        vD.forEach(function(v) { add(cache[v], 'incluido', v.split(':')[1]); });
        add(gD, 'incluido', 'desenho proposto');
      } else {
        vD.forEach(function(v) { add(cache[v], vA.indexOf(v) >= 0 ? 'mantido' : 'incluido', v.split(':')[1]); });
        vA.forEach(function(v) { if (vD.indexOf(v) < 0) add(cache[v], 'retirado', v.split(':')[1]); });
        if (gA && gD && mesmaGeom(gA, gD)) add(gD, 'mantido', 'desenho atual');
        else { add(gA, 'retirado', 'desenho atual'); add(gD, 'incluido', 'desenho proposto'); }
      }
      var faltando = vA.concat(vD).filter(function(v, i, a) { return a.indexOf(v) === i && !cache[v]; });
      desenhar(el, feicoes, faltando, cfg.semAntes);
    }).catch(function(e) { el.querySelector('.previa-legenda').textContent = 'Não foi possível carregar o traçado: ' + (e.message || e); });
  }

  function desenhar(el, feicoes, faltando, semAntes) {
    var leg = el.querySelector('.previa-legenda');
    if (!feicoes.length) {
      el.querySelector('.previa-mapa').hidden = true;
      leg.textContent = 'Sem traçado' + (faltando.length ? ' (não encontrado: ' + faltando.join(', ') + ')' : '') + '.';
      return;
    }
    var mapa = L.map(el.querySelector('.previa-mapa'), { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(mapa);
    var ordem = { retirado: 0, mantido: 1, incluido: 2 };
    feicoes.sort(function(a, b) { return ordem[a.properties.tipo] - ordem[b.properties.tipo]; });
    var camada = L.geoJSON({ type: 'FeatureCollection', features: feicoes }, {
      style: function(f) {
        var t = f.properties.tipo, area = /Polygon/.test(f.geometry.type);
        return { color: COR[t], weight: area ? 2 : (t === 'retirado' ? 4 : 5), opacity: .95, dashArray: t === 'retirado' ? '6 6' : null,
          fillColor: COR[t], fillOpacity: area ? .15 : 0 };
      },
      pointToLayer: function(f, ll) { return L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: COR[f.properties.tipo], fillOpacity: 1 }); },
      onEachFeature: function(f, l) { l.bindTooltip(NOME[f.properties.tipo] + ': ' + f.properties.rotulo, { sticky: true }); }
    }).addTo(mapa);
    mapa.fitBounds(camada.getBounds(), { padding: [18, 18], maxZoom: 15 });
    setTimeout(function() { mapa.invalidateSize(); mapa.fitBounds(camada.getBounds(), { padding: [18, 18], maxZoom: 15 }); }, 150);
    var cont = {}; feicoes.forEach(function(f) { cont[f.properties.tipo] = (cont[f.properties.tipo] || 0) + 1; });
    leg.innerHTML = ['incluido', 'mantido', 'retirado'].filter(function(t) { return cont[t]; }).map(function(t) {
      return '<span><i class="previa-' + t + '"></i>' + (semAntes && t === 'incluido' ? 'Proposto' : NOME[t]) + ' (' + cont[t] + ')</span>';
    }).join('') + (faltando.length ? '<span class="previa-falta">não encontrado: ' + esc(faltando.join(', ')) + '</span>' : '') +
      '<span class="previa-dica">role com o mouse sobre o mapa: clique nele antes</span>';
    mapa.once('click', function() { mapa.scrollWheelZoom.enable(); });
  }

  return { html: html, ligar: ligar, mudaTracado: mudaTracado, geometria: geometria };
})();
