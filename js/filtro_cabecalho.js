// Filtros no título das colunas, como o filtro do Excel (Tabulator headerFilter com editor próprio), usados pelas
// tabelas de Obras e da Jurisdição. Cada coluna ganha um ícone de funil logo abaixo do título (cheio = filtrando);
// ele abre uma lista com os valores da coluna, caixas de marcar, "(Selecionar tudo)", "(Vazias)" e uma busca.
// O valor do filtro é a lista dos valores marcados (texto como a célula mostra; VAZIO = células vazias);
// '' = sem filtro. ler(dados) devolve o valor atual da célula (já com o que está pendente de salvar).
var FiltroCabecalho = (function() {
  var VAZIO = '__vazio__';
  var aberto = null;   // popup aberto (um só por vez)

  function semAcento(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function vazio(v) { return v === null || v === undefined || String(v).trim() === '' || (Array.isArray(v) && !v.length); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function fecharAberto() {
    if (!aberto) return;
    document.removeEventListener('mousedown', aberto.fora, true);
    aberto.el.remove();
    aberto = null;
  }

  // itens: [{ valor, rotulo }]; marcados: lista de valores ou null (todos); aoAplicar(lista ou null)
  function abrirPopup(botao, itens, marcados, aoAplicar) {
    fecharAberto();
    var el = document.createElement('div');
    el.className = 'filtro-excel';
    el.innerHTML = '<input type="search" class="fe-busca" placeholder="Pesquisar" autocomplete="off">' +
      '<label class="fe-item fe-tudo"><input type="checkbox"><span>(Selecionar tudo)</span></label>' +
      '<div class="fe-lista">' + itens.map(function(it, i) {
        var marcado = !marcados || marcados.indexOf(it.valor) !== -1;
        return '<label class="fe-item" data-i="' + i + '"><input type="checkbox"' + (marcado ? ' checked' : '') + '><span>' + esc(it.rotulo) + '</span></label>';
      }).join('') + '</div>' +
      '<div class="fe-rodape"><button type="button" class="fe-limpar">Limpar</button><span class="fe-espaco"></span>' +
      '<button type="button" class="fe-ok">OK</button><button type="button" class="fe-cancelar">Cancelar</button></div>';
    document.body.appendChild(el);

    var r = botao.getBoundingClientRect();
    var larg = Math.max(230, r.width);
    el.style.width = larg + 'px';
    el.style.left = Math.max(4, Math.min(r.left, window.innerWidth - larg - 8)) + 'px';
    var alt = el.offsetHeight;
    el.style.top = (r.bottom + alt + 4 < window.innerHeight ? r.bottom + 2 : Math.max(4, r.top - alt - 2)) + 'px';

    var busca = el.querySelector('.fe-busca'), tudo = el.querySelector('.fe-tudo input');
    var linhas = Array.prototype.slice.call(el.querySelectorAll('.fe-lista .fe-item'));
    var visiveis = function() { return linhas.filter(function(l) { return !l.hidden; }); };
    function atualizarTudo() {
      var v = visiveis(), n = v.filter(function(l) { return l.querySelector('input').checked; }).length;
      tudo.checked = v.length > 0 && n === v.length;
      tudo.indeterminate = n > 0 && n < v.length;
    }
    busca.addEventListener('input', function() {
      var t = semAcento(busca.value.trim());
      linhas.forEach(function(l) {
        var ok = !t || semAcento(itens[l.dataset.i].rotulo).indexOf(t) !== -1;
        l.hidden = !ok;
        if (t) l.querySelector('input').checked = ok;   // como no Excel: com busca, marca só o que aparece
      });
      atualizarTudo();
    });
    tudo.addEventListener('change', function() {
      visiveis().forEach(function(l) { l.querySelector('input').checked = tudo.checked; });
      tudo.indeterminate = false;
    });
    el.querySelector('.fe-lista').addEventListener('change', atualizarTudo);
    function aplicar() {
      var sel = linhas.filter(function(l) { return !l.hidden && l.querySelector('input').checked; })
        .map(function(l) { return itens[l.dataset.i].valor; });
      fecharAberto();
      aoAplicar(sel.length === itens.length ? null : sel);
    }
    el.querySelector('.fe-ok').addEventListener('click', aplicar);
    el.querySelector('.fe-cancelar').addEventListener('click', fecharAberto);
    el.querySelector('.fe-limpar').addEventListener('click', function() { fecharAberto(); aoAplicar(null); });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') fecharAberto();
      else if (e.key === 'Enter') { e.preventDefault(); aplicar(); }
    });
    var fora = function(e) { if (!el.contains(e.target) && !botao.contains(e.target)) fecharAberto(); };
    document.addEventListener('mousedown', fora, true);
    aberto = { el: el, fora: fora, botao: botao };
    atualizarTudo();
    busca.focus();
  }

  // opcoes: { ler(dados) -> valor, exibir(valor) -> texto, valores: [] | [{valor, rotulo}] | função (lista fixa),
  //           tabela() -> Tabulator (valores que existem na tabela), ordemNumerica, semVazio,
  //           filtrar: false (o filtro não age na tabela; quem usa decide, ex.: filtros do módulo Jurisdição) }
  function coluna(opcoes) {
    var ler = opcoes.ler, exibir = opcoes.exibir || function(v) { return vazio(v) ? '' : String(v); };
    var chave = function(v) { return vazio(v) ? VAZIO : exibir(v); };

    function itens() {
      var fixos = typeof opcoes.valores === 'function' ? opcoes.valores() : opcoes.valores;
      var lista, temVazio = false;
      var dados = opcoes.tabela && opcoes.tabela() ? opcoes.tabela().getData() : [];
      if (fixos && fixos.length) {
        // como no Excel: só os valores que existem na tabela, na ordem da lista fixa (os fora da lista vão no fim)
        var existe = {};
        dados.forEach(function(d) { var v = ler(d); if (vazio(v)) temVazio = true; else existe[chave(v)] = 1; });
        lista = fixos.map(function(v) { return typeof v === 'object' ? v : { valor: String(v), rotulo: String(v) }; });
        var naLista = {};
        lista.forEach(function(i) { naLista[i.valor] = 1; });
        lista = lista.filter(function(i) { return existe[i.valor] || opcoes.semVazio; })
          .concat(Object.keys(existe).filter(function(k) { return !naLista[k]; }).sort(function(a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); })
            .map(function(k) { return { valor: k, rotulo: k }; }));
      } else {
        var vistos = {}, brutos = [];
        dados.forEach(function(d) {
          var v = ler(d);
          if (vazio(v)) { temVazio = true; return; }
          var t = exibir(v);
          if (!vistos[t]) { vistos[t] = 1; brutos.push({ valor: t, rotulo: t, num: Number(v) }); }
        });
        brutos.sort(opcoes.ordemNumerica
          ? function(a, b) { return a.num - b.num; }
          : function(a, b) { return a.rotulo.localeCompare(b.rotulo, 'pt-BR', { numeric: true, sensitivity: 'base' }); });
        lista = brutos;
      }
      if (temVazio && !opcoes.semVazio) lista = lista.concat([{ valor: VAZIO, rotulo: '(Vazias)' }]);
      return lista;
    }

    function editor(cell, onRendered, success) {
      var botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'filtro-excel-botao';
      var sel = Array.isArray(cell.getValue()) ? cell.getValue() : null;
      function rotulo() {
        var t = !sel ? 'Todos' : !sel.length ? 'Nenhum'
          : sel.length === 1 ? (sel[0] === VAZIO ? '(Vazias)' : (itens().find(function(i) { return i.valor === sel[0]; }) || { rotulo: sel[0] }).rotulo)
          : sel.length + ' selecionados';
        // só o ícone (funil): contorno = sem filtro; cheio e azul = filtrando (o valor fica na dica do mouse)
        botao.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 3h12l-4.6 5.4v4.4l-2.8 1.4V8.4z"/></svg>';
        botao.classList.toggle('ativo', !!sel);
        botao.title = sel ? 'Filtrando: ' + t : 'Filtrar esta coluna';
        botao.setAttribute('aria-label', botao.title);
      }
      rotulo();
      botao.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      botao.addEventListener('click', function(e) {
        e.stopPropagation();
        if (aberto && aberto.botao === botao) { fecharAberto(); return; }
        abrirPopup(botao, itens(), sel, function(novo) { sel = novo; rotulo(); success(sel ? sel.slice() : ''); });
      });
      return botao;
    }

    return {
      headerFilter: editor,
      headerFilterLiveFilter: false,
      headerFilterEmptyCheck: function(v) { return v === '' || v == null; },
      headerFilterFunc: function(h, valorLinha, dados) {
        if (opcoes.filtrar === false || !Array.isArray(h)) return true;
        return h.indexOf(chave(ler(dados))) !== -1;
      }
    };
  }

  return { coluna: coluna, VAZIO: VAZIO, fechar: fecharAberto };
})();
