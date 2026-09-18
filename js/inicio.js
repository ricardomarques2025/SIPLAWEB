(function() {
  var pagina = document.querySelector('.inicio');
  var links = document.querySelectorAll('.inicio-link[data-bg]');
  var imagem = document.getElementById('inicioFotoImg');

  if (!pagina || !links.length || !imagem) return;

  function aplicarFundo(link) {
    var caminho = link.getAttribute('data-bg');
    if (!caminho) return;
    imagem.src = caminho;
  }

  links.forEach(function(link) {
    link.addEventListener('mouseenter', function() {
      aplicarFundo(link);
    });

    link.addEventListener('focus', function() {
      aplicarFundo(link);
    });
  });

  var geral = document.querySelector('.inicio-link[href*="perfil=geral"]');
  aplicarFundo(geral || links[0]);
})();
