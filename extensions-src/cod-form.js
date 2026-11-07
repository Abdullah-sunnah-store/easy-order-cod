(function () {
  // Cash-on-Delivery block — core logic.
  //
  // The customer picks a pack size, any add-on offers, and continues to Shopify
  // checkout. Contact details, address, shipping, taxes and payment all happen
  // in checkout; nothing that belongs to checkout is collected here and no
  // order is created behind Shopify's back (App Store requirement 1.1.2).
  //
  // Every discount shown here — quantity tiers, bundle prices, the downsell —
  // is a real Shopify discount the app created, so checkout charges what the
  // form shows. Appearance (colours, icon, embedded mode, trust line) lives in
  // cod-style.js, which picks up the settings this file announces with the
  // "cod:cfg" event; the 10 KB theme-check limit applies per file.
  function initCodForm(root) {
    var overlay = root.querySelector("[data-cod-overlay]");
    var formEl = root.querySelector("[data-cod-form-el]");
    var summaryEl = root.querySelector("[data-cod-summary]");
    var submitBtn = root.querySelector("[data-cod-submit]");
    var messageEl = root.querySelector("[data-cod-message]");
    var qtyInput = root.querySelector("[data-cod-qty]");
    var tiersEl = root.querySelector("[data-cod-tiers]");
    var openBtn = root.querySelector("[data-cod-open]");
    if (!formEl || !overlay) return;

    var title = root.getAttribute("data-product-title") || "Product";
    var image = root.getAttribute("data-product-image") || "";
    var moneyFormat = root.getAttribute("data-money-format") || "";
    var currency = "";
    var buttonLabel = "Continue to checkout";
    var showTotal = true;
    var submitted = false;
    var T = {};
    var tiers = [];
    var downsell = null, dsShown = false, dsApplied = false;
    var track = { v: 0, o: 0, c: 0 };

    // Strings arrive from the app (already in the visitor's language); these
    // are only the fallbacks for when the settings request fails.
    function t(key, def, p) {
      var s = T[key] || def || "";
      return p == null ? s : s.replace("{p}", p);
    }

    // Cart routes follow the theme's own cart URL so /fr/cart keeps working.
    var cartUrl = (root.getAttribute("data-cart-url") || "/cart").replace(/\/+$/, "");
    var base = cartUrl.replace(/\/cart$/, "");
    var addUrl = cartUrl + "/add.js";
    var updateUrl = cartUrl + "/update.js";
    var checkoutUrl = base + "/checkout";
    var CART_ATTRIBUTE = "_easy_order_cod";
    var JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
    function make(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }

    // ---- Variant + price ----------------------------------------------------
    var fallbackVariantId = root.getAttribute("data-variant-id") || "";
    var priceByVariant = {};
    (root.getAttribute("data-variants") || "").split(",").forEach(function (pair) {
      var bits = pair.split(":");
      if (bits.length === 2) priceByVariant[bits[0].trim()] = parseInt(bits[1], 10) || 0;
    });
    var fallbackPrice = parseInt(root.getAttribute("data-price") || "0", 10) || 0;
    var section = root.closest(".shopify-section, section") || document;
    function currentVariantId() {
      var sel = 'form[action*="/cart/add"] [name="id"]:not([disabled])';
      var input = section.querySelector(sel) || document.querySelector(sel);
      if (input && input.value) return String(input.value);
      return String(new URLSearchParams(location.search).get("variant") || fallbackVariantId);
    }
    function unitPriceCents() {
      var id = currentVariantId();
      return id in priceByVariant ? priceByVariant[id] : fallbackPrice;
    }

    // ---- Money --------------------------------------------------------------
    function group(amount, decimals, thousands, decimal) {
      var parts = Math.abs(amount).toFixed(decimals).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return (amount < 0 ? "-" : "") + parts.join(decimals ? decimal : "");
    }
    var MONEY_TOKENS = {
      amount_no_decimals: [0, ",", "."],
      amount_with_comma_separator: [2, ".", ","],
      amount_no_decimals_with_comma_separator: [0, ".", ","],
      amount_with_apostrophe_separator: [2, "'", "."],
      amount_no_decimals_with_space_separator: [0, " ", ","],
      amount_with_space_separator: [2, " ", ","]
    };
    function money(cents) {
      var amount = cents / 100;
      if (currency) return currency + group(amount, 2, ",", ".");
      if (!moneyFormat) return "$" + group(amount, 2, ",", ".");
      return moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, token) {
        var f = MONEY_TOKENS[token] || [2, ",", "."];
        return group(amount, f[0], f[1], f[2]);
      });
    }
    function priceHtml(cents, pct) {
      var now = Math.round(cents * (1 - pct / 100));
      return (pct > 0 ? "<s>" + money(cents) + "</s> " : "") + money(now);
    }
    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    // ---- Quantity tiers -----------------------------------------------------
    function qty() { return Math.max(1, parseInt((qtyInput && qtyInput.value) || "1", 10) || 1); }
    function tierPct(q) {
      var best = 0;
      tiers.forEach(function (tr) { if (q >= tr.qty && tr.percent > best) best = tr.percent; });
      return best;
    }
    function renderTiers() {
      if (!tiersEl) return;
      tiersEl.textContent = "";
      tiersEl.hidden = !tiers.length;
      var qtyRow = formEl.querySelector('[data-cod-field="quantity"]');
      if (qtyRow) qtyRow.hidden = !!tiers.length;
      var unit = unitPriceCents();
      tiers.forEach(function (tr) {
        var row = make("label", "cod__tier");
        row.innerHTML =
          '<input type="radio" name="cod-tier" value="' + tr.qty + '"' + (qty() === tr.qty ? " checked" : "") + " />" +
          '<span class="cod__tier-name">' + esc(tr.label || tr.qty + " ×") +
          (tr.badge ? ' <em class="cod__tier-badge">' + esc(tr.badge) + "</em>" : "") +
          (tr.percent ? ' <small class="cod__tier-save">' + esc(t("save", "Save {p}%", tr.percent)) + "</small>" : "") +
          '</span><b class="cod__tier-price">' + priceHtml(unit * tr.qty, tr.percent) + "</b>";
        row.firstChild.addEventListener("change", function () {
          if (qtyInput) qtyInput.value = tr.qty;
          renderSummary();
        });
        tiersEl.appendChild(row);
      });
    }

    // ---- Add-on offers ------------------------------------------------------
    var offers = [];
    var offersWrap = overlay.querySelector("[data-cod-offers]");
    var offersList = overlay.querySelector("[data-cod-offers-list]");
    function itemCents(price) { return Math.round((parseFloat(price) || 0) * 100); }
    function numericId(gid) { var m = String(gid || "").match(/(\d+)\s*$/); return m ? m[1] : String(gid || ""); }
    function offerById(id) { for (var i = 0; i < offers.length; i++) if (offers[i].id === id) return offers[i]; return null; }

    function chosenOffers() {
      var out = [];
      if (!offersList) return out;
      var boxes = offersList.querySelectorAll("input[data-cod-offer]");
      for (var i = 0; i < boxes.length; i++) {
        if (!boxes[i].checked) continue;
        var id = boxes[i].getAttribute("data-cod-offer");
        var offer = offerById(id) || {};
        var pick = offersList.querySelector('select[data-cod-offer-pick="' + id + '"]');
        var variantId = pick ? pick.value : boxes[i].getAttribute("data-variant");
        var opt = pick ? pick.options[pick.selectedIndex] : boxes[i];
        var name = pick ? opt.getAttribute("data-name") : boxes[i].getAttribute("data-name");
        if (variantId) out.push({
          variantId: variantId,
          name: name || offer.title,
          cents: parseInt(opt.getAttribute("data-cents") || "0", 10) || 0,
          pct: offer.discountPercent || 0
        });
      }
      return out;
    }

    function renderOffers() {
      if (!offersWrap || !offersList) return;
      offersList.textContent = "";
      var addable = offers.filter(function (o) { return (o.items || []).length > 0; });
      offersWrap.hidden = !addable.length;
      addable.forEach(function (offer) {
        var row = make("label", "cod__offer");
        var box = make("input");
        box.type = "checkbox";
        box.setAttribute("data-cod-offer", offer.id);
        var first = offer.items[0];
        var pct = offer.discountPercent || 0;
        var body = make("span", "cod__offer-body");
        var head = make("span", "cod__offer-head");
        head.textContent = offer.title || t("special", "Special offer");
        body.appendChild(head);
        if (offer.kind === "collection" && offer.items.length > 1) {
          var pick = make("select", "cod__offer-pick");
          pick.setAttribute("data-cod-offer-pick", offer.id);
          offer.items.forEach(function (item) {
            var opt = make("option");
            var cents = itemCents(item.price);
            opt.value = item.variantId;
            opt.setAttribute("data-cents", String(cents));
            opt.setAttribute("data-name", item.title);
            opt.textContent = item.title + " — " + money(Math.round(cents * (1 - pct / 100)));
            pick.appendChild(opt);
          });
          body.appendChild(pick);
        } else {
          box.setAttribute("data-variant", first.variantId);
          box.setAttribute("data-cents", String(itemCents(first.price)));
          box.setAttribute("data-name", first.title);
          var line = make("span", "cod__offer-line");
          if (first.image) { var img = make("img"); img.src = first.image; img.alt = ""; line.appendChild(img); }
          var nm = make("span");
          nm.textContent = first.title;
          line.appendChild(nm);
          body.appendChild(line);
        }
        var priceEl = make("b", "cod__offer-price");
        priceEl.innerHTML = priceHtml(itemCents(first.price), pct);
        row.appendChild(box);
        row.appendChild(body);
        row.appendChild(priceEl);
        offersList.appendChild(row);
      });
    }

    // ---- Summary ------------------------------------------------------------
    // Items only: shipping, tax and any COD fee are checkout's to calculate.
    function totals() {
      var q = qty(), unit = unitPriceCents(), sub = unit * q, save = Math.round(sub * tierPct(q) / 100);
      chosenOffers().forEach(function (c) { sub += c.cents; save += Math.round(c.cents * c.pct / 100); });
      return { sub: sub, save: save, total: sub - save };
    }
    function renderSummary() {
      var tt = totals();
      var rows = '<div class="cod__product">' + (image ? '<img src="' + esc(image) + '" alt="" />' : "") +
        "<span>" + esc(title) + " × " + qty() + "</span></div>";
      chosenOffers().forEach(function (c) {
        rows += '<div class="cod__line cod__line--add"><span>+ ' + esc(c.name || t("added", "Added item")) +
          "</span><b>" + priceHtml(c.cents, c.pct) + "</b></div>";
      });
      if (tt.save > 0) rows += '<div class="cod__line cod__line--save"><span>' + esc(t("savings", "You save")) + "</span><b>−" + money(tt.save) + "</b></div>";
      rows += '<div class="cod__line cod__total"><span>' + esc(t("subtotal", "Items subtotal")) + "</span><b>" + money(tt.total) + "</b></div>";
      summaryEl.innerHTML = rows;
      submitBtn.textContent = showTotal ? buttonLabel + " — " + money(tt.total) : buttonLabel;
    }
    function showMessage(text, kind) {
      messageEl.textContent = text;
      messageEl.hidden = false;
      messageEl.className = "cod__msg cod__msg--" + kind;
    }

    // ---- Open / close / downsell -------------------------------------------
    var overlayHome = overlay.parentNode;
    document.body.appendChild(overlay);
    function isOpen() { return overlay.classList.contains("cod--open"); }
    function open() {
      submitted = false;
      submitBtn.disabled = false;
      if (!dsApplied) messageEl.hidden = true;
      renderTiers();
      renderSummary();
      overlay.classList.add("cod--open");
      document.body.style.overflow = "hidden";
      track.o = 1;
      if (root.codTimer) root.codTimer(); // countdown lives in cod-style.js
    }
    function hide() { overlay.classList.remove("cod--open"); document.body.style.overflow = ""; }
    function close() {
      if (!isOpen()) return;
      if (downsell && !dsShown && !submitted) { dsShown = true; showDownsell(); return; }
      hide();
    }
    function showDownsell() {
      var modal = overlay.querySelector(".cod__modal") || overlay;
      var panel = make("div", "cod__ds");
      panel.innerHTML = '<p class="cod__ds-title">' + esc(t("dsTitle", "", downsell.percent)) + "</p>" +
        '<button type="button" class="cod__submit" data-yes>' + esc(t("dsYes", "")) + "</button>" +
        '<button type="button" class="cod__ds-no" data-no>' + esc(t("dsNo", "")) + "</button>";
      modal.appendChild(panel);
      panel.querySelector("[data-yes]").onclick = function () {
        dsApplied = true;
        panel.remove();
        showMessage(t("dsApplied", "", downsell.percent), "success");
      };
      panel.querySelector("[data-no]").onclick = function () { panel.remove(); hide(); };
    }
    if (openBtn) openBtn.addEventListener("click", open);
    var closeBtn = overlay.querySelector("[data-cod-close]");
    if (closeBtn) closeBtn.addEventListener("click", function (e) { e.preventDefault(); close(); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    // Funnel beacon: one per page, only for pages where the button showed.
    addEventListener("pagehide", function () {
      if (track.v && navigator.sendBeacon) {
        navigator.sendBeacon("/apps/cod/track", JSON.stringify(track));
        track.v = 0;
      }
    });

    // ---- Settings from the app ---------------------------------------------
    var q = "?product=" + encodeURIComponent(root.getAttribute("data-product-id") || "") +
      "&locale=" + encodeURIComponent(root.getAttribute("data-locale") || "");
    fetch("/apps/cod/settings" + q, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;
        if (cfg.enabled === false) { root.hidden = true; return; }
        T = cfg.t || {};
        [[".cod__head span", "heading"], ['[data-cod-field="quantity"] label', "qty"],
          [".cod__offers-title", "addTitle"], ["[data-cod-note]", "note"]].forEach(function (p) {
          var el = overlay.querySelector(p[0]);
          if (el && T[p[1]]) el.textContent = T[p[1]];
        });
        if (openBtn && T.button) openBtn.textContent = T.button;
        if (cfg.rtl) overlay.dir = root.dir = "rtl";
        if (T.submit) buttonLabel = T.submit;
        if (cfg.builder && cfg.builder.submitShowTotal === false) showTotal = false;
        if (cfg.currencySymbol) currency = cfg.currencySymbol;
        offers = cfg.upsells || [];
        tiers = cfg.tiers || [];
        downsell = cfg.downsell;
        renderOffers();
        renderTiers();
        track.v = 1;
        root.codCfg = cfg;
        root.codApi = {
          overlay: overlay,
          home: overlayHome,
          // cod-style.js adds Shopify's recommended products as offers.
          addOffers: function (list) { offers = offers.concat(list); renderOffers(); renderSummary(); }
        };
        document.dispatchEvent(new CustomEvent("cod:cfg", { detail: root }));
        renderSummary();
      })
      .catch(function () {});

    formEl.addEventListener("change", renderSummary);
    formEl.addEventListener("input", renderSummary);
    renderSummary();

    // ---- Continue to checkout ----------------------------------------------
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submitted) return;
      var variantId = currentVariantId();
      if (!variantId) { showMessage(t("choose", "Please choose a product option first."), "error"); return; }
      submitted = true;
      submitBtn.disabled = true;
      submitBtn.textContent = t("taking", "Taking you to checkout…");

      var items = [{ id: Number(numericId(variantId)), quantity: qty() }];
      chosenOffers().forEach(function (c) { items.push({ id: Number(numericId(c.variantId)), quantity: 1 }); });
      var attributes = {};
      attributes[CART_ATTRIBUTE] = "1";
      // An accepted downsell goes through Shopify's own /discount/<code> link.
      var dest = dsApplied && downsell
        ? base + "/discount/" + encodeURIComponent(downsell.code) + "?redirect=" + encodeURIComponent(checkoutUrl)
        : checkoutUrl;

      fetch(addUrl, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ items: items }) })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.json().then(
            function (d) { throw new Error((d && (d.description || d.message)) || ""); },
            function () { throw new Error(""); }
          );
        })
        .then(function () {
          return fetch(updateUrl, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ attributes: attributes }) })
            .catch(function () {});
        })
        .then(function () {
          track.c = 1;
          // cod-embed.js reports this to the merchant's pixels.
          document.dispatchEvent(new CustomEvent("cod:checkout", { detail: totals().total / 100 }));
          setTimeout(function () { location.href = dest; }, 400);
        })
        .catch(function (err) {
          submitted = false;
          submitBtn.disabled = false;
          renderSummary();
          showMessage((err && err.message) || t("error", "We couldn't start your checkout. Please try again."), "error");
        });
    });
  }

  function boot() { document.querySelectorAll("[data-cod-form]").forEach(initCodForm); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
