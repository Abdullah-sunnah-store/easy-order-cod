(function () {
  // Easy order COD app embed: loads the merchant's marketing pixels site-wide
  // (PageView) and reports the COD button as a checkout start.
  //
  // The COD block (cod-form.js) dispatches "cod:checkout" with the items
  // subtotal just before it sends the customer to Shopify checkout. Purchase
  // itself happens inside Shopify checkout, which this script cannot see —
  // the merchant's Facebook / Google / TikTok channel apps report that.
  var ready = [];

  function currency() {
    var s = window.Shopify;
    return (s && s.currency && s.currency.active) || undefined;
  }

  // On a product page, ask for that product's extra pixels too (Advanced plan).
  var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
  var product = (meta && meta.product && meta.product.id) || "";
  fetch("/apps/cod/settings?product=" + encodeURIComponent(product), { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.pixels) return;
      var p = cfg.pixels;
      // Product-specific pixels: the first ID per platform loads the library
      // below; any further IDs are initialised on the same library afterwards.
      var extra = {};
      (p.extra || []).forEach(function (x) {
        if (!p[x.platform]) p[x.platform] = x.id;
        else if (p[x.platform] !== x.id) (extra[x.platform] = extra[x.platform] || []).push(x.id);
      });

      // Facebook Pixel
      if (p.facebook) {
        !(function (f, b, e, v, n, t, s) {
          if (f.fbq) return; n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          };
          if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
          t = b.createElement(e); t.async = !0; t.src = v;
          s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
        })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
        window.fbq("init", p.facebook);
        (extra.facebook || []).forEach(function (id) { window.fbq("init", id); });
        window.fbq("track", "PageView");
        ready.push(function (value, cur) {
          window.fbq("track", "InitiateCheckout", { value: value, currency: cur });
        });
      }

      // TikTok Pixel
      if (p.tiktok) {
        (function (w, d, t) {
          w.TiktokAnalyticsObject = t;
          var ttq = (w[t] = w[t] || []);
          ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
          ttq.setAndDefer = function (obj, m) { obj[m] = function () { obj.push([m].concat(Array.prototype.slice.call(arguments, 0))); }; };
          for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
          ttq.load = function (e) {
            var s = "https://analytics.tiktok.com/i18n/pixel/events.js";
            ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = s; ttq._t = ttq._t || {}; ttq._t[e] = +new Date();
            var o = d.createElement("script"); o.type = "text/javascript"; o.async = !0; o.src = s + "?sdkid=" + e;
            var a = d.getElementsByTagName("script")[0]; a.parentNode.insertBefore(o, a);
          };
          ttq.load(p.tiktok);
          (extra.tiktok || []).forEach(function (id) { ttq.load(id); });
          ttq.page();
        })(window, document, "ttq");
        ready.push(function (value, cur) {
          window.ttq.track("InitiateCheckout", { value: value, currency: cur });
        });
      }

      // Google tag (gtag.js)
      if (p.google) {
        var g = document.createElement("script");
        g.async = true;
        g.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(p.google);
        document.head.appendChild(g);
        window.dataLayer = window.dataLayer || [];
        var gtag = function () { window.dataLayer.push(arguments); };
        window.gtag = window.gtag || gtag;
        gtag("js", new Date());
        gtag("config", p.google);
        (extra.google || []).forEach(function (id) { gtag("config", id); });
        ready.push(function (value, cur) {
          gtag("event", "begin_checkout", { value: value, currency: cur });
        });
      }

      // Snapchat Pixel
      if (p.snapchat) {
        (function (e, t, n) {
          if (e.snaptr) return;
          var a = (e.snaptr = function () {
            a.handleRequest ? a.handleRequest.apply(a, arguments) : a.queue.push(arguments);
          });
          a.queue = [];
          var r = t.createElement("script"); r.async = !0; r.src = n;
          var u = t.getElementsByTagName("script")[0]; u.parentNode.insertBefore(r, u);
        })(window, document, "https://sc-static.net/scevent.min.js");
        window.snaptr("init", p.snapchat, {});
        (extra.snapchat || []).forEach(function (id) { window.snaptr("init", id, {}); });
        window.snaptr("track", "PAGE_VIEW");
        ready.push(function (value, cur) {
          window.snaptr("track", "START_CHECKOUT", { price: value, currency: cur });
        });
      }

      // Pinterest Tag
      if (p.pinterest) {
        (function (e) {
          if (window.pintrk) return;
          window.pintrk = function () { window.pintrk.queue.push(Array.prototype.slice.call(arguments)); };
          var n = window.pintrk; n.queue = []; n.version = "3.0";
          var t = document.createElement("script"); t.async = !0; t.src = e;
          var r = document.getElementsByTagName("script")[0]; r.parentNode.insertBefore(t, r);
        })("https://s.pinimg.com/ct/core.js");
        window.pintrk("load", p.pinterest);
        (extra.pinterest || []).forEach(function (id) { window.pintrk("load", id); });
        window.pintrk("page");
        ready.push(function (value, cur) {
          window.pintrk("track", "addtocart", { value: value, currency: cur });
        });
      }
    })
    .catch(function () { /* pixels are optional */ });

  document.addEventListener("cod:checkout", function (e) {
    var value = Number(e && e.detail) || 0;
    var cur = currency();
    ready.forEach(function (send) {
      try { send(value, cur); } catch (err) { /* one pixel must not stop the rest */ }
    });
  });
})();
