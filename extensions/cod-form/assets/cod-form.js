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
    function shippingCents() {
      var sel = overlay.querySelector('input[name="ship"]:checked');
      return sel ? parseInt(sel.getAttribute("data-ship-price") || "0", 10) || 0 : 0;
    }
    function qty() {
      return Math.max(1, parseInt((qtyInput && qtyInput.value) || "1", 10) || 1);
    }

    function renderSummary() {
      var sub = price * qty();
      var ship = shippingCents();
      var total = sub + ship + codFee;
      var rows = "";
      rows += '<div class="cod__product">' +
        (image ? '<img src="' + image + '" alt="" />' : "") +
        "<span>" + title + "</span></div>";
      rows += '<div class="cod__line"><span>Subtotal</span><b>' + money(sub) + "</b></div>";
      rows += '<div class="cod__line"><span>Shipping</span><b>' + money(ship) + "</b></div>";
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
    var shipWrap = overlay.querySelector("[data-cod-ship]");
    var shipList = overlay.querySelector("[data-cod-ship-list]");
    function renderShipping(options) {
      if (!shipWrap || !shipList) return;
      shipList.textContent = "";
      var valid = (options || []).filter(function (o) {
        return o && String(o.name || "").trim() !== "";
      });
      if (valid.length === 0) {
        shipWrap.hidden = true;
        return;
      }
      shipWrap.hidden = false;
      valid.forEach(function (opt, i) {
        var cents = Math.round((parseFloat(opt.price) || 0) * 100);
        var label = document.createElement("label");
        label.className = "cod__ship-opt";

        var left = document.createElement("span");
        var radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "ship";
        radio.value = opt.name;
        radio.setAttribute("data-ship-price", String(cents));
        if (i === 0) radio.checked = true;
        left.appendChild(radio);
        left.appendChild(document.createTextNode(" " + opt.name));

        var right = document.createElement("b");
        right.textContent = money(cents);

        label.appendChild(left);
        label.appendChild(right);
        shipList.appendChild(label);
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
        renderShipping(cfg.shippingOptions);
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

    formEl.addEventListener("change", renderSummary);
    formEl.addEventListener("input", renderSummary);
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
