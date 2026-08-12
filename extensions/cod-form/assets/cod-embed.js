(function () {
  // Load the merchant's configured marketing pixels site-wide.
  fetch("/apps/cod/settings", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !cfg.pixels) return;
      var p = cfg.pixels;

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
        window.fbq("track", "PageView");
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
          ttq.page();
        })(window, document, "ttq");
      }

      // Google tag (gtag.js)
      if (p.google) {
        var g = document.createElement("script");
        g.async = true;
        g.src = "https://www.googletagmanager.com/gtag/js?id=" + p.google;
        document.head.appendChild(g);
        window.dataLayer = window.dataLayer || [];
        function gtag() { window.dataLayer.push(arguments); }
        gtag("js", new Date());
        gtag("config", p.google);
      }
    })
    .catch(function () { /* pixels are optional */ });
})();
