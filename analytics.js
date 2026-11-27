/* Privacy-safe Yandex.Metrika SPA tracker + Deep-Link parser (Telegram startapp & URL) + Zero-Backend A/B router (v3.0).
 * Pure UMD module (runs in browser & Node.js unit tests). 0 PII.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DSMAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const COUNTER_ID = 114508186;
  const AB_STORAGE_KEY = "dsm_ab_v1";
  const host = typeof location !== "undefined" ? String(location.hostname || "") : "";
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "";
  let lastVirtualUrl = "";

  function initMetrika() {
    if (isLocal || typeof window === "undefined" || typeof document === "undefined") return;
    try {
      const w = window;
      w.ym =
        w.ym ||
        function () {
          (w.ym.a = w.ym.a || []).push(arguments);
        };
      w.ym.l = Date.now();

      const tagUrl = `https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}`;
      let exists = false;
      for (let i = 0; i < document.scripts.length; i += 1) {
        if (document.scripts[i].src === tagUrl) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        const s = document.createElement("script");
        s.async = true;
        s.src = tagUrl;
        const first = document.getElementsByTagName("script")[0];
        if (first && first.parentNode) first.parentNode.insertBefore(s, first);
        else document.head.appendChild(s);
      }

      w.ym(COUNTER_ID, "init", {
        ssr: true,
        webvisor: false,
        clickmap: true,
        ecommerce: "dataLayer",
        referrer: document.referrer,
        url: location.href,
        accurateTrackBounce: true,
        trackLinks: true,
      });
    } catch (_) {}
  }

  function sanitizeParams(paramsObj) {
    if (!paramsObj || typeof paramsObj !== "object") return undefined;
    const out = {};
    const forbidden = /user|username|phone|email|token|initdata|chat_id/i;
    Object.keys(paramsObj).forEach((k) => {
      if (forbidden.test(k)) return;
      const v = paramsObj[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        out[k] = sanitizeParams(v);
      }
    });
    return out;
  }

  function track(goalName, paramsObj) {
    if (isLocal || typeof window === "undefined" || typeof window.ym !== "function") return;
    try {
      const clean = sanitizeParams(paramsObj);
      if (clean && Object.keys(clean).length > 0) {
        window.ym(COUNTER_ID, "reachGoal", String(goalName), clean);
      } else {
        window.ym(COUNTER_ID, "reachGoal", String(goalName));
      }
    } catch (_) {}
  }

  function params(tree) {
    if (isLocal || typeof window === "undefined" || typeof window.ym !== "function") return;
    try {
      const clean = sanitizeParams(tree);
      if (clean && Object.keys(clean).length > 0) {
        window.ym(COUNTER_ID, "params", clean);
      }
    } catch (_) {}
  }

  function screen(virtualHash, title) {
    if (isLocal || typeof window === "undefined" || typeof window.ym !== "function") return;
    try {
      const base = `${location.origin}${location.pathname}`;
      const cleanHash = String(virtualHash || "home").replace(/^#/, "");
      const url = `${base}#${cleanHash}`;
      if (url === lastVirtualUrl) return;
      const prev = lastVirtualUrl || document.referrer;
      lastVirtualUrl = url;
      window.ym(COUNTER_ID, "hit", url, {
        title: String(title || document.title || cleanHash),
        referer: prev,
      });
    } catch (_) {}
  }

  /* Deep-Link parser: supports both Web URL query (?practice=...&program=...&tab=...&src=...&ab=A)
   * AND Telegram Mini App startapp (tgWebAppStartParam: p_<id>, pr_<id>, cat_<slug>, tab_<name>, src_<tag>).
   */
  function parseDeepLink(searchStr, tgObj) {
    const rawSearch =
      typeof searchStr === "string"
        ? searchStr
        : typeof location !== "undefined"
        ? String(location.search || "")
        : "";
    const qs = new URLSearchParams(rawSearch);
    const tg = tgObj || (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) || null;

    const out = {
      practiceId: qs.get("practice") || null,
      programId: qs.get("program") || null,
      category: qs.get("category") || null,
      tab: qs.get("tab") || null,
      src: qs.get("src") || qs.get("utm_source") || "manual_menu",
      abOverride: qs.get("ab") ? String(qs.get("ab")).toUpperCase() : null,
      unlockAll: qs.get("unlock") === "all",
    };

    const startParam =
      qs.get("tgWebAppStartParam") ||
      (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) ||
      "";
    if (startParam) {
      const tokens = String(startParam).split("__").filter(Boolean);
      for (const tok of tokens) {
        if (tok.startsWith("p_") && !out.practiceId) out.practiceId = tok.slice(2);
        else if (tok.startsWith("pr_") && !out.programId) out.programId = tok.slice(3);
        else if (tok.startsWith("cat_") && !out.category) out.category = tok.slice(4);
        else if (tok.startsWith("tab_") && !out.tab) out.tab = tok.slice(4);
        else if (tok.startsWith("src_")) out.src = tok.slice(4);
        else if (tok === "unlock_all") out.unlockAll = true;
      }
    }
    return out;
  }

  /* Zero-Backend A/B Router: sticky localStorage bucket ("A" | "B"), overrideable via ?ab=A|B,
   * reported to Yandex.Metrika visit params (0 PII).
   */
  function getExperimentVariant(expId, opts) {
    const o = opts || {};
    const ls = o.localStorage !== undefined ? o.localStorage : typeof root.localStorage !== "undefined" ? root.localStorage : null;
    const override = o.override && (o.override === "A" || o.override === "B") ? o.override : null;
    let map = {};
    if (ls) {
      try {
        map = JSON.parse(ls.getItem(AB_STORAGE_KEY) || "{}") || {};
      } catch (_) {
        map = {};
      }
    }
    let variant = override || map[expId];
    if (variant !== "A" && variant !== "B") {
      const rand = typeof o.randomFn === "function" ? o.randomFn() : Math.random();
      variant = rand < 0.5 ? "A" : "B";
    }
    map[expId] = variant;
    if (ls) {
      try {
        ls.setItem(AB_STORAGE_KEY, JSON.stringify(map));
      } catch (_) {}
    }
    params({ ab_exp: { [expId]: variant } });
    return variant;
  }

  /* Circadian Clock & Pre-Paint Atmosphere Resolver:
   *   05:00–11:59 -> morning (🌅 Утро · route: утро)
   *   12:00–16:59 -> morning (☀️ День · route: день)
   *   17:00–20:59 -> sunset  (🌇 Вечер · route: вечер)
   *   21:00–04:59 -> night   (🌌 Ночь · route: перед-сном)
   */
  const ATMO_STORAGE_KEY = "dsm_atmo_v1";
  const VALID_ATMO = new Set(["auto", "morning", "sunset", "night"]);

  function resolveCircadian(mode, dateObj) {
    const cleanMode = VALID_ATMO.has(mode) ? mode : "auto";
    const dt = dateObj instanceof Date ? dateObj : new Date();
    const hour = dt.getHours();

    let clockPeriod = "night";
    if (hour >= 5 && hour < 12) clockPeriod = "morning";
    else if (hour >= 12 && hour < 17) clockPeriod = "day";
    else if (hour >= 17 && hour < 21) clockPeriod = "sunset";
    else clockPeriod = "night";

    const effectivePeriod = cleanMode === "auto" ? clockPeriod : cleanMode;
    const atmosphere = effectivePeriod === "day" ? "morning" : effectivePeriod;
    const bgHex = atmosphere === "night" ? "#101729" : atmosphere === "sunset" ? "#fbf2ea" : "#edf2fb";

    let progId = "перед-сном";
    let routeTag = "Ночной маршрут · по часам устройства";
    if (effectivePeriod === "morning") {
      progId = "утро";
      routeTag = cleanMode === "auto" ? "Утренний маршрут · по часам устройства" : "Утренний маршрут";
    } else if (effectivePeriod === "day") {
      progId = "день";
      routeTag = "Дневной маршрут · по часам устройства";
    } else if (effectivePeriod === "sunset") {
      progId = "вечер";
      routeTag = cleanMode === "auto" ? "Вечерний маршрут · по часам устройства" : "Вечерний маршрут";
    } else {
      progId = "перед-сном";
      routeTag = cleanMode === "auto" ? "Ночной маршрут · по часам устройства" : "Ночной маршрут";
    }

    const badgeMap = {
      morning: { ico: "🌅", short: "Утро" },
      day: { ico: "☀️", short: "День" },
      sunset: { ico: "🌇", short: "Вечер" },
      night: { ico: "🌌", short: "Ночь" },
    };
    const b = badgeMap[effectivePeriod] || badgeMap.night;
    const pillLabel = cleanMode === "auto" ? `${b.ico} Авто · ${b.short}` : `${b.ico} ${b.short}`;

    return {
      mode: cleanMode,
      hour,
      clockPeriod,
      effectivePeriod,
      atmosphere,
      bgHex,
      progId,
      routeTag,
      pillLabel,
      isLateNight: effectivePeriod === "night",
    };
  }

  function applyBootAtmosphere() {
    if (typeof document === "undefined" || !document.documentElement) return null;
    let saved = "auto";
    try {
      const qsAtmo = typeof location !== "undefined" ? new URLSearchParams(location.search || "").get("atmo") : null;
      if (qsAtmo && VALID_ATMO.has(qsAtmo)) saved = qsAtmo;
      else if (typeof localStorage !== "undefined") {
        const v = localStorage.getItem(ATMO_STORAGE_KEY);
        if (v && VALID_ATMO.has(v)) saved = v;
      }
    } catch (_) {}
    const info = resolveCircadian(saved);
    document.documentElement.setAttribute("data-atmosphere", info.atmosphere);
    document.documentElement.setAttribute("data-theme", info.atmosphere === "night" ? "dark" : "light");
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", info.bgHex);
    return info;
  }

  applyBootAtmosphere();
  initMetrika();
  return { COUNTER_ID, ATMO_STORAGE_KEY, track, params, screen, parseDeepLink, getExperimentVariant, resolveCircadian, applyBootAtmosphere };
});
