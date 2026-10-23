// Pagina inicial (painel): cartoes por origem com os numeros reais do banco e atalhos.
(function() {
  var ORIGENS = [
    { sigla: 'FUNDEINFRA', nome: 'FUNDEINFRA', img: 'data/FUNDEINFRA.jpg' },
    { sigla: 'DOR', nome: 'Obras Rodoviárias', img: 'data/DOR.jpg' },
    { sigla: 'DMA', nome: 'Manutenção', img: 'data/DMA.jpg' },
    { sigla: 'DPJ', nome: 'Projetos', img: 'data/DPJ.jpg' },
    { sigla: 'DPL', nome: 'Planejamento', img: 'data/DPL.jpg' },
    { sigla: 'DOC', nome: 'Obras Civis', img: 'data/DOC.jpg' },
    { sigla: 'DSV', nome: 'Segurança Viária', img: 'data/DSV.jpg' }
  ];
  // Como chamar cada registro de DADOS na tela (troque aqui para mudar em toda a pagina).
  var ROTULO = { um: 'empreendimento', varios: 'empreendimentos', acompanhados: 'empreendimentos acompanhados' };
  var ATALHOS = [
    { nome: 'Mapa geral', desc: 'Todas as suas origens juntas', mosaico: true, href: 'mapa.html?perfil=geral' },
    { nome: 'Mapa rodoviário', desc: 'Malha estadual e federal', img: 'data/MAPA.jpg', href: 'mapa.html?perfil=rodoviario&sidebar=fechada' },
    { nome: 'Jurisdição', desc: 'Alterações de jurisdição das rodovias', img: 'data/JURISDICAO.jpg',
      href: 'mapa.html?modulo=jurisdicao', area: 'JURISDICAO' }
  ];
  var ETAPAS = [['Planejamento', 'var(--plan)'], ['Projeto', 'var(--projeto)'], ['Obra', 'var(--obra)'], ['outros', 'var(--outros)']];
  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function $(id) { return document.getElementById(id); }
  function numero(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function mesAno(texto) { return texto ? MESES[Number(texto.slice(5, 7)) - 1] + '/' + texto.slice(0, 4) : '—'; }
  function quantos(n) { return n === 1 ? ROTULO.um : ROTULO.varios; }

  $('grade').innerHTML = ORIGENS.map(function(o) {
    return '<a class="cartao" href="mapa.html?origem=' + o.sigla + '&sidebar=fechada" data-sigla="' + o.sigla + '" data-area="' + o.sigla + '">' +
      '<div class="foto" style="background-image:url(' + o.img + ')"><span class="sigla">' + o.sigla + '</span></div>' +
      '<div class="corpo"><div class="nome">' + o.nome + '</div>' +
      '<div class="total"><b>—</b><span>' + ROTULO.varios + '</span></div><div class="barra"></div></div></a>';
  }).join('');
  $('atalhos').innerHTML = ATALHOS.map(function(a) {
    return '<a class="atalho" href="' + a.href + '"' + (a.img ? ' style="background-image:url(' + a.img + ')"' : '') +
      (a.area ? ' data-area="' + a.area + '"' : '') + (a.mosaico ? ' id="atalhoGeral"' : '') + '>' +
      (a.mosaico ? '<span class="mosaico" id="mosaicoGeral"></span>' : '') +
      (a.externo ? '<span class="externo">' + a.externo + '</span>' : '') +
      '<div><b>' + a.nome + '</b><span>' + a.desc + '</span></div></a>';
  }).join('');
  $('rotuloTotal').textContent = ROTULO.acompanhados;

  // Mapa geral: faixas com as fotos das origens que o usuario pode ver.
  function montarMosaico(origens) {
    $('mosaicoGeral').innerHTML = origens.map(function(o) {
      return '<span title="' + o.nome + '"><i style="background-image:url(' + o.img + ')"></i></span>';
    }).join('');
  }
  montarMosaico(ORIGENS);

  Acesso.pronto.then(function(perfil) {
    var h = new Date().getHours();
    $('saudacao').textContent = (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + ', ' + perfil.nome.split(' ')[0];
    // Cartoes de origem sem acesso ja foram escondidos pelo acesso.js; sem nenhuma origem, some o Mapa geral.
    var visiveis = ORIGENS.filter(function(o) { return Acesso.podeVer(o.sigla); });
    if (visiveis.length) montarMosaico(visiveis);
    else {
      $('atalhoGeral').hidden = true;
      $('grade').innerHTML = '<p class="sem-origens">Nenhuma origem liberada para você ainda. Peça ao administrador.</p>';
      document.querySelector('.legenda-etapas').hidden = true;
    }
    return DadosBanco.registros();
  }).then(function(regs) {
    var porOrigem = {}, obra = 0, projeto = 0, atualizado = '';
    regs.forEach(function(o) {
      var x = porOrigem[o.UNIDADE] = porOrigem[o.UNIDADE] || { total: 0, Obra: 0, Projeto: 0, Planejamento: 0, outros: 0 };
      x.total++;
      if (x[o.ETAPA] !== undefined) x[o.ETAPA]++; else x.outros++;
      if (o.ETAPA === 'Obra') obra++;
      if (o.ETAPA === 'Projeto') projeto++;
      if (o.ATUALIZACAO && o.ATUALIZACAO > atualizado) atualizado = o.ATUALIZACAO;
    });
    $('nTotal').textContent = numero(regs.length);
    $('nObra').textContent = numero(obra);
    $('nProjeto').textContent = numero(projeto);
    $('nAtualizado').textContent = mesAno(atualizado);
    document.querySelectorAll('.cartao').forEach(function(c) {
      var x = porOrigem[c.getAttribute('data-sigla')] || { total: 0 };
      c.querySelector('.total b').textContent = numero(x.total);
      c.querySelector('.total span').textContent = quantos(x.total);
      c.querySelector('.barra').innerHTML = ETAPAS.filter(function(p) { return x[p[0]]; }).map(function(p) {
        return '<i style="flex:' + x[p[0]] + ';background:' + p[1] + '" title="' + (p[0] === 'outros' ? 'Outras etapas' : p[0]) + ': ' + x[p[0]] + '"></i>';
      }).join('');
    });
  });
})();
