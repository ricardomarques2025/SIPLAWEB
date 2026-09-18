// Suaviza a abertura e o fechamento sem fixar a altura final dos menus.
(function() {
  var movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.querySelectorAll('details.painel-colapsavel, details.filtro-regional').forEach(function(painel) {
    var titulo = painel.querySelector('summary');
    var animacao = null;
    var destinoAberto = painel.open;

    function finalizar() {
      painel.open = destinoAberto;
      painel.classList.remove('painel-em-transicao');
      painel.removeAttribute('data-expandido');
      if (animacao) {
        animacao.onfinish = null;
        animacao.cancel();
        animacao = null;
      }
    }

    titulo.addEventListener('click', function(evento) {
      evento.preventDefault();
      destinoAberto = animacao ? !destinoAberto : !painel.open;
      var alturaInicial = painel.getBoundingClientRect().height;
      if (animacao) {
        animacao.onfinish = null;
        animacao.cancel();
        animacao = null;
      }

      if (movimentoReduzido.matches || !painel.animate) {
        finalizar();
        return;
      }

      // Mede o destino na altura natural, inclusive nos filtros aninhados.
      painel.open = destinoAberto;
      var alturaFinal = painel.getBoundingClientRect().height;
      painel.open = true;
      painel.classList.add('painel-em-transicao');
      painel.setAttribute('data-expandido', String(destinoAberto));
      animacao = painel.animate([
        { height: alturaInicial + 'px' },
        { height: alturaFinal + 'px' }
      ], {
        duration: 300,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'both'
      });
      animacao.onfinish = finalizar;
    });

    movimentoReduzido.addEventListener('change', function() {
      if (movimentoReduzido.matches && animacao) finalizar();
    });
  });
})();
