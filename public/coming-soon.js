/* Coming Soon toast — hijacks .muted nav links */
(function () {
  function ensureToast() {
    var t = document.getElementById('cs-toast');
    if (t) return t;
    t = document.createElement('div');
    t.id = 'cs-toast';
    t.innerHTML = '<span class="lbl">Coming soon</span>';
    document.body.appendChild(t);
    return t;
  }
  var hideTimer;
  function show(label) {
    var t = ensureToast();
    t.classList.add('on');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }
  function bind() {
    var nodes = document.querySelectorAll('.muted, .nav-link.muted, .bnav .links .muted');
    nodes.forEach(function (el) {
      if (el.dataset.csBound) return;
      el.dataset.csBound = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', function (e) {
        e.preventDefault();
        show((el.textContent || '').trim());
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
