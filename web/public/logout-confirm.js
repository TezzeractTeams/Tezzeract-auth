(function () {
  function submitLogout() {
    var form = document.getElementById("op.logoutForm");
    if (!form) return;
    // Root-relative action avoids Chrome blocking an absolute same-origin URL
    // after a cross-site navigation (CSP form-action 'self' false positive).
    try {
      var target = new URL(form.getAttribute("action") || form.action, window.location.href);
      if (target.origin === window.location.origin) {
        form.setAttribute("action", target.pathname + target.search);
      }
    } catch (_err) {
      // Keep provider-supplied action if parsing fails.
    }
    // form.submit() rather than requestSubmit(): same mechanism as the
    // provider's default page; less sensitive to browsing-context swaps.
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
