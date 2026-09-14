(function () {
  // Cash-on-Delivery quick-order form.
  //
  // App Store requirement 1.1.2 (Use Shopify checkout): this script must never
  // collect an address or contact details, pick a shipping rate, or add a
  // delivery/COD fee. It only chooses line items, builds a Shopify cart, and
  // hands the customer to Shopify checkout — Shopify creates the order.
  function initCodForm(root) {
    var overlay = root.querySelector("[data-cod-overlay]");
    var formEl = root.querySelector("[data-cod-form-el]");
    var summaryEl = root.querySelector("[data-cod-summary]");
    var submitBtn = root.querySelector("[data-cod-submit]");
    var messageEl = root.querySelector("[data-cod-message]");
    var qtyInput = root.querySelector("[data-cod-qty]");
    var timerEl = root.querySelector("[data-cod-timer]");
    var atCheckoutEl = root.querySelector("[data-cod-at-checkout]");
    if (!formEl || !overlay) return;

    // Product data comes from Liquid; everything else arrives from the app.
    var price = parseInt(root.getAttribute("data-price") || "0", 10) || 0; // cents
    var title = root.getAttribute("data-product-title") || "Product";
    var image = root.getAttribute("data-product-image") || "";
    var moneyFormat = root.getAttribute("data-money-format") || "";
    // Theme-aware cart routes (a localized storefront prefixes them, e.g. /fr).
    var cartAddUrl = (root.getAttribute("data-cart-add-url") || "/cart/add") + ".js";
    var cartUpdateUrl = (root.getAttribute("data-cart-update-url") || "/cart/update") + ".js";
    var currency = ""; // app override; empty = use the shop's money format
    var buttonLabel = "Order Now (Cash on Delivery)";
    var showTotalOnSubmit = true;
    var submitted = false;
    // The cart attribute that marks these as COD orders, so the merchant can
    // find/tag them with Shopify Flow. The app no longer writes orders itself.
    var orderTag = "COD";

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

    function offerById(offerId) {
      for (var i = 0; i < offers.length; i++) {
        if (offers[i].id === offerId) return offers[i];
      }
      return null;
    }

    function offerItemById(offerId, variantId) {
      var offer = offerById(offerId);
      var items = (offer && offer.items) || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].variantId === variantId) return items[j];
      }
      return null;
    }

    function offerCents(unitPrice, discountPercent) {
      var pct = Math.min(100, Math.max(0, parseFloat(discountPercent) || 0));
      return Math.round((parseFloat(unitPrice) || 0) * (1 - pct / 100) * 100);
    }

    /** The add-on items the customer has ticked, as {offerId, variantId, cents}. */
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
    function quantityOffersInPlay() {
      var q = qty();
      return offers.filter(function (o) {
        return o.type === "quantity" && q >= (o.minQuantity || 1);
      });
    }

    function quantityDiscountPercent() {
      return quantityOffersInPlay().reduce(function (best, o) {
        return Math.max(best, parseFloat(o.discountPercent) || 0);
      }, 0);
    }

    // The Shopify discount codes backing the offers currently in play. The
    // discounts themselves live in the merchant's Shopify admin and are applied
    // by Shopify checkout — this only names them on the checkout URL.
    function activeDiscountCodes() {
      var codes = [];
      var add = function (offer) {
        var code = offer && offer.discountCode;
        if (code && codes.indexOf(code) === -1) codes.push(code);
      };
      chosenOffers().forEach(function (c) { add(offerById(c.offerId)); });
      // Only the deepest quantity discount is advertised, matching the summary.
      var best = null;
      quantityOffersInPlay().forEach(function (o) {
        if (!best || (parseFloat(o.discountPercent) || 0) > (parseFloat(best.discountPercent) || 0)) {
          best = o;
        }
      });
      add(best);
      return codes;
    }

    function mainItemCents() {
      var pct = quantityDiscountPercent();
      return Math.round(price * qty() * (1 - pct / 100));
    }

    function subtotalCents() {
      return mainItemCents() + offersCents();
    }

    function qty() {
      return Math.max(1, parseInt((qtyInput && qtyInput.value) || "1", 10) || 1);
    }

    function renderSummary() {
      var sub = subtotalCents();
      var rows = "";
      rows += '<div class="cod__product">' +
        (image ? '<img src="' + image + '" alt="" />' : "") +
        "<span>" + escapeHtml(title) + "</span></div>";
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
      rows += '<div class="cod__line cod__total"><span>Subtotal</span><b>' + money(sub) + "</b></div>";
      summaryEl.innerHTML = rows;
      // Shipping, taxes and any fee are unknown until Shopify quotes them at
      // checkout, so the button shows the subtotal — never an invented total.
      submitBtn.textContent = showTotalOnSubmit
        ? buttonLabel + " — " + money(sub)
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

    function resetToForm() {
      submitted = false;
      submitBtn.disabled = false;
      messageEl.hidden = true;
      renderSummary();
    }

    // Modal open/close via a class (not the [hidden] attr, which our own CSS
    // would override).
    function open() {
      resetToForm();
      overlay.classList.add("cod--open");
      document.body.style.overflow = "hidden";
      startTimer();
    }
    function close() {
      overlay.classList.remove("cod--open");
      document.body.style.overflow = "";
    }
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

      // "Buy 3+ and save 10%" — a nudge; Shopify applies the discount at checkout.
      quantityOffers.forEach(function (offer) {
        var note = document.createElement("div");
        note.className = "cod__offer-note";
        note.textContent =
          "Buy " + offer.minQuantity + "+ and save " + offer.discountPercent + "%";
        offersList.appendChild(note);
      });
    }

    // Apply merchant settings from the app (texts, offers, appearance).
    fetch("/apps/cod/settings", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;
        if (cfg.enabled === false) { root.hidden = true; return; }
        var headingEl = overlay.querySelector(".cod__head span");
        if (headingEl && cfg.headingText) headingEl.textContent = cfg.headingText;
        if (cfg.currencySymbol) currency = cfg.currencySymbol;
        if (cfg.orderTag) orderTag = cfg.orderTag;
        countdownMinutes = parseInt(cfg.countdownMinutes, 10) || 0;
        if (atCheckoutEl && cfg.checkoutNotice) atCheckoutEl.textContent = cfg.checkoutNotice;
        offers = cfg.upsells || [];
        renderOffers();
        // Only quantity and notes remain — every other field the form used to
        // show now belongs to Shopify checkout.
        if (cfg.fields) {
          ["quantity", "notes"].forEach(function (name) {
            var f = overlay.querySelector('[data-cod-field="' + name + '"]');
            if (f) f.hidden = cfg.fields[name] === false;
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

          // Submit button label + whether the subtotal is appended to it.
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

        // Settings arrive after the first paint — repaint so the currency,
        // offers and submit label all take effect.
        renderSummary();
      })
      .catch(function () {});

    function onFormChange() { renderSummary(); }
    formEl.addEventListener("change", onFormChange);
    formEl.addEventListener("input", onFormChange);
    renderSummary();

    // The checkout URL, carrying any Shopify discount codes the offers earned.
    // Shopify applies them — the app never prices a line itself.
    function checkoutUrl() {
      var codes = activeDiscountCodes();
      return "/checkout" + (codes.length ? "?discount=" + encodeURIComponent(codes.join(",")) : "");
    }

    function postJson(url, body) {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) {
            throw new Error((data && data.description) || "We couldn't add this to your cart.");
          }
          return data;
        });
      });
    }

    // Submit = build a Shopify cart and go to Shopify checkout. No order is
    // created here; Shopify collects the address, quotes shipping and takes the
    // Cash on Delivery payment on its own checkout page.
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submitted) return;

      var variantId = root.getAttribute("data-variant-id") || "";
      if (!variantId) {
        showMessage("This product can't be ordered right now.", "error");
        return;
      }

      submitted = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Taking you to checkout…";
      messageEl.hidden = true;

      var items = [{ id: Number(variantId), quantity: qty() }];
      chosenOffers().forEach(function (c) {
        items.push({ id: Number(c.variantId), quantity: 1 });
      });

      var notesEl = formEl.querySelector('[name="notes"]');
      var note = notesEl ? (notesEl.value || "").trim() : "";
      var target = checkoutUrl();

      postJson(cartAddUrl, { items: items })
        .then(function () {
          // A cart attribute (not an order tag) marks the COD intent — tagging
          // the order would need write_orders and a checkout bypass. Merchants
          // can turn this attribute into a tag with Shopify Flow.
          return postJson(cartUpdateUrl, { note: note, attributes: { "Order type": orderTag } });
        })
        .then(function () {
          window.location.href = target;
        })
        .catch(function (err) {
          submitted = false;
          submitBtn.disabled = false;
          renderSummary();
          showMessage(
            (err && err.message) || "We couldn't start your checkout. Please try again.",
            "error"
          );
        });
    });
  }

  function boot() { document.querySelectorAll("[data-cod-form]").forEach(initCodForm); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
