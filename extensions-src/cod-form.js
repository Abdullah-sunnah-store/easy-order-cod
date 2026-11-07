(function () {
  // Cash-on-Delivery block.
  //
  // The customer picks a quantity and any add-on offers here, and everything
  // else happens in Shopify checkout: contact details, shipping address,
  // shipping rate, taxes and payment. Nothing that belongs to checkout is
  // collected on this page, and no order is created behind Shopify's back —
  // "Continue to checkout" puts the chosen items in the shop's own cart and
  // hands the customer to /checkout.
  function initCodForm(root) {
    var overlay = root.querySelector("[data-cod-overlay]");
    var formEl = root.querySelector("[data-cod-form-el]");
    var summaryEl = root.querySelector("[data-cod-summary]");
    var submitBtn = root.querySelector("[data-cod-submit]");
    var messageEl = root.querySelector("[data-cod-message]");
    var qtyInput = root.querySelector("[data-cod-qty]");
    var timerEl = root.querySelector("[data-cod-timer]");
    if (!formEl || !overlay) return;

    // Product data comes from Liquid; everything else arrives from the app.
    var title = root.getAttribute("data-product-title") || "Product";
    var image = root.getAttribute("data-product-image") || "";
    var moneyFormat = root.getAttribute("data-money-format") || "";
    var currency = ""; // app override; empty = use the shop's money format
    var buttonLabel = "Continue to checkout";
    var showTotalOnSubmit = true;
    var submitted = false;

    // Every cart route is derived from the theme's own cart URL so a
    // locale-prefixed storefront (/fr/cart) keeps working.
    var cartUrl = (root.getAttribute("data-cart-url") || "/cart").replace(/\/+$/, "");
    var addUrl = cartUrl + "/add.js";
    var updateUrl = cartUrl + "/update.js";
    var checkoutUrl = cartUrl.replace(/\/cart$/, "") + "/checkout";

    // Marks the cart so the app can recognise the order Shopify creates from
    // it — that is how a COD order gets tagged and counted, in an
    // orders/create webhook, after checkout has done its job.
    var CART_ATTRIBUTE = "_easy_order_cod";

    var JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };
    function make(tag) { return document.createElement(tag); }

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

    // ---- Which variant is being bought -------------------------------------
    // Liquid renders the variant that was selected when the page was built, so
    // it goes stale the moment the customer picks another one. Re-read it from
    // the theme's own product form (or the ?variant= URL) whenever the modal is
    // opened or submitted, and price it from the map Liquid embedded.
    var fallbackVariantId = root.getAttribute("data-variant-id") || "";
    var priceByVariant = {};
    (root.getAttribute("data-variants") || "").split(",").forEach(function (pair) {
      var bits = pair.split(":");
      if (bits.length === 2) priceByVariant[bits[0].trim()] = parseInt(bits[1], 10) || 0;
    });
    var fallbackPrice = parseInt(root.getAttribute("data-price") || "0", 10) || 0; // cents

    // The theme's own product form is the most reliable source, but a page can
    // hold several (quick-add cards, related products), so look inside this
    // block's own section before widening the search.
    var section = root.closest(".shopify-section, section") || document;
    function themeVariantInput() {
      var selector = 'form[action*="/cart/add"] [name="id"]:not([disabled])';
      return section.querySelector(selector) || document.querySelector(selector);
    }

    function currentVariantId() {
      var input = themeVariantInput();
      if (input && input.value) return String(input.value);
      var fromUrl = new URLSearchParams(window.location.search).get("variant");
      if (fromUrl) return String(fromUrl);
      return String(fallbackVariantId);
    }

    function unitPriceCents() {
      var id = currentVariantId();
      return id in priceByVariant ? priceByVariant[id] : fallbackPrice;
    }

    // ---- Money -------------------------------------------------------------
    /** Group digits: 1234567.8 -> "1,234,567.80" with the requested separators. */
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
        // [decimals, thousands separator, decimal separator]; "amount" is the default.
        var f = MONEY_TOKENS[token] || [2, ",", "."];
        return group(amount, f[0], f[1], f[2]);
      });
    }
    var MONEY_TOKENS = {
      amount_no_decimals: [0, ",", "."],
      amount_with_comma_separator: [2, ".", ","],
      amount_no_decimals_with_comma_separator: [0, ".", ","],
      amount_with_apostrophe_separator: [2, "'", "."],
      amount_no_decimals_with_space_separator: [0, " ", ","],
      amount_with_space_separator: [2, " ", ","]
    };

    // ---- Add-on offers (from the app's Upsells page) -----------------------
    // Offers add real products to the cart at the price Shopify holds for them.
    // The app cannot discount a line it does not own, so no discount is shown
    // or promised here — checkout is what prices the order.
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

    function itemCents(price) {
      return Math.round((parseFloat(price) || 0) * 100);
    }

    // Offer variants arrive as Admin GIDs; the cart wants the numeric id.
    function numericId(gid) {
      var s = String(gid || "");
      var match = s.match(/(\d+)\s*$/);
      return match ? match[1] : s;
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

    function qty() {
      return Math.max(1, parseInt((qtyInput && qtyInput.value) || "1", 10) || 1);
    }

    function itemsSubtotalCents() {
      return unitPriceCents() * qty() + offersCents();
    }

    // ---- Summary -----------------------------------------------------------
    // Only the items are totalled. Shipping, taxes, discounts and any COD fee
    // belong to checkout, and quoting them here would be guessing at numbers
    // Shopify has not calculated yet.
    function renderSummary() {
      var sub = itemsSubtotalCents();
      var rows = "";
      rows += '<div class="cod__product">' +
        (image ? '<img src="' + image + '" alt="" />' : "") +
        "<span>" + escapeHtml(title) + " × " + qty() + "</span></div>";
      chosenOffers().forEach(function (c) {
        var item = offerItemById(c.offerId, c.variantId);
        rows += '<div class="cod__line cod__line--add"><span>+ ' +
          escapeHtml(item ? item.title : "Added item") +
          "</span><b>" + money(c.cents) + "</b></div>";
      });
      rows += '<div class="cod__line cod__total"><span>Items subtotal</span><b>' +
        money(sub) + "</b></div>";
      summaryEl.innerHTML = rows;
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

    // Back to a ready state (used when the modal is opened, and after a failed
    // add-to-cart so the customer can try again).
    function resetToForm() {
      submitted = false;
      submitBtn.disabled = false;
      messageEl.hidden = true;
      renderSummary();
    }

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

    // Build the offer rows. A product offer is a single tickable item; a
    // collection offer is a tick plus a <select> of the products in it.
    function renderOffers() {
      if (!offersWrap || !offersList) return;
      offersList.textContent = "";
      var addable = offers.filter(function (o) {
        return o.type !== "quantity" && (o.items || []).length > 0;
      });
      if (addable.length === 0) {
        offersWrap.hidden = true;
        return;
      }
      offersWrap.hidden = false;

      addable.forEach(function (offer) {
        var row = make("label");
        row.className = "cod__offer";

        var box = make("input");
        box.type = "checkbox";
        box.setAttribute("data-cod-offer", offer.id);

        var first = offer.items[0];
        var body = make("span");
        body.className = "cod__offer-body";

        var head = make("span");
        head.className = "cod__offer-head";
        head.textContent = offer.title || "Special offer";
        body.appendChild(head);

        if (offer.kind === "collection" && offer.items.length > 1) {
          // Let the customer choose which item from the collection they want.
          var pick = make("select");
          pick.className = "cod__offer-pick";
          pick.setAttribute("data-cod-offer-pick", offer.id);
          offer.items.forEach(function (item) {
            var opt = make("option");
            var cents = itemCents(item.price);
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
          box.setAttribute("data-cents", String(itemCents(first.price)));
          var line = make("span");
          line.className = "cod__offer-line";
          if (first.image) {
            var img = make("img");
            img.src = first.image;
            img.alt = "";
            line.appendChild(img);
          }
          var name = make("span");
          name.textContent = first.title;
          line.appendChild(name);
          body.appendChild(line);
        }

        var priceEl = make("b");
        priceEl.className = "cod__offer-price";
        priceEl.textContent = money(itemCents(first.price));

        row.appendChild(box);
        row.appendChild(body);
        row.appendChild(priceEl);
        offersList.appendChild(row);
      });
    }

    // Apply merchant settings from the app (texts, appearance, offers).
    fetch("/apps/cod/settings", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;
        if (cfg.enabled === false) { root.hidden = true; return; }
        var headingEl = overlay.querySelector(".cod__head span");
        if (headingEl && cfg.headingText) headingEl.textContent = cfg.headingText;

        if (cfg.currencySymbol) currency = cfg.currencySymbol;
        countdownMinutes = parseInt(cfg.countdownMinutes, 10) || 0;
        offers = cfg.upsells || [];
        renderOffers();

        // Apply the Form Builder appearance (colors, radius, sizes).
        var bc = cfg.builder;
        if (bc) {
          // "--cod-<name>" <- builder field; a trailing "px" marks a length.
          var VARS = [
            // Buy button
            "btn buttonBg", "btn-text buttonTextColor", "btn-hover buttonHoverBg",
            "btn-radius buttonRadius px", "btn-size buttonTextSize px", "btn-pad-y buttonPaddingY px",
            // Modal shell
            "accent accentColor", "modal-bg modalBg", "modal-text modalTextColor",
            "radius modalRadius px", "width modalWidth px", "heading-size headingSize px",
            "heading-align headingAlign", "overlay-blur overlayBlur px",
            // Fields
            "input-radius inputRadius px", "input-pad-y inputPaddingY px",
            "input-border inputBorderColor", "input-bg inputBg",
            // Submit button
            "submit-bg submitBg", "submit-text submitTextColor",
            // Typography
            "font baseFontSize px"
          ];
          var apply = function (el) {
            VARS.forEach(function (spec) {
              var p = spec.split(" "), v = bc[p[1]];
              if (v != null && v !== "") el.style.setProperty("--cod-" + p[0], v + (p[2] || ""));
            });
            if (bc.overlayOpacity != null) {
              el.style.setProperty("--cod-overlay-bg", "rgba(0,0,0," + (bc.overlayOpacity / 100).toFixed(2) + ")");
            }
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
          toggle("cod--no-img", bc.showProductImage === false);
          toggle("cod--btn-normal", bc.buttonBold === false);
          toggle("cod--btn-auto", bc.buttonFullWidth === false);
          toggle("cod--sticky", bc.stickyMobile === true);
          toggle("cod--anim-pulse", bc.buttonAnimation === "pulse");
          toggle("cod--anim-shine", bc.buttonAnimation === "shine");

          var openBtn = root.querySelector("[data-cod-open]");

          // Embedded mode: put the form back inline and drop the open button.
          if (bc.formType === "embedded" && overlayHome) {
            overlayHome.appendChild(overlay);
            overlay.classList.add("cod--embedded");
            if (openBtn) openBtn.hidden = true;
            startTimer();
          }

          // Buy button label, subtitle and icon.
          if (openBtn && bc.buttonText) {
            // ICONS are constants in this file, so building the SVG from a
            // string injects nothing from outside.
            openBtn.innerHTML = bc.buttonIcon && ICONS[bc.buttonIcon]
              ? '<svg viewBox="0 0 24 24" width="1.05em" height="1.05em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
                ICONS[bc.buttonIcon] + '"/></svg>'
              : "";
            var label = make("span");
            label.textContent = bc.buttonText;
            if (bc.buttonSubtitle) {
              var sub = make("div");
              sub.textContent = bc.buttonSubtitle;
              sub.className = "cod__sub"; // styled in cod-form.css
              label.appendChild(sub);
            }
            openBtn.appendChild(label);
          }

          // Continue button label + whether the items subtotal is appended.
          if (bc.submitText) buttonLabel = bc.submitText;
          if (bc.submitShowTotal === false) showTotalOnSubmit = false;

          // Trust badge under the continue button.
          if (bc.trustBadge) {
            var badge = overlay.querySelector("[data-cod-trust]");
            if (!badge) {
              badge = make("p");
              badge.className = "cod__trust";
              badge.setAttribute("data-cod-trust", "");
              submitBtn.parentNode.insertBefore(badge, submitBtn.nextSibling);
            }
            badge.textContent = bc.trustBadge;
          }
        }

        // Settings arrive after the first paint — repaint so the currency and
        // the button label take effect.
        renderSummary();
      })
      .catch(function () {});

    formEl.addEventListener("change", renderSummary);
    formEl.addEventListener("input", renderSummary);
    renderSummary();

    // ---- Continue to checkout ---------------------------------------------
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submitted) return;

      var variantId = currentVariantId();
      if (!variantId) {
        showMessage("Please choose a product option first.", "error");
        return;
      }

      submitted = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Taking you to checkout…";
      messageEl.hidden = true;

      var items = [{ id: Number(numericId(variantId)), quantity: qty() }];
      chosenOffers().forEach(function (c) {
        items.push({ id: Number(numericId(c.variantId)), quantity: 1 });
      });

      var attributes = {};
      attributes[CART_ATTRIBUTE] = "1";

      fetch(addUrl, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ items: items })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          // Shopify answers 422 with a readable reason — out of stock, or a
          // variant the customer can't buy. Show it rather than a generic error.
          return r.json().then(
            function (d) { throw new Error((d && (d.description || d.message)) || ""); },
            function () { throw new Error(""); }
          );
        })
        // Tags the cart so the app can recognise the resulting order. A failure
        // here only costs the tag, so it must not block the sale.
        .then(function () {
          return fetch(updateUrl, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ attributes: attributes })
          }).catch(function () {});
        })
        // Tells the app embed (cod-embed.js) to send InitiateCheckout to the
        // merchant's pixels, then gives those beacons a moment before leaving.
        .then(function () {
          // detail = items subtotal in the shop's currency.
          document.dispatchEvent(new CustomEvent("cod:checkout", { detail: itemsSubtotalCents() / 100 }));
          setTimeout(function () { location.href = checkoutUrl; }, 400);
        })
        .catch(function (err) {
          submitted = false;
          submitBtn.disabled = false;
          renderSummary();
          showMessage(
            err && err.message
              ? err.message
              : "We couldn't start your checkout. Please try again.",
            "error"
          );
        });
    });
  }

  function boot() { document.querySelectorAll("[data-cod-form]").forEach(initCodForm); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
