(function () {
  // Cash-on-Delivery block — appearance.
  //
  // Applies the Form builder / template look to each block once cod-form.js
  // has loaded the settings and announced them with "cod:cfg". Works whichever
  // script runs first: blocks that already have settings are styled on load.
  var ICONS = {
    cart: "M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 3h2l2.7 11.4A2 2 0 0 0 9.6 16h7.9a2 2 0 0 0 2-1.6L21 7H6",
    bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
    truck: "M3 6h11v9H3V6Zm11 3h4l3 3v3h-7V9ZM7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    shield: "M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z"
  };
  var FONT_STACKS = {
    theme: "inherit",
    system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif"
  };
  // "--cod-<name>" <- builder field; a trailing "px" marks a length.
  var VARS = [
    "btn buttonBg", "btn-text buttonTextColor", "btn-hover buttonHoverBg",
    "btn-radius buttonRadius px", "btn-size buttonTextSize px", "btn-pad-y buttonPaddingY px",
    "accent accentColor", "modal-bg modalBg", "modal-text modalTextColor",
    "radius modalRadius px", "width modalWidth px", "heading-size headingSize px",
    "heading-align headingAlign", "overlay-blur overlayBlur px",
    "input-radius inputRadius px", "input-pad-y inputPaddingY px",
    "input-border inputBorderColor", "input-bg inputBg",
    "submit-bg submitBg", "submit-text submitTextColor",
    "font baseFontSize px"
  ];

  function style(root) {
    if (!root || root.codStyled || !root.codCfg || !root.codApi) return;
    root.codStyled = true;
    var cfg = root.codCfg, api = root.codApi, overlay = api.overlay;

    // Countdown ("Hurry! Sale ends in 9:59"), started the first time the form
    // opens — cod-form.js calls root.codTimer() from open().
    var timerEl = overlay.querySelector("[data-cod-timer]");
    var minutes = parseInt(cfg.countdownMinutes, 10) || 0;
    root.codTimer = function () {
      if (!timerEl || minutes <= 0 || root.codTimerOn) return;
      root.codTimerOn = true;
      timerEl.hidden = false;
      var remaining = minutes * 60;
      (function tick() {
        var m = Math.floor(remaining / 60), s = remaining % 60;
        timerEl.textContent = ((cfg.t && cfg.t.hurry) || "Hurry! Sale ends in") + " " + m + ":" + (s < 10 ? "0" : "") + s;
        if (remaining > 0) { remaining--; setTimeout(tick, 1000); }
      })();
    };

    var bc = cfg.builder;
    if (!bc) return;

    function apply(el) {
      VARS.forEach(function (spec) {
        var p = spec.split(" "), v = bc[p[1]];
        if (v != null && v !== "") el.style.setProperty("--cod-" + p[0], v + (p[2] || ""));
      });
      if (bc.overlayOpacity != null) {
        el.style.setProperty("--cod-overlay-bg", "rgba(0,0,0," + (bc.overlayOpacity / 100).toFixed(2) + ")");
      }
      if (bc.fontFamily && FONT_STACKS[bc.fontFamily]) el.style.setProperty("--cod-font-family", FONT_STACKS[bc.fontFamily]);
    }
    apply(root);
    apply(overlay);

    // Applied to both: the overlay lives under <body>, outside root.
    function toggle(cls, on) {
      root.classList.toggle(cls, !!on);
      overlay.classList.toggle(cls, !!on);
    }
    toggle("cod--stacked", bc.fieldLayout === "stacked");
    toggle("cod--no-img", bc.showProductImage === false);
    toggle("cod--btn-normal", bc.buttonBold === false);
    toggle("cod--btn-auto", bc.buttonFullWidth === false);
    toggle("cod--sticky", bc.stickyMobile === true);
    toggle("cod--anim-pulse", bc.buttonAnimation === "pulse");
    toggle("cod--anim-shine", bc.buttonAnimation === "shine");

    var openBtn = root.querySelector("[data-cod-open]");

    // Embedded mode: the form sits inline on the page, no open button.
    if (bc.formType === "embedded" && api.home) {
      api.home.appendChild(overlay);
      overlay.classList.add("cod--embedded");
      if (openBtn) openBtn.hidden = true;
      root.codTimer();
    }

    // Button label (already in the visitor's language), subtitle and icon.
    // ICONS are constants here, so the SVG string injects nothing external.
    if (openBtn && bc.buttonText) {
      openBtn.innerHTML = bc.buttonIcon && ICONS[bc.buttonIcon]
        ? '<svg viewBox="0 0 24 24" width="1.05em" height="1.05em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
          ICONS[bc.buttonIcon] + '"/></svg>'
        : "";
      var label = document.createElement("span");
      label.textContent = bc.buttonText;
      if (bc.buttonSubtitle) {
        var sub = document.createElement("div");
        sub.className = "cod__sub";
        sub.textContent = bc.buttonSubtitle;
        label.appendChild(sub);
      }
      openBtn.appendChild(label);
    }

    if (bc.trustBadge) {
      var submit = overlay.querySelector("[data-cod-submit]");
      var badge = overlay.querySelector("[data-cod-trust]");
      if (!badge && submit) {
        badge = document.createElement("p");
        badge.className = "cod__trust";
        badge.setAttribute("data-cod-trust", "");
        submit.parentNode.insertBefore(badge, submit.nextSibling);
      }
      if (badge) badge.textContent = bc.trustBadge;
    }
  }

  // Smart recommendations (Unlimited plan): Shopify's own complementary
  // products for this page's product, falling back to related ones, offered as
  // plain add-ons at their normal price.
  function recommend(root) {
    var cfg = root.codCfg, rec = cfg && cfg.recommend;
    var pid = root.getAttribute("data-product-id");
    if (!rec || !pid || !root.codApi.addOffers) return;
    var base = (root.getAttribute("data-cart-url") || "/cart").replace(/\/+$/, "").replace(/\/cart$/, "");
    var taken = {};
    (cfg.upsells || []).forEach(function (o) { (o.items || []).forEach(function (i) { taken[String(i.productId || "").replace(/\D/g, "")] = 1; }); });
    taken[pid] = 1;
    function get(intent) {
      return fetch(base + "/recommendations/products.json?product_id=" + pid + "&limit=" + (rec.limit + 2) + "&intent=" + intent)
        .then(function (r) { return r.ok ? r.json() : { products: [] }; })
        .then(function (d) { return (d.products || []).filter(function (p) { return !taken[p.id]; }); });
    }
    get("complementary")
      .then(function (list) { return list.length ? list : get("related"); })
      .then(function (list) {
        var offers = [];
        list.forEach(function (p) {
          var v = (p.variants || []).filter(function (x) { return x.available !== false; })[0];
          if (!v || offers.length >= rec.limit) return;
          var img = p.featured_image || (p.images && p.images[0]) || "";
          offers.push({
            id: "rec-" + p.id,
            title: (cfg.t && cfg.t.recTitle) || "You may also like",
            kind: "product",
            discountPercent: 0,
            // The Ajax API reports prices in the smallest unit (cents).
            items: [{ variantId: String(v.id), productId: String(p.id), title: p.title, image: typeof img === "string" ? img : img.src || "", price: (v.price || 0) / 100 }]
          });
        });
        if (offers.length) root.codApi.addOffers(offers);
      })
      .catch(function () {});
  }

  function setup(root) {
    if (!root || root.codStyled || !root.codCfg || !root.codApi) return;
    style(root);
    recommend(root);
  }

  document.addEventListener("cod:cfg", function (e) { setup(e.detail); });
  document.querySelectorAll("[data-cod-form]").forEach(setup);
})();
