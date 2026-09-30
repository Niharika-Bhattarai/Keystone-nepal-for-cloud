/* Moved out of index.html so the Content-Security-Policy can forbid inline
   scripts. Loaded synchronously, as before, so it runs before the app. */
// Disable browser scroll restoration so refresh always starts at top
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// Scroll progress bar
(function() {
    var bar = document.getElementById('scroll-progress');
    if (!bar) return;
    var ticking = false;
    function updateBar() {
        var scrollTop = window.scrollY || document.documentElement.scrollTop;
        var docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        var pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
        bar.style.transform = 'scaleX(' + (pct / 100) + ')';
        ticking = false;
    }
    window.addEventListener('scroll', function() {
        if (!ticking) { requestAnimationFrame(updateBar); ticking = true; }
    }, { passive: true });
})();
