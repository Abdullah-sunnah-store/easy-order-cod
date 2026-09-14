(function () {
  function initCodForm(root) {
    var overlay = root.querySelector("[data-cod-overlay]");
    var formEl = root.querySelector("[data-cod-form-el]");
    var summaryEl = root.querySelector("[data-cod-summary]");
    var submitBtn = root.querySelector("[data-cod-submit]");
    var messageEl = root.querySelector("[data-cod-message]");
    var qtyInput = root.querySelector("[data-cod-qty]");
    var timerEl = root.querySelector("[data-cod-timer]");
    var doneEl = root.querySelector("[data-cod-done]");
    var doneMsgEl = root.querySelector("[data-cod-done-msg]");
    var okBtn = root.querySelector("[data-cod-ok]");
    if (!formEl || !overlay) return;

    // Product data comes from Liquid; everything else arrives from the app.
    var price = parseInt(root.getAttribute("data-price") || "0", 10) || 0; // cents
    var title = root.getAttribute("data-product-title") || "Product";
    var image = root.getAttribute("data-product-image") || "";
    var moneyFormat = root.getAttribute("data-money-format") || "";
    var currency = ""; // app override; empty = use the shop's money format
    var codFee = 0; // cents, from the app's Fraud & delivery settings
    var successMessage =
      "Thank you! Your order has been placed. We'll call you to confirm.";
    var buttonLabel = "Order Now (Cash on Delivery)";
    var showTotalOnSubmit = true;
    var submitted = false;

    // Icon paths mirror ICONS in app/routes/app.settings.tsx so the admin
    // preview and the storefront render the same glyph.
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

    // Group digits: 1234567.8 -> "1,234,567.80" with the requested separators.
    function group(amount, decimals, thousands, decimal) {
      var fixed = Math.abs(amount).toFixed(decimals);
      var parts = fixed.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return (amount < 0 ? "-" : "") + parts.join(decimals ? decimal : "");
    }

    // Renders cents using the shop's own money_format, so the storefront always
    // matches the theme. A currency symbol set in the app overrides it.
    function money(cents) {
      var amount = cents / 100;
      if (currency) return currency + group(amount, 2, ",", ".");
      if (!moneyFormat) return "$" + group(amount, 2, ",", ".");
      return moneyFormat.replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, token) {
        switch (token) {
          case "amount_no_decimals":
            return group(amount, 0, ",", ".");
          case "amount_with_comma_separator":
            return group(amount, 2, ".", ",");
          case "amount_no_decimals_with_comma_separator":
            return group(amount, 0, ".", ",");
          case "amount_with_apostrophe_separator":
            return group(amount, 2, "'", ".");
          case "amount_no_decimals_with_space_separator":
            return group(amount, 0, " ", ",");
          case "amount_with_space_separator":
            return group(amount, 2, " ", ",");
          default: // "amount"
            return group(amount, 2, ",", ".");
        }
      });
    }
    // ---- Upsell offers (from the app's Upsells page) ----
    var offers = [];
    var offersWrap = overlay.querySelector("[data-cod-offers]");
    var offersList = overlay.querySelector("[data-cod-offers-list]");

    // Titles come from the merchant's catalogue and are injected as HTML in the
    // summary, so they get escaped on the way in.
    function escapeHtml(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function offerItemById(offerId, variantId) {
      for (var i = 0; i < offers.length; i++) {
        if (offers[i].id !== offerId) continue;
        var items = offers[i].items || [];
        for (var j = 0; j < items.length; j++) {
          if (items[j].variantId === variantId) return items[j];
        }
      }
      return null;
    }

    function offerCents(price, discountPercent) {
      var pct = Math.min(100, Math.max(0, parseFloat(discountPercent) || 0));
      return Math.round((parseFloat(price) || 0) * (1 - pct / 100) * 100);
    }

    /** The add-on items the customer has ticked, as {variantId, cents}. */
    function chosenOffers() {
      if (!offersList) return [];
      var out = [];
      var boxes = offersList.querySelectorAll("input[data-cod-offer]");
      for (var i = 0; i < boxes.length; i++) {
        if (!boxes[i].checked) continue;
        var offerId = boxes[i].getAttribute("data-cod-offer");
        // Collection offers pair the checkbox with a <select> of products.
        var picker = offersList.querySelector('select[data-cod-offer-pick="' + offerId + '"]');
        var variantId = picker ? picker.value : boxes[i].getAttribute("data-variant");
        var cents = picker
          ? parseInt(picker.options[picker.selectedIndex].getAttribute("data-cents") || "0", 10)
          : parseInt(boxes[i].getAttribute("data-cents") || "0", 10);
        if (variantId) out.push({ offerId: offerId, variantId: variantId, cents: cents || 0 });
      }
      return out;
    }

    function offersCents() {
      return chosenOffers().reduce(function (sum, o) { return sum + o.cents; }, 0);
    }

    // Quantity offers discount the product being bought rather than adding one.
    function quantityDiscountPercent() {
      var q = qty();
      var best = 0;
      for (var i = 0; i < offers.length; i++) {
        var o = offers[i];
        if (o.type === "quantity" && q >= (o.minQuantity || 1)) {
          best = Math.max(best, parseFloat(o.discountPercent) || 0);
        }
      }
      return best;
    }

    function mainItemCents() {
      var pct = quantityDiscountPercent();
      return Math.round(price * qty() * (1 - pct / 100));
    }

    function subtotalCents() {
      return mainItemCents() + offersCents();
    }
    // Free shipping is decided by the order subtotal, so it has to be re-checked
    // whenever the quantity changes — not once at render time.
    function freeShipping() {
      var t = Math.round((parseFloat(shipCfg.freeShippingThreshold) || 0) * 100);
      return t > 0 && subtotalCents() >= t;
    }
    function shippingCents() {
      if (freeShipping()) return 0;
      var sel = overlay.querySelector('input[name="ship"]:checked');
      return sel ? parseInt(sel.getAttribute("data-ship-price") || "0", 10) || 0 : 0;
    }
    function qty() {
      return Math.max(1, parseInt((qtyInput && qtyInput.value) || "1", 10) || 1);
    }

    function renderSummary() {
      var sub = subtotalCents();
      var ship = shippingCents();
      var total = sub + ship + codFee;
      var rows = "";
      rows += '<div class="cod__product">' +
        (image ? '<img src="' + image + '" alt="" />' : "") +
        "<span>" + title + "</span></div>";
      // Each accepted offer gets its own line so the customer can see what the
      // extra charge is for.
      chosenOffers().forEach(function (c) {
        var item = offerItemById(c.offerId, c.variantId);
        rows += '<div class="cod__line cod__line--add"><span>+ ' +
          escapeHtml(item ? item.title : "Added item") +
          "</span><b>" + money(c.cents) + "</b></div>";
      });
      var qPct = quantityDiscountPercent();
      if (qPct > 0) {
        rows += '<div class="cod__line cod__line--save"><span>Quantity discount (' +
          qPct + "%)</span><b>-" + money(Math.round(price * qty() * qPct / 100)) + "</b></div>";
      }
      rows += '<div class="cod__line"><span>Subtotal</span><b>' + money(sub) + "</b></div>";
      rows += '<div class="cod__line"><span>Shipping</span><b>' +
        (freeShipping() ? "FREE" : money(ship)) + "</b></div>";
      if (codFee > 0) rows += '<div class="cod__line"><span>COD fee</span><b>' + money(codFee) + "</b></div>";
      rows += '<div class="cod__line cod__total"><span>Total</span><b>' + money(total) + "</b></div>";
      summaryEl.innerHTML = rows;
      submitBtn.textContent = showTotalOnSubmit
        ? buttonLabel + " — " + money(total)
        : buttonLabel;
    }

    function showMessage(text, kind) {
      messageEl.textContent = text;
      messageEl.hidden = false;
      messageEl.className = "cod__msg cod__msg--" + kind;
    }

    // Move the overlay to <body> so position:fixed centers it on the viewport
    // (a themed ancestor with a CSS transform would otherwise trap it).
    // Remember where it came from: embedded mode has to put it back inline.
    var overlayHome = overlay.parentNode;
    document.body.appendChild(overlay);

    // Show the success confirmation panel (hides the form).
    function showDone(msg) {
      if (doneMsgEl) doneMsgEl.textContent = msg;
      formEl.style.display = "none";
      if (doneEl) doneEl.hidden = false;
    }
    // Back to a fresh form (used on OK and when reopening).
    function resetToForm() {
      if (doneEl) doneEl.hidden = true;
      formEl.style.display = "";
      submitted = false;
      submitBtn.disabled = false;
      messageEl.hidden = true;
      // The form was reset, so the city is empty again — re-resolve the rates
      // before redrawing the totals.
      refreshShipping();
      renderSummary();
    }
    if (okBtn) okBtn.addEventListener("click", function () { resetToForm(); close(); });

    // Modal open/close via a class (not the [hidden] attr, which our own CSS
    // would override).
    function open() { resetToForm(); overlay.classList.add("cod--open"); document.body.style.overflow = "hidden"; startTimer(); }
    function close() { overlay.classList.remove("cod--open"); document.body.style.overflow = ""; }
    root.querySelector("[data-cod-open]").addEventListener("click", open);
    // The close button lives inside the overlay, which we just moved to <body> —
    // query it from the overlay, not root.
    var closeBtn = overlay.querySelector("[data-cod-close]");
    if (closeBtn) closeBtn.addEventListener("click", function (e) { e.preventDefault(); close(); });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    // Countdown timer
    var timerStarted = false;
    var countdownMinutes = 0; // set from the app settings
    function startTimer() {
      if (!timerEl || timerStarted) return;
      var mins = countdownMinutes;
      if (mins <= 0) return;
      timerStarted = true;
      timerEl.hidden = false;
      var remaining = mins * 60;
      var tick = function () {
        var m = Math.floor(remaining / 60), s = remaining % 60;
        timerEl.textContent = "Hurry! Sale ends in " + m + ":" + (s < 10 ? "0" : "") + s;
        if (remaining > 0) { remaining--; setTimeout(tick, 1000); }
      };
      tick();
    }

    // Build the shipping choices from the app settings. Prices arrive in the
    // shop's major currency unit (e.g. 80 = ৳80) and are stored as cents here.
    //
    // Rate resolution mirrors app/lib/shipping.ts so the price can follow the
    // city the customer types without a round-trip. Keep the two in step.
    var shipWrap = overlay.querySelector("[data-cod-ship]");
    var shipList = overlay.querySelector("[data-cod-ship-list]");
    var cityInput = formEl.querySelector('[name="city"]');
    var shipCfg = {
      mode: "manual",
      manual: [],
      synced: [],
      hiddenRates: [],
      rulesEnabled: false,
      rules: [],
      fallbackPrice: 0,
      fallbackLabel: "Delivery charge",
      freeShippingThreshold: 0
    };

    function normalizeCity(value) {
      return String(value == null ? "" : value)
        .toLowerCase()
        .replace(/[^0-9a-zÀ-￿]+/gi, " ")
        .trim();
    }

    function ruleMatchesCity(rule, city) {
      var typed = normalizeCity(city);
      if (!typed) return false;
      return String((rule && rule.cities) || "")
        .split(",")
        .map(normalizeCity)
        .filter(Boolean)
        .some(function (name) {
          return typed.indexOf(name) >= 0 || name.indexOf(typed) >= 0;
        });
    }

    // Synced rates the merchant switched off in the app never reach the form.
    function isRateHidden(name) {
      var key = String(name || "").trim().toLowerCase();
      return (shipCfg.hiddenRates || []).some(function (h) {
        return String(h || "").trim().toLowerCase() === key;
      });
    }

    function cleanOptions(list) {
      return (list || []).filter(function (o) {
        return o && String(o.name || "").trim() !== "";
      }).map(function (o) {
        return { name: String(o.name).trim(), price: parseFloat(o.price) || 0 };
      });
    }

    // The rates to show for a given city, in display order: the dynamic rate
    // first (it is the one that tracks what they typed), then the manual and/or
    // synced rates, deduped by name.
    function optionsForCity(city) {
      var out = [];
      if (shipCfg.rulesEnabled) {
        var hit = null;
        for (var i = 0; i < (shipCfg.rules || []).length; i++) {
          if (ruleMatchesCity(shipCfg.rules[i], city)) { hit = shipCfg.rules[i]; break; }
        }
        out.push(
          hit
            ? { name: String(hit.label || "").trim() || shipCfg.fallbackLabel, price: parseFloat(hit.price) || 0 }
            : { name: shipCfg.fallbackLabel, price: parseFloat(shipCfg.fallbackPrice) || 0 }
        );
      }
      if (shipCfg.mode === "manual" || shipCfg.mode === "both") {
        out = out.concat(cleanOptions(shipCfg.manual));
      }
      if (shipCfg.mode === "auto" || shipCfg.mode === "both") {
        out = out.concat(cleanOptions(shipCfg.synced).filter(function (o) {
          return !isRateHidden(o.name);
        }));
      }
      var seen = {};
      return out.filter(function (o) {
        var key = o.name.toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    function renderShipping(options) {
      if (!shipWrap || !shipList) return;
      // Keep the customer's pick across a city-driven re-render.
      var previous = overlay.querySelector('input[name="ship"]:checked');
      var previousValue = previous ? previous.value : null;
      shipList.textContent = "";
      var valid = cleanOptions(options);
      if (valid.length === 0) {
        shipWrap.hidden = true;
        return;
      }
      shipWrap.hidden = false;
      var free = freeShipping();
      var matched = false;
      valid.forEach(function (opt, i) {
        var cents = Math.round(opt.price * 100);
        var label = document.createElement("label");
        label.className = "cod__ship-opt";

        var left = document.createElement("span");
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "ship";
        radio.value = opt.name;
        radio.setAttribute("data-ship-price", String(cents));
        if (previousValue === opt.name) { radio.checked = true; matched = true; }
        left.appendChild(radio);
        left.appendChild(document.createTextNode(" " + opt.name));

        var right = document.createElement("b");
        right.textContent = free ? "FREE" : money(cents);

        label.appendChild(left);
        label.appendChild(right);
        shipList.appendChild(label);
      });
      // Nothing carried over (first paint, or the old pick disappeared) — the
      // first rate is the dynamic one when city rules are on, so preselect it.
      if (!matched) {
        var first = shipList.querySelector('input[name="ship"]');
        if (first) first.checked = true;
      }
    }

    // Re-price as the city is typed. Only re-renders when the resolved rates
    // actually change, so typing doesn't reset the radio on every keystroke.
    var lastRateKey = "";
    function refreshShipping() {
      var opts = optionsForCity(cityInput ? cityInput.value : "");
      var key = JSON.stringify(opts) + "|" + (freeShipping() ? "free" : "paid");
      if (key === lastRateKey) return;
      lastRateKey = key;
      renderShipping(opts);
    }

    // Build the offer rows. A product offer is a single tickable item; a
    // collection offer is a tick plus a <select> of the products in it.
    // Quantity offers add nothing — they discount the item being bought — so
    // they show as a note instead of a checkbox.
    function renderOffers() {
      if (!offersWrap || !offersList) return;
      offersList.textContent = "";
      var addable = offers.filter(function (o) {
        return o.type !== "quantity" && (o.items || []).length > 0;
      });
      var quantityOffers = offers.filter(function (o) {
        return o.type === "quantity" && (o.minQuantity || 1) > 1;
      });
      if (addable.length === 0 && quantityOffers.length === 0) {
        offersWrap.hidden = true;
        return;
      }
      offersWrap.hidden = false;

      addable.forEach(function (offer) {
        var row = document.createElement("label");
        row.className = "cod__offer";

        var box = document.createElement("input");
        box.type = "checkbox";
        box.setAttribute("data-cod-offer", offer.id);

        var first = offer.items[0];
        var body = document.createElement("span");
        body.className = "cod__offer-body";

        var head = document.createElement("span");
        head.className = "cod__offer-head";
        head.textContent = offer.title || "Special offer";
        body.appendChild(head);

        if (offer.kind === "collection" && offer.items.length > 1) {
          // Let the customer choose which item from the collection they want.
          var pick = document.createElement("select");
          pick.className = "cod__offer-pick";
          pick.setAttribute("data-cod-offer-pick", offer.id);
          offer.items.forEach(function (item) {
            var opt = document.createElement("option");
            var cents = offerCents(item.price, offer.discountPercent);
            opt.value = item.variantId;
            opt.setAttribute("data-cents", String(cents));
            opt.textContent = item.title + " — " + money(cents);
            pick.appendChild(opt);
          });
          // Choosing a different item re-prices the summary via the form's own
          // change listener — the select sits inside the form.
          body.appendChild(pick);
        } else {
          box.setAttribute("data-variant", first.variantId);
          box.setAttribute("data-cents", String(offerCents(first.price, offer.discountPercent)));
          var line = document.createElement("span");
          line.className = "cod__offer-line";
          if (first.image) {
            var img = document.createElement("img");
            img.src = first.image;
            img.alt = "";
            line.appendChild(img);
          }
          var name = document.createElement("span");
          name.textContent = first.title;
          line.appendChild(name);
          body.appendChild(line);
        }

        var priceEl = document.createElement("b");
        priceEl.className = "cod__offer-price";
        var full = Math.round((parseFloat(first.price) || 0) * 100);
        var now = offerCents(first.price, offer.discountPercent);
        if (offer.discountPercent > 0) {
          var was = document.createElement("s");
          was.textContent = money(full);
          priceEl.appendChild(was);
          priceEl.appendChild(document.createTextNode(" "));
        }
        priceEl.appendChild(document.createTextNode(money(now)));

        row.appendChild(box);
        row.appendChild(body);
        row.appendChild(priceEl);
        offersList.appendChild(row);
      });

      // "Buy 3+ and save 10%" — a nudge, applied automatically by the summary.
      quantityOffers.forEach(function (offer) {
        var note = document.createElement("div");
        note.className = "cod__offer-note";
        note.textContent =
          "Buy " + offer.minQuantity + "+ and save " + offer.discountPercent + "%";
        offersList.appendChild(note);
      });
    }

    // Country dial codes beside the phone field. Hidden until the app sends a
    // list, so the form degrades to a plain phone input if settings fail.
    var dialEl = overlay.querySelector("[data-cod-dial]");
    function renderDialCodes(codes) {
      if (!dialEl) return;
      var list = (codes || []).filter(function (c) {
        return c && String(c).trim() !== "";
      });
      if (list.length === 0) {
        dialEl.hidden = true;
        return;
      }
      dialEl.textContent = "";
      list.forEach(function (code) {
        var opt = document.createElement("option");
        opt.value = String(code).trim();
        opt.textContent = String(code).trim();
        dialEl.appendChild(opt);
      });
      dialEl.hidden = false;
    }

    // "01709504746" + "+880" -> "+8801709504746". Leading zeros are a local
    // prefix and must go, or the number is invalid once a country code is on it.
    function fullPhone() {
      var el = formEl.querySelector('[name="phone"]');
      var typed = el ? (el.value || "").trim() : "";
      if (!dialEl || dialEl.hidden || !dialEl.value) return typed;
      if (typed.charAt(0) === "+") return typed;
      var digits = typed.replace(/\D/g, "").replace(/^0+/, "");
      return digits ? dialEl.value + digits : "";
    }

    // Apply merchant settings from the app (field visibility, texts)
    fetch("/apps/cod/settings", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;
        if (cfg.enabled === false) { root.hidden = true; return; }
        if (cfg.successMessage) successMessage = cfg.successMessage;
        var headingEl = overlay.querySelector(".cod__head span");
        if (headingEl && cfg.headingText) headingEl.textContent = cfg.headingText;

        // Storefront values that used to live in the theme block's schema.
        if (cfg.currencySymbol) currency = cfg.currencySymbol;
        codFee = Math.round((parseFloat(cfg.codFee) || 0) * 100);
        countdownMinutes = parseInt(cfg.countdownMinutes, 10) || 0;
        // cfg.shipping carries the mode, the city rules and the free-shipping
        // threshold; cfg.shippingOptions is the already-resolved list kept for
        // older payloads that predate it.
        if (cfg.shipping) {
          shipCfg.mode = cfg.shipping.mode || "manual";
          shipCfg.manual = cfg.shipping.manual || [];
          shipCfg.synced = cfg.shipping.synced || [];
          shipCfg.hiddenRates = cfg.shipping.hiddenRates || [];
          shipCfg.rulesEnabled = cfg.shipping.rulesEnabled === true;
          shipCfg.rules = cfg.shipping.rules || [];
          shipCfg.fallbackPrice = parseFloat(cfg.shipping.fallbackPrice) || 0;
          shipCfg.fallbackLabel =
            String(cfg.shipping.fallbackLabel || "").trim() || "Delivery charge";
          shipCfg.freeShippingThreshold =
            parseFloat(cfg.shipping.freeShippingThreshold) || 0;
          refreshShipping();
        } else {
          shipCfg.manual = cfg.shippingOptions || [];
          refreshShipping();
        }
        offers = cfg.upsells || [];
        renderOffers();
        renderDialCodes(cfg.dialCodes);
        if (cfg.fields) {
          ["name", "phone", "email", "address", "city", "quantity", "notes"].forEach(function (name) {
            var f = overlay.querySelector('[data-cod-field="' + name + '"]');
            if (!f) return;
            var off = cfg.fields[name] === false;
            f.hidden = off;
            // A hidden input that is still `required` blocks native submit with
            // an unfocusable validation bubble — drop the flag while hidden.
            var inputs = f.querySelectorAll("input");
            for (var i = 0; i < inputs.length; i++) {
              if (off) {
                if (inputs[i].required) {
                  inputs[i].setAttribute("data-cod-was-required", "1");
                  inputs[i].required = false;
                }
              } else if (inputs[i].getAttribute("data-cod-was-required")) {
                inputs[i].required = true;
              }
            }
          });
        }
        // Apply the Form Builder appearance (colors, radius, sizes).
        var bc = cfg.builder;
        if (bc) {
          var px = function (el, name, v) {
            if (v != null && v !== "") el.style.setProperty(name, v + "px");
          };
          var raw = function (el, name, v) {
            if (v != null && v !== "") el.style.setProperty(name, v);
          };
          var apply = function (el) {
            // Buy button
            raw(el, "--cod-btn", bc.buttonBg);
            raw(el, "--cod-btn-text", bc.buttonTextColor);
            raw(el, "--cod-btn-hover", bc.buttonHoverBg);
            px(el, "--cod-btn-radius", bc.buttonRadius);
            px(el, "--cod-btn-size", bc.buttonTextSize);
            px(el, "--cod-btn-pad-y", bc.buttonPaddingY);
            // Modal shell
            raw(el, "--cod-accent", bc.accentColor);
            raw(el, "--cod-modal-bg", bc.modalBg);
            raw(el, "--cod-modal-text", bc.modalTextColor);
            px(el, "--cod-radius", bc.modalRadius);
            px(el, "--cod-width", bc.modalWidth);
            px(el, "--cod-heading-size", bc.headingSize);
            raw(el, "--cod-heading-align", bc.headingAlign);
            if (bc.overlayOpacity != null) {
              el.style.setProperty("--cod-overlay-bg", "rgba(0,0,0," + (bc.overlayOpacity / 100).toFixed(2) + ")");
            }
            px(el, "--cod-overlay-blur", bc.overlayBlur);
            // Fields
            px(el, "--cod-input-radius", bc.inputRadius);
            px(el, "--cod-input-pad-y", bc.inputPaddingY);
            raw(el, "--cod-input-border", bc.inputBorderColor);
            raw(el, "--cod-input-bg", bc.inputBg);
            // Submit button
            raw(el, "--cod-submit-bg", bc.submitBg);
            raw(el, "--cod-submit-text", bc.submitTextColor);
            // Typography
            px(el, "--cod-font", bc.baseFontSize);
            if (bc.fontFamily && FONT_STACKS[bc.fontFamily]) {
              el.style.setProperty("--cod-font-family", FONT_STACKS[bc.fontFamily]);
            }
          };
          apply(root); apply(overlay);

          // Class-based toggles. Applied to both nodes because the overlay is
          // reparented to <body> and no longer inherits root's classes.
          var toggle = function (cls, on) {
            root.classList.toggle(cls, !!on);
            overlay.classList.toggle(cls, !!on);
          };
          toggle("cod--stacked", bc.fieldLayout === "stacked");
          toggle("cod--no-req", bc.showRequiredMarks === false);
          toggle("cod--no-img", bc.showProductImage === false);
          toggle("cod--btn-normal", bc.buttonBold === false);
          toggle("cod--btn-auto", bc.buttonFullWidth === false);
          toggle("cod--sticky", bc.stickyMobile === true);
          toggle("cod--anim-pulse", bc.buttonAnimation === "pulse");
          toggle("cod--anim-shine", bc.buttonAnimation === "shine");

          // Embedded mode: put the form back inline and drop the open button.
          if (bc.formType === "embedded" && overlayHome) {
            overlayHome.appendChild(overlay);
            overlay.classList.add("cod--embedded");
            var ob = root.querySelector("[data-cod-open]");
            if (ob) ob.hidden = true;
            startTimer();
          }

          // Buy button label, subtitle and icon.
          var openBtn = root.querySelector("[data-cod-open]");
          if (openBtn && bc.buttonText) {
            openBtn.textContent = "";
            if (bc.buttonIcon && ICONS[bc.buttonIcon]) {
              var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              svg.setAttribute("viewBox", "0 0 24 24");
              svg.setAttribute("width", "1.05em");
              svg.setAttribute("height", "1.05em");
              svg.setAttribute("fill", "none");
              svg.setAttribute("stroke", "currentColor");
              svg.setAttribute("stroke-width", "2");
              svg.setAttribute("stroke-linecap", "round");
              svg.setAttribute("stroke-linejoin", "round");
              svg.setAttribute("aria-hidden", "true");
              var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              path.setAttribute("d", ICONS[bc.buttonIcon]);
              svg.appendChild(path);
              openBtn.appendChild(svg);
            }
            var label = document.createElement("span");
            label.textContent = bc.buttonText;
            if (bc.buttonSubtitle) {
              var sub = document.createElement("div");
              sub.textContent = bc.buttonSubtitle;
              sub.style.cssText = "font-size:.8em;font-weight:400;opacity:.85";
              label.appendChild(sub);
            }
            openBtn.appendChild(label);
          }

          // Submit button label + whether the total is appended to it.
          if (bc.submitText) buttonLabel = bc.submitText;
          if (bc.submitShowTotal === false) showTotalOnSubmit = false;

          // Trust badge under the submit button.
          if (bc.trustBadge) {
            var badge = overlay.querySelector("[data-cod-trust]");
            if (!badge) {
              badge = document.createElement("p");
              badge.className = "cod__trust";
              badge.setAttribute("data-cod-trust", "");
              submitBtn.parentNode.insertBefore(badge, submitBtn.nextSibling);
            }
            badge.textContent = bc.trustBadge;
          }
        }

        // Settings arrive after the first paint — repaint the summary so the
        // fee, currency, shipping and submit label all take effect. Runs even
        // when no builder config exists, since those values come from cfg too.
        renderSummary();
      })
      .catch(function () {});

    // The city drives the dynamic rate and the quantity drives free shipping,
    // so both have to re-resolve the rates before the summary is redrawn.
    function onFormChange() {
      refreshShipping();
      renderSummary();
    }
    formEl.addEventListener("change", onFormChange);
    formEl.addEventListener("input", onFormChange);
    renderSummary();

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submitted) return;

      // The phone field can be switched off in the Form builder, so it may be
      // absent or hidden — only enforce it when it's actually shown.
      var phoneEl = formEl.querySelector('[name="phone"]');
      var phoneRow = formEl.querySelector('[data-cod-field="phone"]');
      var phoneShown = phoneEl && !(phoneRow && phoneRow.hidden);
      var phone = phoneEl ? (phoneEl.value || "").trim() : "";
      if (phoneShown && !phone) { showMessage("Please enter your phone number.", "error"); return; }

      submitted = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Placing order…";
      messageEl.hidden = true;

      var sel = overlay.querySelector('input[name="ship"]:checked');
      var payload = new FormData(formEl);
      // Send the dial code merged in, not the raw local number.
      payload.set("phone", fullPhone());
      payload.append("variantId", root.getAttribute("data-variant-id") || "");
      payload.append("shippingTitle", sel ? sel.value : "");
      payload.append("shippingPrice", String((shippingCents() / 100).toFixed(2)));
      payload.append("codFee", String((codFee / 100).toFixed(2)));
      // Only the offer and variant ids travel — the server re-resolves the
      // offer and prices it itself, so these can't be used to discount an order.
      payload.append(
        "upsells",
        JSON.stringify(chosenOffers().map(function (c) {
          return { offerId: c.offerId, variantId: c.variantId };
        })),
      );

      // Guard against the dev tunnel dropping a slow response after the order
      // is already created: on timeout/parse failure we do NOT re-enable the
      // button (avoids duplicate COD orders) and show a soft message instead.
      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        showMessage("Your order is being placed. If you don't get a confirmation call, please contact us before ordering again.", "info");
      }, 12000);

      fetch("/apps/cod/order", { method: "POST", body: payload })
        .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
        .then(function (res) {
          clearTimeout(timer);
          if (timedOut) return;
          var data = null;
          try { data = JSON.parse(res.t); } catch (e) {}
          if (res.ok && data && data.ok) {
            formEl.reset();
            showDone(data.message || successMessage);
          } else if (data && data.error) {
            submitted = false; submitBtn.disabled = false; renderSummary();
            showMessage(data.error, "error");
          } else {
            // Response arrived but wasn't parseable — the order may still exist.
            showMessage("Your order may have been placed. Please check before ordering again.", "info");
          }
        })
        .catch(function () {
          clearTimeout(timer);
          if (timedOut) return;
          showMessage("Your order may have been placed. Please check before ordering again — don't reorder if you get a confirmation call.", "info");
        });
    });
  }

  function boot() { document.querySelectorAll("[data-cod-form]").forEach(initCodForm); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
