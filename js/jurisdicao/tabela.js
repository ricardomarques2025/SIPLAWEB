// Grade de dados (planilha) do modulo Jurisdicao, baseada no Tabulator (vinda do site do jurisdicao).
// Clique seleciona a linha · duplo clique edita a celula · icone da 1a coluna abre os detalhes.
// A edicao fica pendente (amarelo) ate "Revisar e salvar/enviar" (js/jurisdicao/store.js); a celula mostra o valor pendente.

const Tabela = (function() {
  let grade = null;
  let aoSelecionar = function() {};
  let aoAbrir = function() {};
  let aoVerMapa = function() {};
  let aoFiltrar = function() {};
  let aoFiltroCabecalho = function() {};
  // Tipo, situação e traçado: o filtro do título é o mesmo filtro do mapa e do painel de indicadores (Jurisdicao.filtros);
  // os demais campos filtram só a tabela.
  const GLOBAIS = { tipo: 'tipo', situacao: 'situacao', _geo: 'geo' };
  const ultimoCabecalho = { tipo: '""', situacao: '""', _geo: '""' };   // JSON do último valor visto no título   // só mudança feita no título vira filtro do módulo
  const CHAVE_COLUNAS = 'jurisdicao.colunasOcultas';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Cada formatador recebe o valor atual (pendente ou gravado) e o campo.
  const formatadores = {
    texto: function(v) {
      return esc(v);
    },
    numero: function(v, campo) {
      if (v == null || v === '') return '';
      const n = Number(v);
      return '<span class="num">' + (campo === 'extensao_km'
        ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : esc(v)) + '</span>';
    },
    tipo: function(v) {
      if (!v) return '';
      const cor = (TIPOS[v] || {}).cor || '#9ca3af';
      return '<span class="tipo" style="--c:' + cor + '"><i></i>' + esc(v) + '</span>';
    },
    situacao: function(v) {
      if (!v) return '';
      const cor = (SITUACOES[v] || {}).cor || '#6b7280';
      return '<span class="badge" style="--c:' + cor + '">' + esc(v) + '</span>';
    },
    doc: function(v) {
      const s = statusDoc(v);
      if (s === 'vazio') return '<span class="doc doc-vazio">—</span>';
      return '<span class="doc doc-' + s + '">' + Indicadores.iconeDoc(s, 15) + '<span class="doc-txt">' + esc(Indicadores.textoDoc(v)) + '</span></span>';
    }
  };

  function comPendencia(fmt) {
    return function(cell) {
      const id = cell.getRow().getData().id, campo = cell.getField();
      cell.getElement().classList.toggle('celula-editada', Store.pendente(id, campo));
      return fmt(Store.valorAtual(id, campo), campo);
    };
  }

  // Leitores veem a planilha sem editores (o banco tambem recusaria a gravacao).
  function editorDe(c) {
    if (c.somenteLeitura) return {};
    const pode = { editable: () => Store.podeEditar() };
    if (c.tipo === 'lista') return Object.assign(pode, { editor: 'list', editorParams: { values: c.opcoes } });
    if (c.tipo === 'doc') return Object.assign(pode, { editor: 'list', editorParams: { values: OPCOES_DOC, autocomplete: true, freetext: true, allowEmpty: true, listOnEmpty: true } });
    if (c.tipo === 'numero') return Object.assign(pode, { editor: 'number', editorParams: { step: 0.01 } });
    if (c.tipo === 'longo') return Object.assign(pode, { editor: 'textarea', editorParams: { verticalNavigation: 'hybrid' } });
    return Object.assign(pode, { editor: 'input' });
  }

  // Filtro no título da coluna (js/filtro_cabecalho.js), pelo valor atual (com o que está pendente).
  function filtroColuna(c) {
    return FiltroCabecalho.coluna({
      ordemNumerica: c.tipo === 'numero',
      ler: d => Store.valorAtual(d.id, c.campo),
      exibir: c.tipo === 'doc' ? (v => v == null || v === '' ? '' : Indicadores.textoDoc(v))
        : c.campo === 'extensao_km' ? (v => v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        : undefined,
      valores: c.tipo === 'lista' && c.opcoes ? c.opcoes : null,
      tabela: () => grade
    });
  }

  // Filtro do título (lista de valores marcados) -> filtro do módulo (um valor só): marcado um valor, o mapa e os
  // indicadores acompanham; vários ou todos, o módulo fica sem esse filtro e só a tabela filtra.
  function globalDe(v) { return Array.isArray(v) && v.length === 1 && v[0] !== FiltroCabecalho.VAZIO ? v[0] : ''; }

  // Filtro do mapa mudou (painel de indicadores, mapa, Limpar): o título das colunas acompanha.
  function sincronizarCabecalho(f) {
    if (!grade) return;
    Object.keys(GLOBAIS).forEach(function(campo) {
      const atual = grade.getHeaderFilterValue(campo);
      const alvo = f[GLOBAIS[campo]] || '';
      if (globalDe(atual) === alvo) return;
      const novo = alvo ? [alvo] : '';
      ultimoCabecalho[campo] = JSON.stringify(novo);
      grade.setHeaderFilterValue(campo, novo);
    });
  }

  function limparCabecalho() {
    if (!grade) return;
    Object.keys(ultimoCabecalho).forEach(function(k) { ultimoCabecalho[k] = '""'; });
    grade.clearHeaderFilter();
  }

  function colunas() {
    const ocultas = lerOcultas();
    const cols = [{
      title: '', field: '_abrir', width: 40, headerSort: false, frozen: true, hozAlign: 'center', cssClass: 'col-acao',
      formatter: cell => Store.propostaPendente(cell.getRow().getData().id) ? '<span class="obr-relogio" title="Proposta aguardando aprovação">◷</span>'
        : '<svg style="color:#8a93a3"><use href="#i-split"/></svg>',
      cellClick: function(e, cell) { e.stopPropagation(); aoAbrir(cell.getRow().getData().id); }
    }, Object.assign({
      title: '', field: '_geo', width: 88, headerSort: false, frozen: true, hozAlign: 'center', cssClass: 'col-acao', headerTooltip: 'Traçado',
    }, FiltroCabecalho.coluna({
      ler: d => Store.geometria(d.id) ? 'com' : 'sem', exibir: v => v, semVazio: true,
      valores: [{ valor: 'com', rotulo: 'Com traçado' }, { valor: 'sem', rotulo: 'Sem traçado' }], tabela: () => grade
    }), {
      formatter: function(cell) {
        const temGeo = !!Store.geometria(cell.getRow().getData().id);
        return '<svg class="' + (temGeo ? 'geo-ok' : 'geo-sem') + '"><use href="#i-pin"/></svg>';
      },
      tooltip: cell => Store.geometria(cell.getRow().getData().id) ? 'Ver no mapa' : 'Sem traçado',
      cellClick: function(e, cell) { e.stopPropagation(); aoVerMapa(cell.getRow().getData().id); }
    })];

    CAMPOS.forEach(function(c) {
      const formatter = c.campo === 'tipo' ? formatadores.tipo
        : c.campo === 'situacao' ? formatadores.situacao
        : c.tipo === 'doc' ? formatadores.doc
        : c.tipo === 'numero' ? formatadores.numero
        : formatadores.texto;
      cols.push(Object.assign({
        title: c.titulo,
        field: c.campo,
        width: c.largura,
        frozen: !!c.fixa,
        visible: ocultas ? !ocultas.includes(c.campo) : !c.oculta,
        formatter: comPendencia(formatter),
        hozAlign: c.tipo === 'numero' ? 'right' : 'left',
        sorter: c.tipo === 'numero' ? 'number' : 'string',
        headerTooltip: c.titulo,
        tooltip: (c.tipo === 'longo' || c.tipo === 'doc' || c.tipo === 'texto')
          ? function(e, cell) { return cell.getValue() || ''; } : false,
        bottomCalc: c.campo === 'extensao_km' ? 'sum' : (c.campo === 'codigo' ? 'count' : undefined),
        bottomCalcFormatter: c.campo === 'extensao_km'
          ? cell => '<b class="num">' + Number(cell.getValue() || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</b>'
          : undefined
      }, filtroColuna(c), editorDe(c)));
    });
    return cols;
  }

  function iniciar(opcoes) {
    aoSelecionar = opcoes.aoSelecionar || aoSelecionar;
    aoAbrir = opcoes.aoAbrir || aoAbrir;
    aoVerMapa = opcoes.aoVerMapa || aoVerMapa;
    aoFiltrar = opcoes.aoFiltrar || aoFiltrar;
    aoFiltroCabecalho = opcoes.aoFiltroCabecalho || aoFiltroCabecalho;

    grade = new Tabulator('#jurGrade', {
      data: Store.lista(),
      index: 'id',
      height: '100%',
      layout: 'fitDataFill',
      columns: colunas(),
      initialSort: [{ column: 'codigo', dir: 'asc' }],
      selectableRows: 1,
      editTriggerEvent: 'dblclick',
      movableColumns: true,
      placeholder: 'Nenhum registro encontrado com os filtros atuais',
      columnDefaults: { headerHozAlign: 'left', resizable: true },
      rowHeader: false,
      rowFormatter: row => row.getElement().classList.toggle('em-aprovacao', !!Store.propostaPendente(row.getData().id))
    });

    grade.on('rowClick', function(e, row) {
      grade.deselectRow();
      row.select();
      aoSelecionar(row.getData().id, 'tabela');
    });
    grade.on('rowDblClick', function() { /* duplo clique fica para a edicao */ });
    grade.on('cellEdited', function(cell) {
      const c = CAMPOS.find(x => x.campo === cell.getField());
      let v = cell.getValue();
      if (c && c.tipo === 'numero') v = v === '' || v == null ? null : Number(String(v).replace(',', '.'));
      if (typeof v === 'string') v = v.trim();
      Store.atualizar(cell.getRow().getData().id, cell.getField(), v);   // emite 'pendentes' -> atualizarLinha
    });
    // Mudou no título o filtro de tipo, situação ou traçado: vira o filtro do módulo (mapa + indicadores + tabela).
    grade.on('dataFiltering', function() {
      Object.keys(GLOBAIS).forEach(function(campo) {
        const v = grade.getHeaderFilterValue(campo) || '';
        const s = JSON.stringify(v);
        if (s === ultimoCabecalho[campo]) return;
        ultimoCabecalho[campo] = s;
        const g = globalDe(v);
        if (g !== (Jurisdicao.filtros()[GLOBAIS[campo]] || '')) setTimeout(() => aoFiltroCabecalho(GLOBAIS[campo], g), 0);
      });
    });
    grade.on('dataFiltered', function(filtros, linhas) {
      aoFiltrar(linhas.map(r => r.getData().id));
    });
    return new Promise(resolve => grade.on('tableBuilt', resolve));
  }

  function aplicarFiltro(fn) {
    grade.setFilter(function(dados) { return fn(dados); });
  }

  function idsFiltrados() {
    return grade.getData('active').map(r => r.id);
  }

  function dadosFiltrados() {
    return grade.getData('active');
  }

  // adiar = true (edição na própria tabela): atualiza a linha só depois que o Tabulator termina o Tab/Enter. Mexer na
  // linha na hora trocava as células enquanto o Tab abria o editor da próxima, e o Tabulator dava erro (12/11/2026).
  // Com uma célula em edição, espera terminar. Nos demais casos (gravou, recarregou) continua imediato.
  function atualizarLinha(id, adiar) {
    function fazer() {
      const reg = Store.obter(id);
      const row = grade.getRow(id);
      if (!reg) { if (row) row.delete(); return; }
      if (row) { row.update({ ...reg }); row.reformat(); }
      else grade.addRow({ ...reg }, true);
    }
    if (!adiar) { fazer(); return; }
    setTimeout(function tentar() {
      if (grade.element.querySelector('.tabulator-cell.tabulator-editing')) { setTimeout(tentar, 250); return; }
      fazer();
    }, 0);
  }

  function recarregar() {
    grade.replaceData(Store.lista());
  }

  function reformatar() { if (grade) grade.getRows().forEach(r => r.reformat()); }

  function selecionar(id, rolar) {
    grade.deselectRow();
    const row = grade.getRow(id);
    if (!row) return;
    row.select();
    if (rolar) grade.scrollToRow(row, 'center', false);
  }

  // ---------- Colunas visiveis ----------
  function lerOcultas() {
    try { return JSON.parse(localStorage.getItem(CHAVE_COLUNAS)); } catch (e) { return null; }
  }

  function definirVisivel(campo, visivel) {
    const col = grade.getColumn(campo);
    if (!col) return;
    visivel ? col.show() : col.hide();
    const ocultas = CAMPOS.filter(c => !grade.getColumn(c.campo).isVisible()).map(c => c.campo);
    try { localStorage.setItem(CHAVE_COLUNAS, JSON.stringify(ocultas)); } catch (e) { /* sem storage */ }
  }

  function colunaVisivel(campo) {
    const col = grade.getColumn(campo);
    return col ? col.isVisible() : false;
  }

  function redesenhar() { if (grade) grade.redraw(); }

  return { iniciar, aplicarFiltro, sincronizarCabecalho, limparCabecalho, idsFiltrados, dadosFiltrados, atualizarLinha, recarregar, reformatar, selecionar, definirVisivel, colunaVisivel, redesenhar };
})();
