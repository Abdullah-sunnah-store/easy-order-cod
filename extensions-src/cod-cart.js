(function () {
  // Easy order COD — "Cash on Delivery" button on the cart page and cart drawer.
  //
  // Added next to the theme's own Check out button. It marks the cart with the
  // `_easy_order_cod` attribute and opens Shopify checkout, where the app's
  // payment customization makes Cash on Delivery the payment method. Nothing is
  // collected here and no order is created outside checkout.
  //
  // The theme's normal Check out button clears the mark, so a customer who
  // changes their mind can still pay by card.
  if (window.__easyCodCart) return;
  window.__easyCodCart = true;

  var ATTR = "_easy_order_cod";
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  var label = "Cash on Delivery";
  var bg = "", fg = "";
  var SELECTOR = 'button[name="checkout"], input[name="checkout"], #CartDrawer-Checkout';

  function mark(value) {
    var attributes = {};
    attributes[ATTR] = value;
    return fetch(root + "cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ attributes: attributes })
    });
  }

  function goCod(e) {
    e.preventDefault();
    var btn = e.currentTarget;
    btn.disabled = true;
    mark("1").catch(function () {}).then(function () {
      document.dispatchEvent(new CustomEvent("cod:checkout", { detail: 0 }));
      location.href = root + "checkout";
    });
  }

  function addButtons() {
    var targets = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < targets.length; i++) {
      var theirs = targets[i];
      if (theirs.getAttribute("data-cod-cart")) continue;
      theirs.setAttribute("data-cod-cart", "1");
      // Clear the COD mark first, then let the theme's own button continue —
      // otherwise the page can leave before the request lands.
      theirs.addEventListener("click", function (e) {
        var btn = e.currentTarget;
        if (btn.getAttribute("data-cod-cleared")) { btn.removeAttribute("data-cod-cleared"); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        mark("").catch(function () {}).then(function () {
          btn.setAttribute("data-cod-cleared", "1");
          btn.click();
        });
      }, true);

      var mine = document.createElement("button");
      mine.type = "button";
      mine.className = (theirs.className || "") + " cod-cart-btn";
      mine.textContent = label;
      mine.style.marginTop = "10px";
      mine.style.width = "100%";
      mine.style.flex = "1 1 100%";
      mine.style.whiteSpace = "nowrap";
      if (bg) { mine.style.background = bg; mine.style.borderColor = bg; }
      if (fg) mine.style.color = fg;
      mine.addEventListener("click", goCod);
      theirs.parentNode.insertBefore(mine, theirs.nextSibling);
    }
  }

  fetch("/apps/cod/settings", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || cfg.enabled === false || cfg.cartButton === false) return;
      if (cfg.t && cfg.t.button) label = cfg.t.button;
      if (cfg.builder) { bg = cfg.builder.buttonBg || ""; fg = cfg.builder.buttonTextColor || ""; }
      addButtons();
      // Cart drawers render their Check out button when they open.
      new MutationObserver(addButtons).observe(document.body, { childList: true, subtree: true });
    })
    .catch(function () {});
})();
