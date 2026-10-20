(function () {
  function submitLogout() {
    var form = document.getElementById("op.logoutForm");
    if (!form || typeof form.requestSubmit !== "function") return;
    form.requestSubmit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      requestAnimationFrame(submitLogout);
    });
  } else {
    requestAnimationFrame(submitLogout);
  }
})();
