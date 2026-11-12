// Exportar o histórico de alterações de uma tabela num período (13/11/2026). Usado pelo menu Exportar da tabela de
// obras (js/obras/painel.js) e da Jurisdição (js/jurisdicao/painel.js).
// Quem vê: perfis que participam da edição na área (propõem, gravam ou aprovam: editor básico, editor pleno,
// gerenciador, administrador) — Acesso.podeExportarHistorico(area). Visualizador e diretor não.
// O banco já entrega só o histórico dos registros que a pessoa pode ver (RLS de siplaweb/jurisdicao.historico).
// Planilha: uma linha por campo alterado (data e hora, código, descrição, ação, campo, antes, depois, autor, proposta de).
var HistoricoExport = (function() {
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var POR_PAGINA = 1000;
  var ACOES = { criado: 'Cadastro', editado: 'Edição', tracado: 'Traçado', excluido: 'Exclusão', restaurado: 'Versão restaurada' };
  var dlg = null, atual = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function doisDig(n) { return (n < 10 ? '0' : '') + n; }
  function dataIso(d) { return d.getFullYear() + '-' + doisDig(d.getMonth() + 1) + '-' + doisDig(d.getDate()); }
  function dataHoraBr(iso) {
    var d = new Date(iso);
    return doisDig(d.getDate()) + '/' + doisDig(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + doisDig(d.getHours()) + ':' + doisDig(d.getMinutes());
  }
  function carregarXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function(ok, falha) {
      var s = document.createElement('script'); s.src = XLSX_URL; s.onload = ok;
      s.onerror = function() { falha(new Error('Não foi possível carregar o gerador de Excel.')); };
      document.head.appendChild(s);
    });
  }

  // Todas as linhas do histórico no período [ini 00:00, fim 23:59] (hora local), paginando (a API entrega 1000 por vez).
  // consulta(): devolve uma consulta nova do supabase-js já com o select e os filtros fixos (ex.: tabela).
  function lerPeriodo(consulta, ini, fim) {
    var de = new Date(ini + 'T00:00:00'), ate = new Date(fim + 'T00:00:00');
    ate.setDate(ate.getDate() + 1);
    var linhas = [];
    function pagina(inicio) {
      return consulta().gte('quando', de.toISOString()).lt('quando', ate.toISOString()).order('quando').order('hid')
        .range(inicio, inicio + POR_PAGINA - 1).then(function(res) {
          if (res.error) throw new Error('Falha ao ler o histórico: ' + res.error.message);
          linhas = linhas.concat(res.data);
          return res.data.length === POR_PAGINA ? pagina(inicio + POR_PAGINA) : linhas;
        });
    }
    return pagina(0);
  }

  function valor(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(valor).join(', ');
    if (typeof v === 'object') return v.type && v.coordinates ? '(geometria)' : JSON.stringify(v);
    return String(v);
  }

  // h: linha do histórico; info: { codigo, descricao, titulo(campo) }. Uma linha da planilha por campo alterado.
  function expandir(h, info) {
    var base = {
      'Data e hora': dataHoraBr(h.quando), 'Código': info.codigo || '', 'Descrição': info.descricao || '',
      'Ação': (info.prefixoAcao || '') + (ACOES[h.acao] || h.acao || ''), 'Campo': '', 'Antes': '', 'Depois': '',
      'Autor': h.usuario_nome || '', 'Proposta de': h.proposto_por_nome || ''
    };
    var campos = h.campos && h.campos.length ? h.campos : null;
    if (!campos || h.acao === 'criado' || h.acao === 'excluido') return [base];
    return campos.map(function(c) {
      return Object.assign({}, base, {
        'Campo': info.titulo(c),
        'Antes': valor(h.antes && h.antes[c]),
        'Depois': valor(h.depois && h.depois[c])
      });
    });
  }

  function montar() {
    var caixa = document.createElement('div');
    caixa.className = 'jur-ui';
    caixa.innerHTML =
      '<dialog class="dialogo dialogo-pequeno" id="histExpDlg"><form method="dialog" id="histExpForm">' +
        '<div class="dialogo-topo"><h3 id="histExpTitulo">Histórico de alterações</h3><button type="button" class="btn-icone" id="histExpFechar" title="Fechar">✕</button></div>' +
        '<div class="dialogo-corpo hist-exp">' +
          '<p class="hist-exp-texto">Exporta para Excel todas as alterações gravadas no período: cadastros, edições, traçados e exclusões, com quem fez, o valor antes e depois e, se veio de proposta, quem propôs.</p>' +
          '<div class="hist-exp-datas"><label>De<input type="date" id="histExpDe" required></label><label>Até<input type="date" id="histExpAte" required></label></div>' +
          '<div class="hist-exp-atalhos"><button type="button" data-hist-dias="7">7 dias</button><button type="button" data-hist-dias="30">30 dias</button><button type="button" data-hist-dias="mes">Este mês</button><button type="button" data-hist-dias="ano">Este ano</button></div>' +
          '<label class="hist-exp-op"><input type="radio" name="histExpQuais" value="todos" checked> <span id="histExpTodos">Todos os registros</span></label>' +
          '<label class="hist-exp-op"><input type="radio" name="histExpQuais" value="filtrados"> <span id="histExpFiltrados">Só os filtrados na tabela</span></label>' +
        '</div>' +
        '<div class="dialogo-rodape"><span class="obr-aviso" id="histExpAviso"></span><div class="espaco"></div>' +
          '<button type="submit" class="btn btn-primario" id="histExpOk">Exportar Excel</button></div>' +
      '</form></dialog>';
    document.body.appendChild(caixa);
    var estilo = document.createElement('style');
    estilo.textContent = '.hist-exp{display:flex;flex-direction:column;gap:10px;font-size:13px}.hist-exp-texto{margin:0;color:#475569;line-height:1.45}' +
      '.hist-exp-datas{display:flex;gap:10px}.hist-exp-datas label{flex:1;display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12px;color:#334155}' +
      '.hist-exp-datas input{height:34px;border:1px solid #cbd5e1;border-radius:7px;padding:0 8px;font:inherit}' +
      '.hist-exp-atalhos{display:flex;gap:6px;flex-wrap:wrap}.hist-exp-atalhos button{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer}' +
      '.hist-exp-atalhos button:hover{background:#eef2f7}.hist-exp-op{display:flex;align-items:center;gap:6px;cursor:pointer}';
    document.head.appendChild(estilo);
    dlg = caixa.querySelector('#histExpDlg');
    caixa.querySelector('#histExpFechar').addEventListener('click', function() { dlg.close(); });
    caixa.querySelectorAll('[data-hist-dias]').forEach(function(b) {
      b.addEventListener('click', function() {
        var hoje = new Date(), de = new Date(), v = b.dataset.histDias;
        if (v === 'mes') de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        else if (v === 'ano') de = new Date(hoje.getFullYear(), 0, 1);
        else de.setDate(hoje.getDate() - Number(v) + 1);
        caixa.querySelector('#histExpDe').value = dataIso(de);
        caixa.querySelector('#histExpAte').value = dataIso(hoje);
      });
    });
    caixa.querySelector('#histExpForm').addEventListener('submit', function(e) {
      e.preventDefault();
      exportar(caixa.querySelector('#histExpDe').value, caixa.querySelector('#histExpAte').value,
        caixa.querySelector('input[name="histExpQuais"]:checked').value === 'filtrados');
    });
  }

  function aviso(txt) { document.getElementById('histExpAviso').textContent = txt || ''; }

  function exportar(ini, fim, soFiltrados) {
    if (!ini || !fim) { aviso('Informe as duas datas.'); return; }
    if (ini > fim) { aviso('A data inicial é depois da final.'); return; }
    var ok = document.getElementById('histExpOk');
    ok.disabled = true; aviso('Lendo o histórico…');
    Promise.all([atual.linhas(ini, fim, soFiltrados), carregarXlsx()]).then(function(r) {
      var linhas = r[0];
      if (!linhas.length) { aviso('Nenhuma alteração nesse período.'); return; }
      var cab = ['Data e hora', 'Código', 'Descrição', 'Ação', 'Campo', 'Antes', 'Depois', 'Autor', 'Proposta de'];
      var ws = XLSX.utils.json_to_sheet(linhas, { header: cab });
      ws['!cols'] = [16, 13, 40, 14, 22, 40, 40, 22, 22].map(function(w) { return { wch: w }; });
      ws['!autofilter'] = { ref: ws['!ref'] };
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Histórico');
      XLSX.writeFile(wb, 'Historico_' + atual.arquivo + '_' + ini.replace(/-/g, '') + '_a_' + fim.replace(/-/g, '') + '.xlsx');
      if (window.Acesso && Acesso.registrarEvento) Acesso.registrarEvento('exportou', 'Histórico de ' + atual.titulo + ' de ' + ini + ' a ' + fim + ' (' + linhas.length + ' linhas)');
      aviso(''); dlg.close();
    }).catch(function(e) { aviso(e.message); }).then(function() { ok.disabled = false; });
  }

  // opcoes: { titulo, arquivo, totalFiltrados, linhas(ini, fim, soFiltrados) -> Promise<[linhas da planilha]> }
  function abrir(opcoes) {
    if (!dlg) montar();
    atual = opcoes;
    document.getElementById('histExpTitulo').textContent = 'Histórico de alterações · ' + opcoes.titulo;
    document.getElementById('histExpFiltrados').textContent = 'Só os ' + (opcoes.totalFiltrados != null ? opcoes.totalFiltrados + ' ' : '') + 'registros filtrados na tabela';
    var de = document.getElementById('histExpDe'), ate = document.getElementById('histExpAte');
    if (!de.value) { var h = new Date(); ate.value = dataIso(h); de.value = dataIso(new Date(h.getFullYear(), h.getMonth(), 1)); }
    aviso('');
    dlg.showModal();
  }

  return { abrir: abrir, lerPeriodo: lerPeriodo, expandir: expandir };
})();
