// Linha do tempo no mapa (mapa.html): escolher uma data e ver a SITUAÇÃO REAL naquele dia (pela data do fato).
//   obras       só as que já existiam, com a etapa/status daquela data (siplaweb.situacao_obras_em)
//   jurisdição  a situação de cada trecho naquela data (jurisdicao.situacao_em); "sem informação" se ainda não se sabia
// Régua no rodapé do mapa (fechada num botão "Linha do tempo"); fora de hoje aparece a faixa "Situação em … · só leitura"
// e a tabela/ficha não editam. Voltar para hoje restaura tudo. Não aparece no mapa rodoviário (sem obras).
// Banco: supabase/008_linha_do_tempo.sql. Quem aplica a data: DadosBanco/ObrasStore (obras) e Store (jurisdição).

var LinhaTempo = (function() {
  var q = new URLSearchParams(location.search);
  var JURISDICAO = q.get('modulo') === 'jurisdicao';
  if (!JURISDICAO && String(q.get('perfil') || '').toLowerCase() === 'rodoviario') return null;

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var DIA = 864e5;
  var inicio = null, hoje = null, data = null;   // data = null: hoje (situação atual)
  var tempo = null, pedido = 0;

  function $(id) { return document.getElementById(id); }
  function iso(d) { var x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); }
  function paraData(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function fmt(s) { var p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function dias(a, b) { return Math.round((paraData(b) - paraData(a)) / DIA); }
  function somar(s, n) { var d = paraData(s); d.setDate(d.getDate() + n); return iso(d); }

  // ---------- Quem aplica ----------
  var alvo = JURISDICAO ? {
    nome: 'trechos de jurisdição',
    consultar: function(d) { return Acesso.cliente.schema('jurisdicao').rpc('situacao_em', { p_data: d }); },
    aplicar: function(res) { Store.definirVisao(res ? res.registros : null); return Promise.resolve(); },
    // Os processos são bem mais antigos que os trâmites lançados: a régua volta pelo menos um ano, para mostrar
    // também o "antes" do primeiro trâmite (situação desconhecida).
    inicio: function(res) { var umAno = somar(hoje, -365); return res.inicio && res.inicio < umAno ? res.inicio : umAno; }
  } : {
    nome: 'obras',
    consultar: function(d) { return Acesso.cliente.rpc('situacao_obras_em', { p_data: d }); },
    aplicar: function(res) {
      var v = res ? res.obras : null;
      DadosBanco.definirVisao(v);
      if (typeof ObrasStore !== 'undefined') ObrasStore.definirVisao(v);
      return typeof recarregarObrasDoMapa === 'function' ? recarregarObrasDoMapa(false) : Promise.resolve();
    },
    inicio: function(res) { return res.inicio; }
  };

  // ---------- Interface ----------
  function montar() {
    var caixa = document.createElement('div');
    caixa.className = 'lt';
    caixa.innerHTML =
      '<button type="button" class="lt-abrir" id="ltAbrir" title="Ver a situação numa data passada">' +
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Linha do tempo</button>' +
      '<div class="lt-barra" id="ltBarra" hidden>' +
        '<div class="lt-topo"><b>Linha do tempo</b><span class="lt-sub">situação em</span>' +
          '<input type="date" id="ltData"><button type="button" class="lt-hoje" id="ltHoje">Hoje</button>' +
          '<button type="button" class="lt-fechar" id="ltFechar" title="Fechar (volta para hoje)">×</button></div>' +
        '<div class="lt-regua"><button type="button" class="lt-passo" data-lt-passo="-30" title="Um mês antes">‹</button>' +
          '<div class="lt-faixa"><input type="range" id="ltRegua" min="0" step="1"><div class="lt-marcas" id="ltMarcas"></div></div>' +
          '<button type="button" class="lt-passo" data-lt-passo="30" title="Um mês depois">›</button></div>' +
        '<div class="lt-rodape" id="ltInfo"></div>' +
      '</div>';
    map.getContainer().appendChild(caixa);
    L.DomEvent.disableClickPropagation(caixa);
    L.DomEvent.disableScrollPropagation(caixa);

    var aviso = document.createElement('div');
    aviso.className = 'lt-aviso';
    aviso.id = 'ltAviso';
    aviso.hidden = true;
    aviso.innerHTML = '<span id="ltAvisoTxt"></span><button type="button" id="ltVoltar">Voltar para hoje</button>';
    map.getContainer().appendChild(aviso);
    L.DomEvent.disableClickPropagation(aviso);

    $('ltAbrir').addEventListener('click', function() { abrir(true); });
    $('ltFechar').addEventListener('click', function() { definir(null); abrir(false); });
    $('ltHoje').addEventListener('click', function() { definir(null); });
    $('ltVoltar').addEventListener('click', function() { definir(null); });
    $('ltData').addEventListener('change', function() { if (this.value) definir(limitar(this.value)); });
    $('ltRegua').addEventListener('input', function() {
      var d = somar(inicio, Number(this.value));
      $('ltData').value = d;
      clearTimeout(tempo);
      tempo = setTimeout(function() { definir(d); }, 350);
    });
    document.querySelectorAll('[data-lt-passo]').forEach(function(b) {
      b.addEventListener('click', function() { definir(limitar(somar(data || hoje, Number(b.dataset.ltPasso)))); });
    });
  }

  function abrir(sim) {
    $('ltBarra').hidden = !sim;
    $('ltAbrir').hidden = sim;
  }
  function limitar(d) { return d < inicio ? inicio : d > hoje ? hoje : d; }

  function prepararRegua() {
    var total = Math.max(1, dias(inicio, hoje));
    $('ltRegua').max = total;
    $('ltData').min = inicio;
    $('ltData').max = hoje;
    // Marcas no 1º dia de cada mês (com o ano em janeiro e na primeira).
    var marcas = [], d = paraData(inicio);
    d.setDate(1);
    var primeira = true;
    while (iso(d) <= hoje) {
      var s = iso(d);
      if (s >= inicio) {
        var pos = dias(inicio, s) / total * 100;
        marcas.push('<span style="left:' + pos.toFixed(2) + '%">' + MESES[d.getMonth()] + (primeira || d.getMonth() === 0 ? '/' + String(d.getFullYear()).slice(2) : '') + '</span>');
        primeira = false;
      }
      d.setMonth(d.getMonth() + 1);
    }
    $('ltMarcas').innerHTML = marcas.join('');
    sincronizar();
  }

  function sincronizar() {
    var d = data || hoje;
    $('ltRegua').value = dias(inicio, d);
    $('ltData').value = d;
    $('ltHoje').disabled = !data;
    $('ltAviso').hidden = !data;
    $('ltAvisoTxt').textContent = data ? 'Situação em ' + fmt(data) + ' · só leitura' : '';
    document.body.classList.toggle('lt-passado', !!data);
    atualizarSelos();
  }

  // Selo nos cabeçalhos das tabelas (obras e jurisdição) quando a data não é hoje. Tem o próprio "voltar para
  // hoje" porque a tabela em tela cheia cobre a faixa e a régua do mapa.
  function atualizarSelos() {
    document.querySelectorAll('.lt-selo').forEach(function(el) {
      el.hidden = !data;
      el.innerHTML = data ? 'Situação em ' + fmt(data) + ' · só leitura <button type="button" data-lt-hoje>voltar para hoje</button>' : '';
    });
  }
  document.addEventListener('click', function(e) { if (e.target.closest('[data-lt-hoje]')) definir(null); });

  // ---------- Aplicar uma data ----------
  function definir(d) {
    if (d === hoje) d = null;
    if (d === data) { sincronizar(); return Promise.resolve(); }
    data = d;
    sincronizar();
    var meu = ++pedido;
    $('ltInfo').textContent = 'Carregando…';
    if (!d) {
      return alvo.aplicar(null).then(function() { if (meu === pedido) $('ltInfo').textContent = 'Situação atual.'; });
    }
    return alvo.consultar(d).then(function(res) {
      if (meu !== pedido) return;
      if (res.error) throw new Error(res.error.message);
      return alvo.aplicar(res.data).then(function() {
        if (meu !== pedido) return;
        var n = JURISDICAO ? Object.keys(res.data.registros).filter(function(k) { return res.data.registros[k] !== null; }).length
          : Object.keys(res.data.obras).length;
        $('ltInfo').textContent = JURISDICAO ? n + ' trechos com situação conhecida em ' + fmt(d) + '.' : n + ' obras já cadastradas em ' + fmt(d) + '.';
      });
    }).catch(function(e) { $('ltInfo').textContent = 'Não foi possível carregar: ' + e.message; });
  }

  Acesso.pronto.then(function() {
    if (JURISDICAO ? !Acesso.podeVer('JURISDICAO') : false) return;
    hoje = iso(new Date());
    montar();
    // O início da régua vem do banco (primeiro cadastro/trâmite); sem histórico, um ano para trás.
    alvo.consultar(hoje).then(function(res) {
      inicio = (res && !res.error && alvo.inicio(res.data)) || somar(hoje, -365);
      if (inicio > hoje) inicio = hoje;
      prepararRegua();
      $('ltInfo').textContent = 'Arraste a régua ou escolha a data. Histórico desde ' + fmt(inicio) + '.';
    });
  });

  return { data: function() { return data; }, definir: function(d) { return definir(d ? limitar(d) : null); }, atualizarSelos: atualizarSelos };
})();
