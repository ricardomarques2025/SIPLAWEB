// Filtros no título das colunas (Tabulator headerFilter), usados pelas tabelas de Obras e da Jurisdição.
// Cada coluna ganha um campo logo abaixo do título:
//   - listas (etapa, status, tipo, situação, traçado...): caixa com os valores que existem na tabela + "(vazio)";
//   - números: aceita >10, <5, >=, <=, =, ou um intervalo 10-20 (sem operador, procura o texto);
//   - texto/data: procura as palavras digitadas em qualquer parte (sem diferença de acento e maiúscula).
// O valor filtrado é o que a célula mostra (ler(dados) devolve o valor atual, já com o que está pendente de salvar).
var FiltroCabecalho = (function() {
  var VAZIO = '__vazio__';

  function semAcento(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function vazio(v) { return v === null || v === undefined || String(v).trim() === '' || (Array.isArray(v) && !v.length); }

  // opcoes: { tipo: 'lista'|'numero'|'texto', ler(dados) -> valor, exibir(valor) -> texto, valores: [] ou função,
  //          tabela() -> Tabulator (para listar os valores existentes), semVazio }
  function coluna(opcoes) {
    var ler = opcoes.ler, exibir = opcoes.exibir || function(v) { return vazio(v) ? '' : String(v); };

    if (opcoes.tipo === 'lista') {
      return {
        headerFilter: 'list',
        headerFilterPlaceholder: 'Todos',
        headerFilterParams: {
          valuesLookup: function() {
            var lista = typeof opcoes.valores === 'function' ? opcoes.valores() : opcoes.valores;
            if (!lista) {   // sem lista fixa: os valores que aparecem na tabela
              var vistos = {};
              lista = [];
              (opcoes.tabela() ? opcoes.tabela().getData() : []).forEach(function(d) {
                var t = exibir(ler(d));
                if (t && !vistos[t]) { vistos[t] = 1; lista.push(t); }
              });
              lista.sort(function(a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
            }
            return [{ label: '(todos)', value: '' }].concat(opcoes.semVazio ? [] : [{ label: '(vazio)', value: VAZIO }]).concat(lista.map(function(v) {
              return typeof v === 'object' ? v : { label: String(v), value: String(v) };
            }));
          },
          autocomplete: true, listOnEmpty: true, allowEmpty: true, clearable: true
        },
        headerFilterFunc: function(h, valorLinha, dados) {
          if (h === '' || h == null) return true;
          var v = ler(dados);
          if (h === VAZIO) return vazio(v);
          return exibir(v) === h || String(v) === h;
        }
      };
    }

    if (opcoes.tipo === 'numero') {
      return {
        headerFilter: 'input',
        headerFilterPlaceholder: '>, <, a-b…',
        headerFilterFunc: function(h, valorLinha, dados) {
          var t = String(h || '').trim().replace(/\s+/g, '');
          if (!t) return true;
          var v = ler(dados);
          var num = vazio(v) ? null : Number(v);
          var n = function(s) { return Number(String(s).replace(/\./g, '').replace(',', '.')); };
          var m = t.match(/^(>=|<=|>|<|=)(-?[\d.,]+)$/);
          if (m) {
            if (num === null || isNaN(num)) return false;
            var x = n(m[2]);
            return m[1] === '>' ? num > x : m[1] === '<' ? num < x : m[1] === '>=' ? num >= x : m[1] === '<=' ? num <= x : num === x;
          }
          m = t.match(/^(-?[\d.,]+)-(-?[\d.,]+)$/);
          if (m) return num !== null && !isNaN(num) && num >= n(m[1]) && num <= n(m[2]);
          if (t === '-' || semAcento(t) === '(vazio)') return num === null;
          return semAcento(exibir(v)).indexOf(semAcento(t)) !== -1;
        }
      };
    }

    return {
      headerFilter: 'input',
      headerFilterPlaceholder: 'Filtrar…',
      headerFilterFunc: function(h, valorLinha, dados) {
        var t = semAcento(String(h || '').trim());
        if (!t) return true;
        if (t === '(vazio)') return vazio(ler(dados));
        var alvo = semAcento(exibir(ler(dados)));
        return t.split(/\s+/).every(function(p) { return alvo.indexOf(p) !== -1; });
      }
    };
  }

  return { coluna: coluna, VAZIO: VAZIO };
})();
