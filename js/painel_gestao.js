// Painel (painel.html): resumo com indicadores, avisos/aprovações e configurações.
// Liberado a partir de gerenciador em alguma área (ou administrador). Os números respeitam as permissões do banco:
// cada pessoa só vê as origens (e a jurisdição) que tem liberadas. Aprovar/recusar usa as mesmas funções do mapa
// (siplaweb/jurisdicao.aprovar_proposta, recusar_proposta, cancelar_proposta), que conferem o nível de novo no banco.
(function() {
  var POR_PAGINA = 1000;
  var DIAS = 30;
  // Data de referência: até 45 dias = em dia, até 90 = atenção, mais que isso = desatualizada.
  var PRAZO = { emDia: 45, atencao: 90 };
  var GRUPOS_ETAPA = [
    { chave: 'Planejamento', cor: 'var(--plan)' }, { chave: 'Projeto', cor: 'var(--projeto)' },
    { chave: 'Obra', cor: 'var(--obra)' }, { chave: 'outros', nome: 'Outras / sem etapa', cor: 'var(--outros)' }
  ];
  var NOME_NIVEL = { visualizador: 'visualizador', gerenciador: 'gerenciador', editor_basico: 'editor básico', editor_pleno: 'editor pleno' };
  var SIGLA_NIVEL = { visualizador: 'V', gerenciador: 'G', editor_basico: 'EB', editor_pleno: 'EP' };
  var SITUACAO_PROPOSTA = { pendente: 'Aguardando', aprovada: 'Aprovada', recusada: 'Recusada', cancelada: 'Cancelada' };

  var sb = Acesso.cliente, sbJur = Acesso.cliente.schema('jurisdicao');
  var perfil = null, origens = [], obras = [], historico = [], jur = [], nomes = {};
  var propostas = [];        // { area, p, atual } das duas fontes (obras e jurisdição)
  var filtro = '';           // origem escolhida ('' = todas)

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, casas) { return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas || 0 }); }
  function fmtData(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '—'; }
  function fmtDataHora(d) { if (!d) return '—'; var x = new Date(d); return x.toLocaleDateString('pt-BR') + ' ' + x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function diasDesde(d) { return Math.floor((Date.now() - new Date(String(d).slice(0, 10) + 'T12:00:00').getTime()) / 864e5); }
  function toast(msg, erro) {
    var t = document.createElement('div');
    t.className = 'toast' + (erro ? ' toast-erro' : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function() { t.remove(); }, erro ? 7000 : 3500);
  }
  function grau(area) { return { visualizador: 1, gerenciador: 2, editor_basico: 3, editor_pleno: 4 }[perfil.areas[area]] || 0; }
  function eu() { return perfil.user_id; }
  function nomeOrigem(c) { var o = origens.find(function(x) { return x.codigo === c; }); return o ? o.nome : c; }

  // Leitura paginada (a API devolve no máximo 1000 linhas por consulta).
  function tudo(montar) {
    var linhas = [];
    function pagina(i) {
      return montar().range(i, i + POR_PAGINA - 1).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        linhas = linhas.concat(res.data);
        return res.data.length === POR_PAGINA ? pagina(i + POR_PAGINA) : linhas;
      });
    }
    return pagina(0);
  }
  function dados(res) { if (res.error) throw new Error(res.error.message); return res.data; }

  // ---------- Carga ----------
  function carregar() {
    var desde = new Date(Date.now() - DIAS * 864e5).toISOString();
    var veJur = Acesso.podeVer('JURISDICAO');
    return Promise.all([
      sb.from('origens').select('codigo,nome,ordem').eq('ativa', true).order('ordem').then(dados),
      tudo(function() { return sb.from('obras').select('uid,codigo,origem,etapa,status,municipio,ext_contrato_km,data_referencia').is('excluido_em', null).order('codigo'); }),
      tudo(function() { return sb.from('historico').select('quando,acao').gte('quando', desde).order('hid'); }),
      veJur ? tudo(function() { return sbJur.from('alteracoes').select('uid,codigo,situacao,extensao_km,rodovia,municipios').is('excluido_em', null).order('id'); }) : [],
      veJur ? tudo(function() { return sbJur.from('historico').select('quando,acao').gte('quando', desde).order('hid'); }) : [],
      sb.rpc('nomes').then(dados)
    ]).then(function(r) {
      origens = r[0].filter(function(o) { return Acesso.podeVer(o.codigo); });
      obras = r[1];
      historico = r[2].concat(r[4]);
      jur = r[3];
      nomes = {};
      r[5].forEach(function(u) { nomes[u.user_id] = u.nome; });
      return carregarPropostas();
    });
  }

  // Pendentes + decididas nos últimos 30 dias, das obras e da jurisdição. Para as edições pendentes busca
  // os valores atuais, para mostrar "antes → depois" (como na tela de Aprovações do mapa).
  function carregarPropostas() {
    var desde = new Date(Date.now() - DIAS * 864e5).toISOString();
    var filtroSit = 'situacao.eq.pendente,decidido_em.gte.' + desde;
    var veJur = Acesso.podeVer('JURISDICAO');
    return Promise.all([
      sb.from('propostas').select('*').or(filtroSit).order('criado_em', { ascending: false }).then(dados),
      veJur ? sbJur.from('propostas').select('*').or(filtroSit).order('criado_em', { ascending: false }).then(dados) : []
    ]).then(function(r) {
      var uidsObra = r[0].filter(function(p) { return p.obra_uid; }).map(function(p) { return p.obra_uid; });
      var uidsJur = [];
      r[1].forEach(function(p) { if (p.registro_uid) uidsJur.push(p.registro_uid); (p.registros || []).forEach(function(u) { uidsJur.push(u); }); });
      return Promise.all([
        uidsObra.length ? sb.from('obras').select('*').in('uid', uidsObra).then(dados) : [],
        uidsJur.length ? sbJur.from('alteracoes').select('*').in('uid', uidsJur).then(dados) : []
      ]).then(function(atuais) {
        var obraPor = {}, jurPor = {};
        atuais[0].forEach(function(o) { obraPor[o.uid] = o; });
        atuais[1].forEach(function(o) { jurPor[o.uid] = o; });
        propostas = r[0].map(function(p) { return { fonte: 'obras', area: p.origem, p: p, atual: obraPor[p.obra_uid] || null }; })
          .concat(r[1].map(function(p) {
            return { fonte: 'jurisdicao', area: 'JURISDICAO', p: p, atual: jurPor[p.registro_uid] || null,
              registros: (p.registros || []).map(function(u) { return jurPor[u]; }).filter(Boolean) };
          }));
      });
    });
  }

  // ---------- Filtro por origem ----------
  function renderFiltros() {
    var contagem = {};
    obras.forEach(function(o) { contagem[o.origem] = (contagem[o.origem] || 0) + 1; });
    var com = origens.filter(function(o) { return contagem[o.codigo]; });
    $('filtros').innerHTML = '<span class="pn-filtros-rotulo">Origem</span>' +
      '<button type="button" data-origem=""' + (filtro ? '' : ' class="ativo"') + '>Todas</button>' +
      com.map(function(o) {
        return '<button type="button" data-origem="' + esc(o.codigo) + '"' + (filtro === o.codigo ? ' class="ativo"' : '') +
          ' title="' + esc(o.nome) + ' · ' + num(contagem[o.codigo]) + '">' + esc(o.codigo) + '</button>';
      }).join('');
    $('filtros').hidden = com.length < 2;
  }
  function filtrar(origem) {
    filtro = filtro === origem ? '' : origem;
    renderFiltros();
    renderResumo();
  }
  function obrasFiltradas() { return filtro ? obras.filter(function(o) { return o.origem === filtro; }) : obras; }

  // ---------- Resumo ----------
  function grupoEtapa(e) { return e === 'Planejamento' || e === 'Projeto' || e === 'Obra' ? e : 'outros'; }

  function renderResumo() {
    var lista = obrasFiltradas();
    var porEtapa = { Planejamento: 0, Projeto: 0, Obra: 0, outros: 0 }, km = 0, municipios = {};
    lista.forEach(function(o) {
      porEtapa[grupoEtapa(o.etapa)]++;
      km += Number(o.ext_contrato_km) || 0;
      String(o.municipio || '').split(/\s*[\/;,]\s*/).forEach(function(m) { if (m) municipios[m] = (municipios[m] || 0) + 1; });
    });
    var pend = propostas.filter(function(x) { return x.p.situacao === 'pendente' && (!filtro || x.area === filtro); });
    var paraMim = pend.filter(function(x) { return podeAprovar(x.area); }).length;
    var kpis = [
      { v: num(lista.length), r: 'empreendimentos', s: filtro ? nomeOrigem(filtro) : origens.length + ' origens liberadas' },
      { v: num(porEtapa.Obra), r: 'em obra', s: pct(porEtapa.Obra, lista.length), cor: 'var(--obra)' },
      { v: num(porEtapa.Projeto), r: 'em projeto', s: pct(porEtapa.Projeto, lista.length), cor: 'var(--projeto)' },
      { v: num(porEtapa.Planejamento), r: 'em planejamento', s: pct(porEtapa.Planejamento, lista.length), cor: 'var(--plan)' },
      { v: num(km), r: 'km contratados', s: 'soma da extensão de contrato' },
      { v: num(Object.keys(municipios).length), r: 'municípios atendidos', s: 'com ao menos um empreendimento' },
      { v: num(pend.length), r: 'propostas aguardando', s: paraMim ? paraMim + ' para você decidir' : 'aprovação do editor pleno',
        link: '#avisos', alerta: paraMim > 0 }
    ];
    $('kpis').innerHTML = kpis.map(function(k) {
      return '<' + (k.link ? 'a href="' + k.link + '"' : 'div') + ' class="pn-kpi' + (k.alerta ? ' pn-kpi-alerta' : '') + '"' +
        (k.cor ? ' style="--c:' + k.cor + '"' : '') + '><b>' + k.v + '</b><span>' + k.r + '</span><small>' + esc(k.s) + '</small></' + (k.link ? 'a' : 'div') + '>';
    }).join('');

    renderEtapas();
    renderBarrasSimples($('gStatus'), contar(lista, function(o) { return o.status || '(sem status)'; }), 8, 'var(--projeto)');
    renderBarrasSimples($('gMunicipios'), Object.keys(municipios).map(function(m) { return [m, municipios[m]]; }).sort(function(a, b) { return b[1] - a[1]; }), 8, 'var(--obra)', true);
    renderAtualizacao();
    renderAtividade();
    renderJurisdicao();
  }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '% do total' : '—'; }
  function contar(lista, chave) {
    var c = {};
    lista.forEach(function(o) { var k = chave(o); c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).map(function(k) { return [k, c[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  }

  // Barras horizontais empilhadas: uma linha por origem, segmentos por etapa, total na ponta.
  function renderEtapas() {
    var por = {};
    obras.forEach(function(o) {
      var x = por[o.origem] = por[o.origem] || { total: 0, Planejamento: 0, Projeto: 0, Obra: 0, outros: 0, detalhe: {} };
      x.total++; x[grupoEtapa(o.etapa)]++;
      var d = o.etapa || 'sem etapa'; x.detalhe[d] = (x.detalhe[d] || 0) + 1;
    });
    var linhas = origens.filter(function(o) { return por[o.codigo]; }).sort(function(a, b) { return por[b.codigo].total - por[a.codigo].total; });
    var max = Math.max.apply(null, linhas.map(function(o) { return por[o.codigo].total; }).concat(1));
    $('gEtapas').innerHTML = linhas.map(function(o) {
      var x = por[o.codigo];
      var outros = Object.keys(x.detalhe).filter(function(d) { return grupoEtapa(d === 'sem etapa' ? null : d) === 'outros'; })
        .map(function(d) { return d + ': ' + x.detalhe[d]; }).join(' · ');
      return '<button type="button" class="pn-linha' + (filtro && filtro !== o.codigo ? ' apagada' : '') + (filtro === o.codigo ? ' escolhida' : '') +
        '" data-origem="' + esc(o.codigo) + '"><span class="pn-rotulo" title="' + esc(o.nome) + '">' + esc(o.codigo) + '</span>' +
        '<span class="pn-trilho"><span class="pn-pilha" style="width:' + (x.total / max * 100) + '%">' +
        GRUPOS_ETAPA.filter(function(g) { return x[g.chave]; }).map(function(g) {
          var nome = g.nome || g.chave;
          return '<i style="flex:' + x[g.chave] + ';background:' + g.cor + '" data-dica="' + esc(o.codigo + ' · ' + nome + '|' + num(x[g.chave]) + ' (' + Math.round(x[g.chave] / x.total * 100) + '%)' +
            (g.chave === 'outros' && outros ? '|' + outros : '')) + '"></i>';
        }).join('') + '</span><span class="pn-valor">' + num(x.total) + '</span></span></button>';
    }).join('') || '<div class="vazio">Sem empreendimentos.</div>';
  }

  // Barras horizontais de uma série; o que passa do limite vira "Outros".
  function renderBarrasSimples(alvo, pares, limite, cor, semOutros) {
    var mostra = pares.slice(0, limite), resto = pares.slice(limite);
    if (resto.length && !semOutros) mostra.push(['Outros (' + resto.length + ')', resto.reduce(function(s, p) { return s + p[1]; }, 0)]);
    var max = Math.max.apply(null, mostra.map(function(p) { return p[1]; }).concat(1));
    alvo.innerHTML = mostra.map(function(p) {
      return '<div class="pn-linha pn-linha-larga"><span class="pn-rotulo" title="' + esc(p[0]) + '">' + esc(p[0]) + '</span>' +
        '<span class="pn-trilho"><span class="pn-pilha" style="width:' + (p[1] / max * 100) + '%"><i style="flex:1;background:' + cor + '" data-dica="' + esc(p[0] + '|' + num(p[1])) + '"></i></span>' +
        '<span class="pn-valor">' + num(p[1]) + '</span></span></div>';
    }).join('') || '<div class="vazio">Sem dados.</div>';
  }

  function situacaoPrazo(dias) {
    if (dias == null) return { cls: 'sem', txt: 'Sem data', ico: '–' };
    if (dias <= PRAZO.emDia) return { cls: 'ok', txt: 'Em dia', ico: '✓' };
    if (dias <= PRAZO.atencao) return { cls: 'atencao', txt: 'Atenção', ico: '!' };
    return { cls: 'atrasada', txt: 'Desatualizada', ico: '!!' };
  }
  function atualizacaoPorOrigem() {
    var ult = {};
    obras.forEach(function(o) { if (o.data_referencia && (!ult[o.origem] || o.data_referencia > ult[o.origem])) ult[o.origem] = o.data_referencia; });
    return origens.filter(function(o) { return obras.some(function(x) { return x.origem === o.codigo; }); }).map(function(o) {
      var d = ult[o.codigo];
      return { origem: o, data: d, dias: d ? diasDesde(d) : null };
    }).sort(function(a, b) { return (b.dias == null ? 1e9 : b.dias) - (a.dias == null ? 1e9 : a.dias); });
  }
  function renderAtualizacao() {
    var linhas = atualizacaoPorOrigem().filter(function(l) { return !filtro || l.origem.codigo === filtro; });
    $('tAtualizacao').innerHTML = '<table class="pn-tabela"><thead><tr><th>Origem</th><th>Referência</th><th>Há</th><th>Situação</th></tr></thead><tbody>' +
      linhas.map(function(l) {
        var s = situacaoPrazo(l.dias);
        return '<tr><td title="' + esc(l.origem.nome) + '"><b>' + esc(l.origem.codigo) + '</b></td><td>' + fmtData(l.data) + '</td><td>' +
          (l.dias == null ? '—' : num(l.dias) + ' dias') + '</td><td><span class="pn-selo pn-selo-' + s.cls + '"><i>' + s.ico + '</i>' + s.txt + '</span></td></tr>';
      }).join('') + '</tbody></table><p class="pn-nota">Em dia: até ' + PRAZO.emDia + ' dias · atenção: até ' + PRAZO.atencao + ' · desatualizada: mais de ' + PRAZO.atencao + '.</p>';
  }

  // Colunas por dia (últimos 30 dias): tudo o que entrou no histórico (obras + jurisdição) que a pessoa pode ver.
  function renderAtividade() {
    var dias = [], por = {}, hoje = new Date();
    for (var i = DIAS - 1; i >= 0; i--) {
      var d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i);
      var k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      dias.push(k); por[k] = 0;
    }
    historico.forEach(function(h) {
      var x = new Date(h.quando);
      var k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
      if (k in por) por[k]++;
    });
    var max = Math.max.apply(null, dias.map(function(k) { return por[k]; }).concat(1));
    var total = dias.reduce(function(s, k) { return s + por[k]; }, 0);
    var picos = dias.filter(function(k) { return por[k] === max && max > 0; });
    $('gAtividade').innerHTML = '<div class="pn-colunas">' + dias.map(function(k) {
      return '<span class="pn-col" data-dica="' + esc(fmtData(k) + '|' + num(por[k]) + ' alteraç' + (por[k] === 1 ? 'ão' : 'ões')) + '">' +
        '<i style="height:' + (por[k] ? Math.max(4, por[k] / max * 100) : 0) + '%"></i></span>';
    }).join('') + '</div><div class="pn-eixo"><span>' + fmtData(dias[0]).slice(0, 5) + '</span><span>hoje</span></div>' +
      '<p class="pn-nota"><b>' + num(total) + '</b> alterações no período' + (picos.length ? ' · pico de ' + num(max) + ' em ' + fmtData(picos[0]).slice(0, 5) : '') +
      '. Inclui cadastros, edições, traçados e importações.</p>';
  }

  function renderJurisdicao() {
    $('cartaoJur').hidden = !jur.length;
    if (!jur.length) return;
    var por = {}, km = 0;
    jur.forEach(function(r) {
      var s = r.situacao || '(sem situação)';
      por[s] = por[s] || { n: 0, km: 0 };
      por[s].n++; por[s].km += Number(r.extensao_km) || 0; km += Number(r.extensao_km) || 0;
    });
    var emAnalise = (por['EM ANÁLISE'] || { n: 0 }).n;
    $('kpisJur').innerHTML = [[num(jur.length), 'processos'], [num(km), 'km envolvidos'], [num(emAnalise), 'em análise']].map(function(k) {
      return '<div class="pn-kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>';
    }).join('');
    var pares = Object.keys(por).sort(function(a, b) { return por[b].n - por[a].n; });
    var max = Math.max.apply(null, pares.map(function(s) { return por[s].n; }).concat(1));
    $('gJur').innerHTML = pares.map(function(s) {
      return '<div class="pn-linha pn-linha-larga"><span class="pn-rotulo" title="' + esc(s) + '">' + esc(s) + '</span>' +
        '<span class="pn-trilho"><span class="pn-pilha" style="width:' + (por[s].n / max * 100) + '%"><i style="flex:1;background:#5b6b8c" data-dica="' +
        esc(s + '|' + num(por[s].n) + ' processos · ' + num(por[s].km, 1) + ' km') + '"></i></span>' +
        '<span class="pn-valor">' + num(por[s].n) + ' <small>· ' + num(por[s].km) + ' km</small></span></span></div>';
    }).join('');
  }

  // ---------- Avisos e aprovações ----------
  function podeAprovar(area) { return perfil.admin || grau(area) >= 4; }
  function nomeArea(a) { return a === 'JURISDICAO' ? 'Jurisdição' : a; }
  function linkArea(a) { return a === 'JURISDICAO' ? 'mapa.html?modulo=jurisdicao&tabela=dividida' : 'mapa.html?origem=' + encodeURIComponent(a) + '&tabela=dividida'; }

  function tituloCampo(fonte, c) {
    if (c === 'geom') return 'Traçado';
    if (c === 'vinculos') return 'Trechos da malha';
    var lista = fonte === 'obras' ? CAMPOS_OBRA : CAMPOS;
    var x = lista.find(function(k) { return k.campo === c; });
    return x ? x.titulo : c;
  }
  function textoValor(c, v) {
    if (v == null || v === '') return '';
    if (c === 'geom') return typeof v === 'string' ? (/POINT/.test(v) ? 'ponto' : 'desenho') : (v.type === 'Point' ? 'ponto' : 'desenho') + ' alterado';
    if (c === 'vinculos') return v.length + ' trecho' + (v.length === 1 ? '' : 's');
    if (c === 'data_referencia') return fmtData(v);
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function cartaoProposta(x) {
    var p = x.p, r = x.atual, pleno = podeAprovar(x.area);
    var titulo;
    if (x.fonte === 'obras') titulo = p.tipo === 'nova' ? (r ? r.codigo + ' · obra nova' : 'Obra nova') : (r ? r.codigo : '(obra)');
    else titulo = p.tipo === 'nova' ? (r ? r.codigo + ' · registro novo' : 'Registro novo')
      : p.tipo === 'tramite' ? 'Trâmite · ' + x.registros.map(function(o) { return o.codigo; }).join(', ') : (r ? r.codigo : '(registro)');
    var sub = x.fonte === 'obras' ? ((r && r.descricao) || p.mudancas.descricao || '')
      : [(r || p.mudancas).rodovia, (r || p.mudancas).municipios].filter(Boolean).join(' — ');
    var comAntes = p.tipo === 'edicao' && p.situacao === 'pendente' && r;
    var conflito = comAntes && r.versao !== p.versao_base;
    var campos = p.tipo === 'tramite'
      ? [['Data', fmtData(p.mudancas.data)], ['Nova situação', p.mudancas.situacao || '(mantém)'], ['Descrição', p.mudancas.descricao], ['Processo SEI', p.mudancas.processo_sei]]
        .filter(function(l) { return l[1]; }).map(function(l) { return [l[0], null, l[1]]; })
      : Object.keys(p.mudancas).map(function(c) { return [tituloCampo(x.fonte, c), comAntes ? textoValor(c, r[c]) || '(vazio)' : null, textoValor(c, p.mudancas[c]) || '(vazio)']; });
    var acoes = '<a class="link" href="' + linkArea(x.area) + '">abrir no mapa</a>';
    if (p.situacao === 'pendente') {
      if (pleno) acoes += '<span class="espaco"></span><button type="button" class="btn" data-recusar="' + x.fonte + ':' + p.pid + '">Recusar</button>' +
        '<button type="button" class="btn btn-primario" data-aprovar="' + x.fonte + ':' + p.pid + '">Aprovar</button>';
      else if (p.criado_por === eu()) acoes += '<span class="espaco"></span><button type="button" class="btn" data-cancelar="' + x.fonte + ':' + p.pid + '">Cancelar proposta</button>';
    }
    var decisao = p.situacao === 'pendente' ? '' : '<div class="pn-decisao pn-decisao-' + p.situacao + '">' + SITUACAO_PROPOSTA[p.situacao] +
      (p.decidido_por && p.decidido_por !== p.criado_por ? ' por ' + esc(nomes[p.decidido_por] || '—') : '') + ' em ' + fmtDataHora(p.decidido_em) +
      (p.motivo ? ' · motivo: ' + esc(p.motivo) : '') + '</div>';
    return '<div class="pn-proposta pn-proposta-' + p.situacao + '">' +
      '<div class="pn-prop-cab"><span class="pn-area">' + esc(nomeArea(x.area)) + '</span><b>' + esc(titulo) + '</b> <span class="pn-sub">' + esc(String(sub).slice(0, 110)) + '</span></div>' +
      '<div class="pn-autor">Proposta de <b>' + esc(nomes[p.criado_por] || '—') + '</b> em ' + fmtDataHora(p.criado_em) + '</div>' +
      (conflito ? '<div class="pn-conflito">Foi alterado depois desta proposta (versão ' + p.versao_base + ' → ' + r.versao + '). Confira os valores atuais antes de aprovar.</div>' : '') +
      '<div class="pn-campos">' + campos.map(function(c) {
        return '<span class="pn-campo">' + esc(c[0]) + '</span>' + (c[1] != null ? '<span class="de">' + esc(c[1]) + '</span><span class="seta">→</span>' : '<span></span><span></span>') +
          '<span class="para">' + esc(c[2]) + '</span>';
      }).join('') + '</div>' + decisao +
      '<div class="pn-recusa" hidden><textarea rows="2" placeholder="Motivo da recusa (o autor vai ver)"></textarea>' +
      '<button type="button" class="btn btn-perigo" data-confirmar-recusa="' + x.fonte + ':' + p.pid + '">Confirmar recusa</button></div>' +
      '<div class="pn-prop-acoes">' + acoes + '</div></div>';
  }

  function aviso(tipo, titulo, texto, link) {
    return '<div class="pn-aviso pn-aviso-' + tipo + '"><i>' + (tipo === 'ok' ? '✓' : '!') + '</i><div><b>' + titulo + '</b>' +
      (texto ? '<span>' + texto + '</span>' : '') + '</div>' + (link ? '<a class="link" href="' + link[0] + '">' + link[1] + '</a>' : '') + '</div>';
  }

  function renderAvisos() {
    var html = '';
    var pendentes = propostas.filter(function(x) { return x.p.situacao === 'pendente'; });
    var paraDecidir = pendentes.filter(function(x) { return podeAprovar(x.area); });
    var minhas = propostas.filter(function(x) { return x.p.criado_por === eu() && !podeAprovar(x.area); });
    var soAcompanha = pendentes.filter(function(x) { return !podeAprovar(x.area) && x.p.criado_por !== eu(); });

    // 1. Aprovações (editor pleno / administrador)
    if (paraDecidir.length) {
      html += '<h3 class="pn-subtitulo">Para você aprovar (' + paraDecidir.length + ')</h3>' + paraDecidir.map(cartaoProposta).join('');
    } else if (perfil.admin || Object.keys(perfil.areas).some(function(a) { return grau(a) >= 4; })) {
      html += aviso('ok', 'Nenhuma proposta aguardando a sua aprovação.');
    }
    // 2. Propostas do próprio editor básico
    if (minhas.length) {
      html += '<h3 class="pn-subtitulo">Minhas propostas <small>pendentes e decididas nos últimos ' + DIAS + ' dias</small></h3>' + minhas.map(cartaoProposta).join('');
    }
    // 3. Gerenciador (ou quem só acompanha): quantas propostas estão paradas em cada área
    if (soAcompanha.length) {
      var porArea = {};
      soAcompanha.forEach(function(x) { porArea[x.area] = (porArea[x.area] || 0) + 1; });
      html += Object.keys(porArea).map(function(a) {
        var mais = soAcompanha.filter(function(x) { return x.area === a; }).sort(function(p, q) { return p.p.criado_em < q.p.criado_em ? -1 : 1; })[0];
        return aviso('atencao', porArea[a] + ' proposta' + (porArea[a] > 1 ? 's' : '') + ' aguardando aprovação · ' + esc(nomeArea(a)),
          'A mais antiga é de ' + fmtData(mais.p.criado_em.slice(0, 10)) + ' (' + esc(nomes[mais.p.criado_por] || '—') + ').', [linkArea(a), 'abrir no mapa']);
      }).join('');
    }
    // 4. Dados atrasados: o aviso aparece a partir de "atenção" e só some quando a origem atualizar a data de referência
    //    (não tem prazo nem botão de dispensar).
    var linhas = atualizacaoPorOrigem();
    [['atrasada', 'desatualizados', function(l) { return l.dias == null || l.dias > PRAZO.atencao; }, 'mais de ' + PRAZO.atencao + ' dias'],
     ['atencao', 'precisando de atualização', function(l) { return l.dias != null && l.dias > PRAZO.emDia && l.dias <= PRAZO.atencao; }, 'entre ' + (PRAZO.emDia + 1) + ' e ' + PRAZO.atencao + ' dias']
    ].forEach(function(g) {
      var lista = linhas.filter(g[2]);
      if (!lista.length) return;
      html += aviso(g[0] === 'atrasada' ? 'grave' : 'atencao', lista.length + ' origem' + (lista.length > 1 ? 'ns' : '') + ' com dados ' + g[1],
        lista.map(function(l) { return '<b>' + esc(l.origem.codigo) + '</b> ' + (l.data ? fmtData(l.data) + ' (' + num(l.dias) + ' dias)' : 'sem data'); }).join(' · ') +
        '. Data de referência há ' + g[3] + '. O aviso fica até a origem atualizar os dados.');
    });
    // 5. Contas (administrador)
    if (contas) {
      var inativas = contas.filter(function(u) { return !u.ativo; }), senha = contas.filter(function(u) { return u.ativo && u.trocar_senha; });
      if (inativas.length) html += aviso('atencao', inativas.length + ' conta' + (inativas.length > 1 ? 's' : '') + ' inativa' + (inativas.length > 1 ? 's' : ''),
        inativas.map(function(u) { return esc(u.nome); }).join(', ') + '. Ative e escolha os níveis.', ['usuarios.html', 'Usuários e permissões']);
      if (senha.length) html += aviso('info', senha.length + ' pessoa' + (senha.length > 1 ? 's' : '') + ' ainda com senha provisória',
        senha.map(function(u) { return esc(u.nome); }).join(', ') + ' (ainda não entrou para criar a própria senha).');
    }
    $('listaAvisos').innerHTML = html || aviso('ok', 'Nenhum aviso no momento.');
  }

  function rpcDe(fonte) { return fonte === 'jurisdicao' ? sbJur : sb; }
  function separar(v) { var i = v.indexOf(':'); return { fonte: v.slice(0, i), pid: Number(v.slice(i + 1)) }; }
  function depoisDeDecidir(msg) {
    toast(msg);
    return carregar().then(function() { renderFiltros(); renderResumo(); renderAvisos(); });
  }
  function aprovar(v, forcar) {
    var x = separar(v);
    rpcDe(x.fonte).rpc('aprovar_proposta', { p_pid: x.pid, p_forcar: !!forcar }).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      return depoisDeDecidir('Proposta aprovada');
    }).catch(function(e) {
      if (/CONFLITO/.test(e.message) && confirm(e.message.replace('CONFLITO: ', '') + '.\n\nAprovar mesmo assim? Os campos da proposta sobrescrevem os valores atuais.')) return aprovar(v, true);
      toast(e.message, true);
    });
  }
  function aoClicarAvisos(e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.aprovar) return aprovar(b.dataset.aprovar);
    if (b.dataset.recusar) { var caixa = b.closest('.pn-proposta').querySelector('.pn-recusa'); caixa.hidden = false; caixa.querySelector('textarea').focus(); return; }
    if (b.dataset.confirmarRecusa) {
      var motivo = b.closest('.pn-recusa').querySelector('textarea').value.trim();
      if (!motivo) { toast('Escreva o motivo da recusa', true); return; }
      var x = separar(b.dataset.confirmarRecusa);
      return rpcDe(x.fonte).rpc('recusar_proposta', { p_pid: x.pid, p_motivo: motivo }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return depoisDeDecidir('Proposta recusada');
      }).catch(function(err) { toast(err.message, true); });
    }
    if (b.dataset.cancelar) {
      if (!confirm('Cancelar esta proposta?')) return;
      var y = separar(b.dataset.cancelar);
      return rpcDe(y.fonte).rpc('cancelar_proposta', { p_pid: y.pid }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return depoisDeDecidir('Proposta cancelada');
      }).catch(function(err) { toast(err.message, true); });
    }
  }

  // ---------- Configurações (administrador) ----------
  var contas = null, areasAdm = [], camadasAdm = [];
  function carregarContas() {
    if (!perfil.admin) return Promise.resolve();
    return sb.rpc('admin_usuarios').then(dados).then(function(d) {
      contas = d.usuarios; areasAdm = d.areas; camadasAdm = d.camadas || [];
      contas.forEach(function(u) { u.camadas = u.camadas || []; });
    });
  }
  function renderMatriz() {
    var ativos = contas.filter(function(u) { return u.ativo; }).length;
    $('resumoUsuarios').textContent = contas.length + ' conta' + (contas.length === 1 ? '' : 's') + ' · ' + ativos + ' ativa' + (ativos === 1 ? '' : 's');
    var areas = areasAdm.slice().sort(function(a, b) { return (a.tipo === 'site') - (b.tipo === 'site'); });
    $('matriz').innerHTML = '<table class="pn-tabela pn-matriz"><thead><tr><th>Usuário</th>' +
      areas.map(function(a) { return '<th title="' + esc(a.nome) + '">' + esc(a.codigo === 'JURISDICAO' ? 'JUR' : a.codigo === 'FUNDEINFRA' ? 'FUND' : a.codigo === 'HOSPITAL' ? 'SAÚDE' : a.codigo) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + contas.map(function(u) {
        return '<tr' + (u.ativo ? '' : ' class="inativo"') + '><td><b>' + esc(u.nome) + '</b>' + (u.master ? ' <span class="selo selo-master">master</span>' : u.admin ? ' <span class="selo selo-admin">admin</span>' : '') +
          (u.ativo ? '' : ' <span class="selo selo-inativo">inativa</span>') + '<small>' + esc(u.email) + '</small></td>' +
          areas.map(function(a) {
            if (u.admin) return '<td><span class="nv nv-admin" title="administrador">ADM</span></td>';
            var n = u.areas[a.codigo];
            return '<td>' + (n ? '<span class="nv nv-' + n + '" title="' + esc(a.nome + ': ' + NOME_NIVEL[n]) + '">' + SIGLA_NIVEL[n] + '</span>' : '<span class="nv-nada">·</span>') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  // Camadas editáveis: uma linha por editor pleno (em alguma área); administradores editam todas.
  function renderCamadas() {
    var camadas = camadasAdm;
    var plenos = contas.filter(function(u) { return u.admin || Object.keys(u.areas).some(function(a) { return u.areas[a] === 'editor_pleno'; }); });
    if (!camadas.length) { $('camadasEdicao').innerHTML = '<div class="vazio">Camadas editáveis ainda não instaladas no banco.</div>'; return; }
    $('camadasEdicao').innerHTML = '<table class="pn-tabela pn-matriz pn-camadas"><thead><tr><th>Editor pleno</th>' +
      camadas.map(function(c) { return '<th title="' + esc(c.codigo) + '">' + esc(c.nome) + '<small>' + esc(c.geometria) + '</small></th>'; }).join('') +
      '</tr></thead><tbody>' + (plenos.length ? plenos.map(function(u) {
        var plenoEm = Object.keys(u.areas).filter(function(a) { return u.areas[a] === 'editor_pleno'; });
        return '<tr' + (u.ativo ? '' : ' class="inativo"') + '><td><b>' + esc(u.nome) + '</b>' + (u.admin ? ' <span class="selo selo-admin">admin</span>' : '') +
          '<small>' + (u.admin ? 'administrador: edita todas' : 'pleno em ' + esc(plenoEm.map(nomeArea).join(', '))) + '</small></td>' +
          camadas.map(function(c) {
            var pelaJur = c.codigo === 'extra_base' && u.areas.JURISDICAO === 'editor_pleno';
            var marcado = u.admin || pelaJur || u.camadas.indexOf(c.codigo) !== -1;
            var travado = u.admin || pelaJur;
            return '<td><input type="checkbox" data-camada-user="' + u.user_id + '" data-camada="' + esc(c.codigo) + '"' + (marcado ? ' checked' : '') + (travado ? ' disabled data-travado' : '') +
              ' title="' + esc(u.admin ? 'Administrador edita todas' : pelaJur ? 'Já liberada por ser editor pleno da Jurisdição' : c.nome) + '"></td>';
          }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + (camadas.length + 1) + '"><div class="vazio">Nenhum editor pleno ainda. Dê o nível editor pleno em alguma área (Usuários e permissões).</div></td></tr>') +
      '</tbody></table>';
  }
  function salvarCamadas(input) {
    var id = input.dataset.camadaUser, u = contas.find(function(x) { return x.user_id === id; });
    // Manda sempre a linha inteira (as travadas, de admin e da Jurisdição, não entram): cliques seguidos não se perdem.
    var lista = Array.prototype.map.call(document.querySelectorAll('[data-camada-user="' + id + '"]:checked:not([data-travado])'), function(x) { return x.dataset.camada; });
    sb.rpc('admin_salvar_camadas', { p_user_id: id, p_camadas: lista }).then(function(res) {
      if (res.error) throw new Error(res.error.message);
      u.camadas = lista;
      toast('Camadas de ' + u.nome + ' salvas: ' + (lista.length ? lista.length + ' camada(s)' : 'nenhuma'));
    }).catch(function(e) {
      input.checked = !input.checked;
      toast(e.message, true);
    });
  }

  var EVENTO = { acesso: 'entrou', saiu: 'saiu', exportou: 'exportou', acesso_negado: 'acesso negado' };
  function renderAcessos() {
    $('acessos').innerHTML = '<div class="vazio">Carregando…</div>';
    sb.from('acessos').select('quando,usuario_nome,email,evento,detalhe').order('quando', { ascending: false }).limit(50).then(dados).then(function(linhas) {
      $('acessos').innerHTML = linhas.length ? '<table class="pn-tabela"><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead><tbody>' +
        linhas.map(function(a) {
          return '<tr><td>' + fmtDataHora(a.quando) + '</td><td>' + esc(a.usuario_nome || a.email) + '</td><td>' + esc(EVENTO[a.evento] || a.evento) + '</td><td>' + esc(a.detalhe || '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="vazio">Nenhum acesso registrado.</div>';
    }).catch(function(e) { $('acessos').innerHTML = '<div class="vazio">Erro: ' + esc(e.message) + '</div>'; });
  }

  // ---------- Dica (tooltip) dos gráficos ----------
  function ligarDica() {
    var dica = $('dica');
    function mostrar(el, x, y) {
      var partes = el.getAttribute('data-dica').split('|');
      dica.textContent = '';
      var t = document.createElement('small'); t.textContent = partes[0]; dica.appendChild(t);
      var v = document.createElement('b'); v.textContent = partes[1] || ''; dica.appendChild(v);
      if (partes[2]) { var d = document.createElement('span'); d.textContent = partes[2]; dica.appendChild(d); }
      dica.hidden = false;
      var w = dica.offsetWidth, h = dica.offsetHeight;
      dica.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
      dica.style.top = Math.max(8, y - h - 12) + 'px';
    }
    document.addEventListener('pointermove', function(e) {
      var el = e.target.closest && e.target.closest('[data-dica]');
      if (el) mostrar(el, e.clientX, e.clientY); else dica.hidden = true;
    });
    document.addEventListener('scroll', function() { dica.hidden = true; }, true);
  }

  // ---------- Início ----------
  function papel() {
    if (perfil.master) return 'Administrador master';
    if (perfil.admin) return 'Administrador';
    var max = Math.max.apply(null, Object.keys(perfil.areas).map(grau));
    var nivel = Object.keys(NOME_NIVEL)[max - 1];
    var areas = Object.keys(perfil.areas).filter(function(a) { return grau(a) === max; });
    return NOME_NIVEL[nivel].replace(/^./, function(c) { return c.toUpperCase(); }) + ' · ' + (areas.length > 4 ? areas.length + ' áreas' : areas.map(nomeArea).join(', '));
  }

  Acesso.pronto.then(function(p) {
    perfil = p;
    var libera = p.admin || Object.keys(p.areas).some(function(a) { return grau(a) >= 2; });
    if (!libera) { $('restrito').hidden = false; return; }
    $('painel').hidden = false;
    $('papel').textContent = papel();
    $('abaBotaoConfig').hidden = !p.admin;
    $('kpis').innerHTML = '<div class="vazio">Carregando…</div>';
    ligarDica();
    $('filtros').addEventListener('click', function(e) { var b = e.target.closest('[data-origem]'); if (b) { filtro = ''; filtrar(b.dataset.origem); } });
    $('gEtapas').addEventListener('click', function(e) { var b = e.target.closest('[data-origem]'); if (b) filtrar(b.dataset.origem); });
    $('listaAvisos').addEventListener('click', aoClicarAvisos);
    document.querySelectorAll('.adm-abas button').forEach(function(b) {
      b.addEventListener('click', function() {
        document.querySelectorAll('.adm-abas button').forEach(function(x) { x.classList.toggle('ativo', x === b); });
        $('abaGeral').hidden = b.dataset.aba !== 'geral';
        $('abaConfig').hidden = b.dataset.aba !== 'config';
        if (b.dataset.aba === 'config') carga.then(function() { renderMatriz(); renderCamadas(); renderAcessos(); });
      });
    });
    $('camadasEdicao').addEventListener('change', function(e) { if (e.target.dataset.camadaUser) salvarCamadas(e.target); });
    var carga = Promise.all([carregar(), carregarContas()]);   // a aba Configurações espera por ela
    return carga.then(function() {
      renderFiltros();
      renderResumo();
      renderAvisos();
    });
  }).catch(function(e) { toast('Erro ao carregar o painel: ' + e.message, true); });
})();
