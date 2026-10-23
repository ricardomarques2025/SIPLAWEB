// Central de Ajuda (ajuda.html). Os artigos sao os <article> da pagina (data-cat = grupo do indice, data-titulo,
// data-termos = sinonimos para a pesquisa, data-rel = artigos relacionados). Este script monta o indice, abre o
// artigo pelo endereco (#id; #g-xxx abre o glossario no termo; #busca/termo abre uma pesquisa) e faz a pesquisa
// sem diferenciar maiusculas nem acentos. Para incluir um assunto novo basta acrescentar um <article> no HTML.
(function() {
  'use strict';
  var $ = function(id) { return document.getElementById(id); };
  var artigos = Array.prototype.slice.call(document.querySelectorAll('#ajArtigos > article'));
  var porId = {};
  var atual = null;
  var termosMarcados = [];
  var selecionado = -1;

  // Sem acento e minusculo, letra por letra (o texto normalizado tem o mesmo tamanho do original, o que permite
  // achar o trecho original a partir da posicao encontrada).
  function normalizar(s) {
    var r = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      r += c.length === 1 ? c : s[i].toLowerCase().charAt(0);
    }
    return r;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function palavras(q) {
    return normalizar(q).split(/[^a-z0-9_.\-]+/).filter(function(p) { return p.length > 1 || /\d/.test(p); });
  }

  // Texto do artigo com espaco entre blocos (paragrafos, itens, celulas), para os trechos dos resultados nao
  // juntarem palavras de linhas diferentes.
  function ehBloco(el) { return getComputedStyle(el).display.indexOf('inline') !== 0; }
  function textoCorrido(raiz) {
    var partes = [], ultimo = null;
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var no = w.currentNode, bloco = no.parentNode;
      while (bloco !== raiz && !ehBloco(bloco)) bloco = bloco.parentNode;
      partes.push((ultimo && bloco !== ultimo ? ' ' : '') + no.nodeValue);
      ultimo = bloco;
    }
    return partes.join('').replace(/\s+/g, ' ').trim();
  }

  // ---------- Preparacao: ids dos subtitulos, trilha e indice de pesquisa ----------
  artigos.forEach(function(a) {
    porId[a.id] = a;
    a.hidden = true;
    a.querySelectorAll('h2').forEach(function(h, i) { if (!h.id) h.id = a.id + '--' + (i + 1); });
    var texto = textoCorrido(a);
    var trilha = document.createElement('div');
    trilha.className = 'aj-trilha';
    trilha.innerHTML = '<a href="#inicio">Ajuda</a> › ' + esc(a.dataset.cat);
    if (a.id !== 'inicio') a.insertBefore(trilha, a.firstChild);
    a._busca = {
      titulo: normalizar(a.dataset.titulo || ''),
      termos: normalizar(a.dataset.termos || ''),
      subtitulos: normalizar(Array.prototype.map.call(a.querySelectorAll('h2, dt'), function(h) { return h.textContent; }).join(' | ')),
      texto: texto,
      textoN: normalizar(texto)
    };
  });

  // Indice lateral, na ordem dos artigos, agrupado por data-cat.
  (function montarIndice() {
    var html = '', cat = null;
    artigos.forEach(function(a) {
      if (a.dataset.cat !== cat) {
        if (cat !== null) html += '</div>';
        cat = a.dataset.cat;
        html += '<div class="cat"><span class="cat-titulo">' + esc(cat) + '</span>';
      }
      html += '<a href="#' + a.id + '" data-id="' + a.id + '">' + esc(a.dataset.titulo) + '</a>';
    });
    $('ajIndice').innerHTML = html + '</div>';
  })();

  // ---------- Abrir artigo ----------
  function abrir(id, alvo, termos) {
    var a = porId[id] || porId.inicio;
    limparMarcas();
    $('ajResultados').hidden = true;
    $('ajArtigos').hidden = false;
    $('ajRodapeArtigo').hidden = false;
    if (atual !== a) {
      artigos.forEach(function(x) { x.hidden = x !== a; });
      atual = a;
      document.title = (a.id === 'inicio' ? 'Central de Ajuda' : a.dataset.titulo + ' · Ajuda') + ' · Plano GOINFRA';
      document.querySelectorAll('#ajIndice a').forEach(function(l) { l.classList.toggle('ativo', l.dataset.id === a.id); });
      var ativo = document.querySelector('#ajIndice a.ativo');
      if (ativo && ativo.scrollIntoView) ativo.scrollIntoView({ block: 'nearest' });
      montarNesta(a);
      montarRodape(a);
    }
    document.body.classList.remove('indice-aberto');
    if (termos && termos.length) marcar(a, termos);
    var destino = alvo && document.getElementById(alvo);
    var primeiraMarca = termos && termos.length && a.querySelector('mark.aj-marca-busca');
    if (destino) destino.scrollIntoView({ block: 'start' });
    else if (primeiraMarca) primeiraMarca.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, 0);
  }

  function montarNesta(a) {
    var hs = a.querySelectorAll('h2');
    if (hs.length < 2) { $('ajNesta').innerHTML = ''; return; }
    $('ajNesta').innerHTML = '<h3>Nesta página</h3>' + Array.prototype.map.call(hs, function(h) {
      return '<a href="#' + a.id + '/' + h.id + '" data-h="' + h.id + '">' + esc(h.textContent) + '</a>';
    }).join('');
  }

  function montarRodape(a) {
    var i = artigos.indexOf(a);
    var rel = (a.dataset.rel || '').split(/\s+/).filter(function(id) { return porId[id]; });
    var html = '';
    if (rel.length) {
      html += '<div class="aj-relacionados"><h3>Veja também</h3>' + rel.map(function(id) {
        return '<a href="#' + id + '">' + esc(porId[id].dataset.titulo) + '</a>';
      }).join('') + '</div>';
    }
    var ant = artigos[i - 1], prox = artigos[i + 1];
    html += '<div class="aj-navegar">' +
      (ant ? '<a class="ant" href="#' + ant.id + '"><small>← Anterior</small>' + esc(ant.dataset.titulo) + '</a>' : '') +
      (prox ? '<a class="prox" href="#' + prox.id + '"><small>Próximo →</small>' + esc(prox.dataset.titulo) + '</a>' : '') +
      '</div><div class="aj-acoes"><button type="button" data-acao="imprimir">Imprimir este artigo</button>' +
      '<button type="button" data-acao="link">Copiar link deste artigo</button></div>';
    $('ajRodapeArtigo').innerHTML = html;
  }

  $('ajRodapeArtigo').addEventListener('click', function(e) {
    var b = e.target.closest('button[data-acao]');
    if (!b) return;
    if (b.dataset.acao === 'imprimir') window.print();
    else {
      var url = location.href.split('#')[0] + '#' + atual.id;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function() {
        b.textContent = 'Link copiado';
        setTimeout(function() { b.textContent = 'Copiar link deste artigo'; }, 1800);
      }, function() { prompt('Copie o link:', url); });
    }
  });

  // ---------- Marcar os termos pesquisados dentro do artigo ----------
  function marcar(raiz, termos) {
    var walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n) { return n.parentNode.closest('.aj-trilha') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var nos = [];
    while (walker.nextNode()) nos.push(walker.currentNode);
    nos.forEach(function(no) {
      var trechos = intervalos(normalizar(no.nodeValue), termos);
      if (!trechos.length) return;
      var frag = document.createDocumentFragment(), pos = 0, s = no.nodeValue;
      trechos.forEach(function(t) {
        if (t[0] > pos) frag.appendChild(document.createTextNode(s.slice(pos, t[0])));
        var m = document.createElement('mark');
        m.className = 'aj-marca-busca';
        m.textContent = s.slice(t[0], t[1]);
        frag.appendChild(m);
        pos = t[1];
      });
      if (pos < s.length) frag.appendChild(document.createTextNode(s.slice(pos)));
      no.parentNode.replaceChild(frag, no);
    });
    termosMarcados = termos;
  }
  function limparMarcas() {
    if (!termosMarcados.length) return;
    document.querySelectorAll('mark.aj-marca-busca').forEach(function(m) {
      var p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    termosMarcados = [];
  }
  // Intervalos [inicio, fim] de todas as ocorrencias dos termos num texto ja normalizado, sem sobreposicao.
  function intervalos(textoN, termos) {
    var r = [];
    termos.forEach(function(t) {
      var i = textoN.indexOf(t);
      while (i !== -1) { r.push([i, i + t.length]); i = textoN.indexOf(t, i + t.length); }
    });
    r.sort(function(a, b) { return a[0] - b[0]; });
    return r.filter(function(t, k) { return k === 0 || t[0] >= r[k - 1][1]; });
  }

  // ---------- Pesquisa ----------
  function pontuar(a, termos, todos) {
    var b = a._busca, total = 0, achou = 0;
    termos.forEach(function(t) {
      var p = 0;
      if (b.titulo.indexOf(t) !== -1) p += 12;
      if (b.termos.indexOf(t) !== -1) p += 7;
      if (b.subtitulos.indexOf(t) !== -1) p += 4;
      var n = 0, i = b.textoN.indexOf(t);
      while (i !== -1 && n < 8) { n++; i = b.textoN.indexOf(t, i + t.length); }
      p += n;
      if (p) achou++;
      total += p;
    });
    if (todos && achou < termos.length) return 0;
    return total + (achou === termos.length ? 5 : 0);
  }

  // Trecho do artigo em volta da primeira ocorrencia, com os termos destacados.
  function trecho(a, termos) {
    var b = a._busca, ini = -1;
    termos.forEach(function(t) { var i = b.textoN.indexOf(t); if (i !== -1 && (ini === -1 || i < ini)) ini = i; });
    if (ini === -1) return esc(b.texto.slice(0, 160)) + '…';
    var de = Math.max(0, ini - 70), ate = Math.min(b.texto.length, ini + 150);
    while (de > 0 && b.texto[de - 1] !== ' ') de--;
    var original = b.texto.slice(de, ate), html = '', pos = 0;
    intervalos(b.textoN.slice(de, ate), termos).forEach(function(t) {
      html += esc(original.slice(pos, t[0])) + '<mark class="aj-marca-busca">' + esc(original.slice(t[0], t[1])) + '</mark>';
      pos = t[1];
    });
    return (de > 0 ? '…' : '') + html + esc(original.slice(pos)) + (ate < b.texto.length ? '…' : '');
  }

  function pesquisar(q) {
    var termos = palavras(q);
    if (!termos.length) { fecharPesquisa(); return; }
    limparMarcas();
    var lista = artigos.map(function(a) { return { a: a, p: pontuar(a, termos, true) }; }).filter(function(x) { return x.p > 0; });
    var aproximado = false;
    if (!lista.length) {
      lista = artigos.map(function(a) { return { a: a, p: pontuar(a, termos, false) }; }).filter(function(x) { return x.p > 0; });
      aproximado = lista.length > 0;
    }
    lista.sort(function(x, y) { return y.p - x.p; });
    var chave = encodeURIComponent(termos.join(' '));
    var html = '<h1>Resultados para “' + esc(q.trim()) + '”</h1>';
    if (!lista.length) {
      html += '<div class="aj-vazio"><p>Nada encontrado. Tente:</p><ul><li>uma palavra só (ex.: <b>caderno</b>, <b>exportar</b>, <b>trâmite</b>);</li>' +
        '<li>um sinônimo (ex.: <b>PDF</b> em vez de <b>imprimir</b>);</li><li>o <a href="#glossario">Glossário</a> ou a <a href="#problemas">Solução de problemas</a>.</li></ul></div>';
    } else {
      html += '<p class="resumo">' + lista.length + (lista.length === 1 ? ' artigo' : ' artigos') +
        (aproximado ? ' com parte das palavras (nenhum tem todas)' : '') + '</p>' +
        lista.map(function(x) {
          return '<a class="aj-res" href="#' + x.a.id + '" data-id="' + x.a.id + '" data-q="' + chave + '"><span class="t">' + esc(x.a.dataset.titulo) +
            '</span><span class="c">' + esc(x.a.dataset.cat) + '</span><span class="s">' + trecho(x.a, termos) + '</span></a>';
        }).join('');
    }
    $('ajResultados').innerHTML = html;
    $('ajResultados').hidden = false;
    $('ajArtigos').hidden = true;
    $('ajRodapeArtigo').hidden = true;
    $('ajNesta').innerHTML = '';
    document.querySelectorAll('#ajIndice a.ativo').forEach(function(l) { l.classList.remove('ativo'); });
    selecionado = -1;
    document.title = 'Pesquisa: ' + q.trim() + ' · Ajuda';
    window.scrollTo(0, 0);
  }

  function fecharPesquisa() {
    $('ajResultados').hidden = true;
    var a = atual; atual = null;
    abrir(a ? a.id : 'inicio');
  }

  // Ao clicar num resultado, abre o artigo com os termos destacados.
  $('ajResultados').addEventListener('click', function(e) {
    var r = e.target.closest('.aj-res');
    if (!r) return;
    e.preventDefault();
    var termos = decodeURIComponent(r.dataset.q).split(' ');
    history.pushState(null, '', '#' + r.dataset.id);
    atual = null;
    abrir(r.dataset.id, null, termos);
  });

  var espera = null;
  $('ajBusca').addEventListener('input', function() {
    clearTimeout(espera);
    var q = this.value;
    espera = setTimeout(function() {
      if (palavras(q).length) history.replaceState(null, '', '#busca/' + encodeURIComponent(q.trim()));
      else history.replaceState(null, '', '#' + (atual ? atual.id : 'inicio'));
      pesquisar(q);
    }, 140);
  });
  $('ajBusca').addEventListener('keydown', function(e) {
    var res = document.querySelectorAll('#ajResultados:not([hidden]) .aj-res');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!res.length) return;
      e.preventDefault();
      selecionado = (selecionado + (e.key === 'ArrowDown' ? 1 : -1) + res.length) % res.length;
      res.forEach(function(r, i) { r.classList.toggle('sel', i === selecionado); });
      res[selecionado].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      var alvo = res[selecionado] || res[0];
      if (alvo) { e.preventDefault(); alvo.click(); this.blur(); }
    } else if (e.key === 'Escape') {
      this.value = '';
      fecharPesquisa();
      history.replaceState(null, '', '#' + (atual ? atual.id : 'inicio'));
    }
  });

  // "/" ou Ctrl+K levam para a pesquisa (fora de campos de texto).
  document.addEventListener('keydown', function(e) {
    var emCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.key === '/' && !emCampo) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      $('ajBusca').focus();
      $('ajBusca').select();
    }
  });

  // ---------- Endereco (#id, #id/subtitulo, #g-termo, #busca/termo) ----------
  function rota() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h.indexOf('busca/') === 0) {
      $('ajBusca').value = h.slice(6);
      pesquisar(h.slice(6));
      return;
    }
    var partes = h.split('/');
    var id = partes[0], alvo = partes[1];
    if (!porId[id]) {
      var el = id && document.getElementById(id);
      var dono = el && el.closest('#ajArtigos > article');
      if (dono) { alvo = id; id = dono.id; } else id = 'inicio';
    }
    $('ajBusca').value = '';
    abrir(id, alvo);
  }
  window.addEventListener('hashchange', rota);

  // "Nesta pagina": destaca o subtitulo visivel.
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function(entradas) {
      entradas.forEach(function(en) {
        if (!en.isIntersecting) return;
        document.querySelectorAll('#ajNesta a').forEach(function(l) { l.classList.toggle('ativo', l.dataset.h === en.target.id); });
      });
    }, { rootMargin: '-80px 0px -65% 0px' });
    document.querySelectorAll('#ajArtigos h2').forEach(function(h) { obs.observe(h); });
  }

  $('ajMenuBtn').addEventListener('click', function() { document.body.classList.toggle('indice-aberto'); });

  rota();
})();
