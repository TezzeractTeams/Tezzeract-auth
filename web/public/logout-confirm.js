(function () {
  function submitLogout() {
    var form = document.getElementById("op.logoutForm");
    if (!form) return;
    // form.submit() rather than requestSubmit(): it's the same mechanism the
    // provider's own default (unauthenticated) page uses successfully, and
    // it doesn't depend on the newer requestSubmit() API, which is more
    // likely to be affected by a same-tick browsing-context-group swap right
    // after a cross-site navigation lands here.
    form.submit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      requestAnimationFrame(submitLogout);
    });
  } else {
    requestAnimationFrame(submitLogout);
  }
})();
