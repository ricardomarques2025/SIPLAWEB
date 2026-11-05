// Hidrografia junto às rodovias: data/hidro_rodo_goias.geojson, gerado por DADOS/hidrografia/filtrar_bho_cruza.py
// (2000 todos) a partir da BHO da ANA. Fica só no site, não no banco.
// Conteúdo: cursos d'água que cruzam rodovias (estaduais e federais) e a continuidade deles, recortados numa faixa de
// 2 km de cada lado; onde a linha sai da faixa, um trecho tracejado (papel = continua_fora) indica que o curso segue.
// Um arquivo só (~4 MB compactado pelo GitHub Pages), baixado na primeira vez que a camada é ligada (ou na busca).
// Usado pelo mapa (js/mapa.js): camada com rótulos ao longo da linha, legenda, popup do clique e busca por nome.

var Hidrografia = (function() {
  var ARQUIVO = 'data/hidro_rodo_goias.geojson?v=20261105-4';
  var COR = '#1f78c8';
  var COR_ROTULO = '#1557a0';
  var dados = null, carregando = null, cursos = [];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function normalizar(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function carregar() {
    if (dados) return Promise.resolve(dados);
    if (!carregando) {
      carregando = fetch(ARQUIVO).then(function(r) {
        if (!r.ok) throw new Error('hidrografia: HTTP ' + r.status);
        return r.json();
      }).then(function(j) {
        // Caixa de cada feição (clique, rótulos e busca).
        (j.features || []).forEach(function(f) {
          var x0 = 180, y0 = 90, x1 = -180, y1 = -90;
          linhasDe(f).forEach(function(l) { l.forEach(function(c) {
            if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
          }); });
          f._caixa = [x0, y0, x1, y1];
        });
        dados = j;
        cursos = montarCursos(j);
        return j;
      }).catch(function(e) { carregando = null; throw e; });
    }
    return carregando;
  }

  function linhasDe(f) {
    var g = f.geometry || {};
    return g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  }

  // Para os rótulos: os trechos da BHO são curtos (poucos km); junta os de mesmo nome que se tocam numa linha só,
  // senão o nome não cabe em nenhum pedaço. [{ nome, s (maior Strahler), linhas: [[lng,lat]...], caixa }]
  function montarCursos(j) {
    var porNome = {};
    j.features.forEach(function(f) {
      var p = f.properties;
      if (!p.nome || p.papel === 'continua_fora') return;
      var g = porNome[p.nome] || (porNome[p.nome] = { nome: p.nome, s: 1, linhas: [] });
      g.s = Math.max(g.s, strahler(p));
      linhasDe(f).forEach(function(l) { if (l.length > 1) g.linhas.push(l); });
    });
    var chave = function(c) { return c[0].toFixed(5) + ',' + c[1].toFixed(5); };
    var lista = [];
    Object.keys(porNome).forEach(function(nome) {
      var g = porNome[nome], ls = g.linhas, usado = ls.map(function() { return false; }), pontas = {};
      ls.forEach(function(l, i) {
        [chave(l[0]), chave(l[l.length - 1])].forEach(function(k) { (pontas[k] = pontas[k] || []).push(i); });
      });
      function proxima(c) {
        var cand = pontas[chave(c)] || [];
        for (var i = 0; i < cand.length; i++) if (!usado[cand[i]]) return cand[i];
        return -1;
      }
      var cadeias = [];
      ls.forEach(function(l0, i0) {
        if (usado[i0]) return;
        usado[i0] = true;
        var cad = l0.slice(), i;
        while ((i = proxima(cad[cad.length - 1])) >= 0) {   // estende para a frente
          usado[i] = true;
          var l = ls[i];
          if (chave(l[0]) !== chave(cad[cad.length - 1])) l = l.slice().reverse();
          cad = cad.concat(l.slice(1));
        }
        while ((i = proxima(cad[0])) >= 0) {                 // e para trás
          usado[i] = true;
          var lb = ls[i];
          if (chave(lb[lb.length - 1]) !== chave(cad[0])) lb = lb.slice().reverse();
          cad = lb.slice(0, -1).concat(cad);
        }
        cadeias.push(cad);
      });
      var x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      cadeias.forEach(function(l) { l.forEach(function(c) {
        if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      }); });
      cadeias.forEach(function(l) {
        var cx0 = 180, cy0 = 90, cx1 = -180, cy1 = -90;
        l.forEach(function(c) { if (c[0] < cx0) cx0 = c[0]; if (c[0] > cx1) cx1 = c[0]; if (c[1] < cy0) cy0 = c[1]; if (c[1] > cy1) cy1 = c[1]; });
        lista.push({ nome: nome, s: g.s, linha: l, caixa: [cx0, cy0, cx1, cy1], tam: (cx1 - cx0) + (cy1 - cy0) });
      });
    });
    return lista;
  }

  function strahler(p) { return Math.min(8, Math.max(1, Number(p.nustrahler) || 1)); }

  // Espessura pela ordem de Strahler (curso maior = mais grosso), um pouco maior de perto.
  function peso(props, z) {
    var fator = Math.max(0.6, Math.min(1.6, 1 + (z - 11) * 0.15));
    return (0.8 + strahler(props) * 0.28) * fator;
  }

  function estilo(f, z) {
    var p = f.properties || {};
    var fora = p.papel === 'continua_fora';
    return { color: COR, weight: peso(p, z), opacity: fora ? 0.85 : 0.95, dashArray: fora ? '4 5' : null,
      lineCap: fora ? 'butt' : 'round', lineJoin: 'round' };
  }

  function garantirPane(map, nome, z) {
    if (!map.getPane(nome)) map.createPane(nome).style.zIndex = z;
    map.getPane(nome).style.pointerEvents = 'none';
    return nome;
  }

  // ---------- Rótulos ao longo da linha (canvas próprio, refeito a cada movimento) ----------
  // Fonte azul itálica que acompanha o curso, letra a letra; sem sobreposição (caixas por letra), dos cursos maiores
  // para os menores; quanto mais perto, mais cursos ganham nome (STRAHLER_MIN por zoom).
  var STRAHLER_MIN = { 9: 6, 10: 5, 11: 3, 12: 2 };   // zoom >= 13: todos; < 9: nenhum
  var RotulosLayer = L.Layer.extend({
    onAdd: function(map) {
      this._map = map;
      var pane = garantirPane(map, 'hidrografiaRotulosPane', 480);
      this._canvas = L.DomUtil.create('canvas', 'hidro-rotulos-canvas');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      map.getPane(pane).appendChild(this._canvas);
      map.on('moveend', this._desenhar, this);
      map.on('zoomstart', this._esconder, this);
      this._desenhar();
    },
    onRemove: function(map) {
      map.off('moveend', this._desenhar, this);
      map.off('zoomstart', this._esconder, this);
      L.DomUtil.remove(this._canvas);
    },
    _esconder: function() { if (this._canvas) this._canvas.style.display = 'none'; },
    _desenhar: function() {
      var map = this._map, cv = this._canvas;
      if (!map || !cv) return;
      var tam = map.getSize(), dpr = window.devicePixelRatio || 1;
      cv.width = tam.x * dpr; cv.height = tam.y * dpr;
      cv.style.width = tam.x + 'px'; cv.style.height = tam.y + 'px';
      L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
      cv.style.display = '';
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, tam.x, tam.y);
      if (!dados) return;
      var z = map.getZoom();
      if (z < 9) return;
      var minS = z >= 13 ? 1 : STRAHLER_MIN[Math.floor(z)];
      desenharRotulos(map, ctx, tam, z, minS);
    }
  });

  function desenharRotulos(map, ctx, tam, z, minS) {
    var vista = map.getBounds().pad(0.05);
    var oeste = vista.getWest(), leste = vista.getEast(), sul = vista.getSouth(), norte = vista.getNorth();
    var cand = cursos.filter(function(cu) {
      var c = cu.caixa;
      return cu.s >= minS && c[2] >= oeste && c[0] <= leste && c[3] >= sul && c[1] <= norte;
    }).sort(function(a, b) { return b.s - a.s || b.tam - a.tam; });
    var ocupadas = [];                  // caixas já usadas (letras), em coordenadas da tela
    var porNome = {};                   // posições já rotuladas de cada nome (repetição só bem longe)
    var ESPACO = 420;                   // px entre repetições do mesmo nome
    var margem = 6;

    cand.forEach(function(cu) {
      var s = cu.s, p = { nustrahler: s };
      var tamFonte = (s >= 6 ? 13 : s >= 4 ? 12 : 11) - (z < 12 ? 2 : 0);   // mais afastado: letra menor, cabe mais
      ctx.font = 'italic ' + (s >= 6 ? '600 ' : '') + tamFonte + 'px "Segoe UI", Arial, sans-serif';
      var texto = cu.nome;
      var larg = ctx.measureText(texto).width;
      var desloc = tamFonte * 0.55 + peso(p, z) / 2 + 1;   // distância do texto até o eixo da linha
      [cu.linha].forEach(function(linha) {
        // trechos contínuos dentro da tela
        var trecho = [];
        var fechar = function() { if (trecho.length > 1) tentarTrecho(trecho); trecho = []; };
        linha.forEach(function(c) {
          var pt = map.latLngToContainerPoint([c[1], c[0]]);
          if (pt.x < margem || pt.y < margem || pt.x > tam.x - margem || pt.y > tam.y - margem) return fechar();
          trecho.push(pt);
        });
        fechar();
      });

      function tentarTrecho(bruto) {
        var sv = suavizar(bruto, Math.max(tamFonte * 1.6, larg * 0.45));
        var pts = sv.pts, acum = sv.acum;
        var total = acum[acum.length - 1];
        if (total < larg + 24) return;
        // Linhas paralelas acima do curso, uma para cada sentido de leitura: as letras são distribuídas sobre elas
        // (espaçamento certo também nas curvas). Calculadas só quando precisar.
        var paralelas = {};
        function paralela(sentido) {
          if (!paralelas[sentido]) {
            var base = sentido > 0 ? pts : pts.slice().reverse();
            paralelas[sentido] = deslocar(base, desloc);
          }
          return paralelas[sentido];
        }
        // posições candidatas: do meio para as pontas, de 24 em 24 px; repete o nome só a ESPACO de outro igual
        var meio = total / 2, ini = larg / 2 + 6, fim = total - larg / 2 - 6, centros = [];
        for (var k = 0; k < 80; k++) {
          var dd = meio + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 24;
          if (dd >= ini && dd <= fim) centros.push(dd);
          else if (Math.ceil(k / 2) * 24 > total / 2) break;
        }
        centros.forEach(function(centro) {
          var c = ponto(pts, acum, centro);
          var outros = porNome[texto] || [];
          for (var j = 0; j < outros.length; j++) if (outros[j].distanceTo(c) < ESPACO) return;
          // ler da esquerda para a direita: se a linha vai para a esquerda, usa o sentido contrário
          var sentido = ponto(pts, acum, centro + larg / 2).x < ponto(pts, acum, centro - larg / 2).x ? -1 : 1;
          var par = paralela(sentido), totalPar = par.acum[par.acum.length - 1];
          var centroPar = (sentido > 0 ? centro : total - centro) * totalPar / total;
          if (colocar(par.pts, par.acum, centroPar)) (porNome[texto] = outros).push(c);
        });
      }

      function colocar(pts, acum, centro) {
        var letras = [], caixas = [], d = centro - larg / 2, angAnt = null, giro = 0;
        if (d < 0 || centro + larg / 2 > acum[acum.length - 1]) return false;
        for (var i = 0; i < texto.length; i++) {
          var ch = texto[i], w = ctx.measureText(ch).width;
          var dm = d + w / 2;
          var lc = Math.max(w / 2, tamFonte * 0.9);       // ângulo medido num trecho maior que a letra (menos ruído)
          var p1 = ponto(pts, acum, dm - lc), p2 = ponto(pts, acum, dm + lc);
          var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          if (angAnt != null) {
            var dif = Math.abs(ang - angAnt); if (dif > Math.PI) dif = 2 * Math.PI - dif;
            giro += dif;
            if (dif > 0.35 || giro > 1.5) return false;   // curva fechada demais: tenta outro lugar
          }
          angAnt = ang;
          var c = ponto(pts, acum, dm);
          if (c.x < 2 || c.y < 2 || c.x > tam.x - 2 || c.y > tam.y - 2) return false;
          var ult = letras[letras.length - 1];
          if (ult && Math.hypot(c.x - ult.x, c.y - ult.y) < 0.8 * (ult.w + w) / 2) return false;   // letras encavaladas
          letras.push({ ch: ch, x: c.x, y: c.y, ang: ang, w: w });
          var r = tamFonte * 0.6;
          caixas.push({ x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r });
          d += w;
        }
        for (var j = 0; j < caixas.length; j++) {
          var q = caixas[j];
          for (var k = 0; k < ocupadas.length; k++) {
            var o = ocupadas[k];
            if (q.x0 < o.x1 && q.x1 > o.x0 && q.y0 < o.y1 && q.y1 > o.y0) return false;
          }
        }
        Array.prototype.push.apply(ocupadas, caixas);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.fillStyle = COR_ROTULO;
        [true, false].forEach(function(halo) {
          letras.forEach(function(l) {
            ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.ang);
            if (halo) ctx.strokeText(l.ch, 0, 0); else ctx.fillText(l.ch, 0, 0);
            ctx.restore();
          });
        });
        return true;
      }
    });
  }

  // Linha da tela reamostrada a cada 3 px e suavizada (média móvel de raio px para cada lado; maior nos nomes longos):
  // o texto acompanha o curso sem se quebrar nas pequenas curvas.
  function suavizar(pts, raio) {
    var r = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], d = a.distanceTo(b), n = Math.floor(d / 3);
      for (var k = 1; k <= n; k++) r.push(L.point(a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n));
      if (!n) r.push(b);
    }
    var jan = Math.max(2, Math.round(raio / 3)), s = r;
    for (var passada = 0; passada < 2; passada++) {          // duas médias móveis (curva bem mais lisa)
      var ent = s, sai = [], sx = 0, sy = 0, a0 = 0, a1 = -1;
      for (var j = 0; j < ent.length; j++) {                 // janela deslizante [j - jan, j + jan]
        var de = Math.max(0, j - jan), ate = Math.min(ent.length - 1, j + jan);
        while (a1 < ate) { a1++; sx += ent[a1].x; sy += ent[a1].y; }
        while (a0 < de) { sx -= ent[a0].x; sy -= ent[a0].y; a0++; }
        sai.push(L.point(sx / (a1 - a0 + 1), sy / (a1 - a0 + 1)));
      }
      s = sai;
    }
    var acum = [0];
    for (var q = 1; q < s.length; q++) acum.push(acum[q - 1] + s[q].distanceTo(s[q - 1]));
    return { pts: s, acum: acum };
  }

  // Paralela à esquerda do sentido da linha (= acima do texto lido nesse sentido), a dist px; devolve { pts, acum }.
  function deslocar(pts, dist) {
    var n = pts.length, out = [], k = 3;
    for (var i = 0; i < n; i++) {
      var a = pts[Math.max(0, i - k)], b = pts[Math.min(n - 1, i + k)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
      out.push(L.point(pts[i].x + dy / len * dist, pts[i].y - dx / len * dist));
    }
    var acum = [0];
    for (var q = 1; q < n; q++) acum.push(acum[q - 1] + out[q].distanceTo(out[q - 1]));
    return { pts: out, acum: acum };
  }

  // Ponto a uma distância d ao longo da polilinha (pts + comprimentos acumulados).
  function ponto(pts, acum, d) {
    if (d <= 0) return pts[0];
    var n = acum.length - 1;
    if (d >= acum[n]) return pts[n];
    var lo = 0, hi = n;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (acum[m] < d) lo = m; else hi = m; }
    var t = (d - acum[lo]) / ((acum[hi] - acum[lo]) || 1);
    return L.point(pts[lo].x + (pts[hi].x - pts[lo].x) * t, pts[lo].y + (pts[hi].y - pts[lo].y) * t);
  }

  // ---------- Camada do mapa ----------
  // Grupo vazio na hora; as linhas e os rótulos entram quando o arquivo chega. Linhas em canvas (são muitas).
  function criarCamada(pane) {
    var grupo = L.layerGroup();
    var renderer = L.canvas({ pane: pane || 'overlayPane', padding: 0.3 });
    var geo = null, rotulos = new RotulosLayer();
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
          grupo.addLayer(rotulos);
        } else if (rotulos._map) rotulos._desenhar();
        restilizar();
      }).catch(function(e) { console.warn(e); });
    });
    grupo.on('remove', function(e) { if (e.target && e.target._map) e.target._map.off('zoomend', restilizar); });
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

  // ---------- Busca por nome ----------
  var listaNomes = null;
  function nomes() {
    if (!dados) return [];
    if (!listaNomes) {
      var vistos = {};
      dados.features.forEach(function(f) { var n = f.properties.nome; if (n) vistos[n] = (vistos[n] || 0) + 1; });
      listaNomes = Object.keys(vistos).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });
    }
    return listaNomes;
  }

  function sugerir(texto, max) {
    var t = normalizar(texto).trim();
    if (!t) return [];
    return nomes().filter(function(n) { return normalizar(n).indexOf(t) >= 0; }).sort(function(a, b) {
      var ca = normalizar(a).indexOf(t) === 0 || normalizar(a).indexOf(' ' + t) >= 0;
      var cb = normalizar(b).indexOf(t) === 0 || normalizar(b).indexOf(' ' + t) >= 0;
      if (ca !== cb) return ca ? -1 : 1;
      return a.localeCompare(b, 'pt-BR');
    }).slice(0, max || 10);
  }

  // Destaca (faixa laranja por baixo) os trechos com o nome; devolve os limites, para aproximar. nome vazio = tira o destaque.
  var destaque = null;
  function destacar(map, nome) {
    if (destaque) { map.removeLayer(destaque); destaque = null; }
    if (!nome || !dados) return null;
    var fs = dados.features.filter(function(f) { return f.properties.nome === nome; });
    if (!fs.length) return null;
    garantirPane(map, 'hidrografiaDestaquePane', 255);   // abaixo da linha azul
    destaque = L.geoJSON({ type: 'FeatureCollection', features: fs }, {
      renderer: L.canvas({ pane: 'hidrografiaDestaquePane' }), interactive: false,
      style: { color: '#ffb020', weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round' }
    }).addTo(map);
    return destaque.getBounds();
  }

  function fmt(n, casas) {
    return n == null || n === '' ? '' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas || 0 });
  }

  var PAPEL = { cruza_rodovia: 'Cruza a rodovia', junto_obra: 'Passa junto a obra', continuidade: 'Continuidade (até 2 km da rodovia ou obra)', continua_fora: 'Segue além da faixa de 2 km' };

  function htmlPopup(p) {
    var linhas = [['Situação', PAPEL[p.papel] || '']];
    if (p.rodovias) linhas.push(['Rodovias', p.rodovias.split(', ').map(function(r) { return /^\d+$/.test(r) ? 'GO-' + r : r; }).join(', ')]);
    if (p.nuareamont != null) linhas.push(['Área de drenagem', fmt(p.nuareamont, 1) + ' km²']);
    if (p.nustrahler != null) linhas.push(['Ordem (Strahler)', fmt(p.nustrahler)]);
    return '<div class="popup-cabecalho"><div class="pc-sup">Hidrografia</div>' +
      '<div class="pc-titulo">' + esc(p.nome || 'Curso d’água sem nome') + '</div></div>' +
      '<div class="popup-hidro">' + linhas.map(function(l) { return '<div><b>' + esc(l[0]) + ':</b> ' + esc(l[1]) + '</div>'; }).join('') + '</div>';
  }

  function htmlLegenda() {
    return '<div class="legenda-item"><svg width="48" height="12" viewBox="0 0 48 12" aria-hidden="true">' +
      '<path d="M0 6 C12 1, 20 11, 32 5 S44 4, 48 6" fill="none" stroke="' + COR + '" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<span>Curso d’água</span></div>';
  }

  return { criarCamada: criarCamada, consultar: consultar, htmlPopup: htmlPopup, htmlLegenda: htmlLegenda, carregar: carregar,
    sugerir: sugerir, destacar: destacar };
})();
