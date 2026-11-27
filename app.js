(() => {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const ATMO_CYCLE = ["auto", "morning", "sunset", "night"];
  const qsAtmoOverride = new URLSearchParams(window.location.search).get("atmo");
  let activeAtmoMode =
    qsAtmoOverride && ATMO_CYCLE.includes(qsAtmoOverride)
      ? qsAtmoOverride
      : (() => {
          try {
            const v = localStorage.getItem("dsm_atmo_v1");
            return ATMO_CYCLE.includes(v) ? v : "auto";
          } catch (_) {
            return "auto";
          }
        })();

  function getCircadianInfo() {
    if (window.DSMAnalytics && typeof window.DSMAnalytics.resolveCircadian === "function") {
      return window.DSMAnalytics.resolveCircadian(activeAtmoMode);
    }
    const hour = new Date().getHours();
    const isNight = hour >= 21 || hour < 5;
    const isSunset = hour >= 17 && hour < 21;
    const atmosphere = isNight ? "night" : isSunset ? "sunset" : "morning";
    return {
      mode: activeAtmoMode,
      hour,
      atmosphere,
      bgHex: atmosphere === "night" ? "#101729" : atmosphere === "sunset" ? "#fbf2ea" : "#edf2fb",
      progId: isNight ? "перед-сном" : isSunset ? "вечер" : hour < 12 ? "утро" : "день",
      routeTag: isNight ? "Ночной маршрут · по часам устройства" : "Маршрут по времени дня",
      pillLabel: isNight ? "🌌 Авто · Ночь" : isSunset ? "🌇 Авто · Вечер" : "🌅 Авто · Утро",
      isLateNight: isNight,
    };
  }

  function syncTelegramChrome(isBlackout) {
    const circ = getCircadianInfo();
    const hex = isBlackout ? "#050811" : circ.bgHex;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", hex);
    if (tg) {
      try { tg.setHeaderColor(hex); } catch (_) {}
      try { tg.setBackgroundColor(hex); } catch (_) {}
      try { if (typeof tg.setBottomBarColor === "function") tg.setBottomBarColor(hex); } catch (_) {}
    }
  }
  if (tg) {
    tg.ready();
    tg.expand();
  }
  document.documentElement.setAttribute("data-atmosphere", getCircadianInfo().atmosphere);
  syncTelegramChrome(false);

  // Proven iOS WKWebView audio unlock on every user gesture (capture phase)
  const unlockAudio = () => {
    if (window.DSMAudioCue && typeof window.DSMAudioCue.unlock === "function") {
      window.DSMAudioCue.unlock();
    }
  };
  document.addEventListener("touchend", unlockAudio, { capture: true, passive: true });
  document.addEventListener("click", unlockAudio, { capture: true, passive: true });

  const deepLink =
    window.DSMAnalytics && typeof window.DSMAnalytics.parseDeepLink === "function"
      ? window.DSMAnalytics.parseDeepLink(window.location.search, tg)
      : {
          practiceId: new URLSearchParams(window.location.search).get("practice"),
          programId: new URLSearchParams(window.location.search).get("program"),
          category: new URLSearchParams(window.location.search).get("category"),
          tab: new URLSearchParams(window.location.search).get("tab"),
          src: new URLSearchParams(window.location.search).get("src") || "manual_menu",
          abOverride: null,
          unlockAll: new URLSearchParams(window.location.search).get("unlock") === "all",
        };
  const triggerSource = deepLink.src || "manual_menu";
  const abVariant =
    window.DSMAnalytics && typeof window.DSMAnalytics.getExperimentVariant === "function"
      ? window.DSMAnalytics.getExperimentVariant("exp_dsm_entry_v3", { override: deepLink.abOverride })
      : "A";

  const CATEGORY_META = {
    "дыхание": { emoji: "🫧", label: "Дыхание" },
    "тело": { emoji: "🧍", label: "Тело" },
    "зрение": { emoji: "👁️", label: "Зрение" },
    "слух": { emoji: "👂", label: "Слух" },
    "нейрогимнастика": { emoji: "🧠", label: "Нейрогимнастика" },
    "внимание": { emoji: "🎯", label: "Внимание" },
    "__deep__": { emoji: "✨", label: "Глубокий слой" },
  };
  const CATEGORY_ORDER = ["дыхание", "тело", "зрение", "слух", "нейрогимнастика", "внимание", "__deep__"];
  const SIMPLE_AUTOFLOW_CATS = new Set(["дыхание", "тело", "слух"]);

  const state = {
    client: null,
    catalog: null,
    userState: null,
    activeTab: "programs",
    programGroup: "daily",
    selectedCategory: "дыхание",
    selectedMood: 5,
    currentRecommendation: null,
    // Mode: "single" | "program"
    runMode: "single",
    activeProgram: null,
    activeProgramRunId: null,
    programStepIdx: 0,
    activePractice: null,
    activePhases: [],
    phaseIdx: 0,
    remainingSec: 0,
    phaseEndAtMs: 0,
    lastTickAtMs: 0,
    elapsedSec: 0,
    paused: false,
    timerHandle: null,
    completed: true,
    frictionTag: "none",
    sessionKey: null,
    currentNoiseBefore: 5,
    lastDeltaNoise: 0,
    focusReturns: 0,
    currentViewId: "view-programs",
    pendingUnlockAction: null,
    modalMode: "lock",
    doneContinueTarget: null,
    eyesClosed: false,
    _progGridKey: "",
    _pracListKey: "",
  };

  const TRIBUTE_TG_URL = "https://t.me/tribute/app?startapp=dUHt";
  const TRIBUTE_WEB_URL = "https://web.tribute.tg/d/UHt";

  function isInsideTelegram() {
    return Boolean(tg && (tg.initData || (tg.platform && tg.platform !== "unknown")));
  }

  const $ = (id) => document.getElementById(id);
  const track = (goal, params) => {
    if (window.DSMAnalytics && typeof window.DSMAnalytics.track === "function") {
      window.DSMAnalytics.track(goal, params);
    }
  };
  const trackParams = (tree) => {
    if (window.DSMAnalytics && typeof window.DSMAnalytics.params === "function") {
      window.DSMAnalytics.params(tree);
    }
  };
  const trackScreen = (virtualHash, title) => {
    if (window.DSMAnalytics && typeof window.DSMAnalytics.screen === "function") {
      window.DSMAnalytics.screen(virtualHash, title);
    }
  };
  const visualizer = window.DSMVisualizer ? new window.DSMVisualizer.PracticeVisualizer($("visualizer-host")) : null;
  const allViews = [
    "view-programs",
    "view-program-detail",
    "view-program-transition",
    "view-single",
    "view-practice-detail",
    "view-rhythm",
    "view-timer",
    "view-finish",
    "view-done",
  ];

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getPrefs() {
    return (state.userState && state.userState.prefs) || {
      sandbox_unlocked: false,
      sound_enabled: true,
      seen_milestones: [],
      last_noise_level: 5,
    };
  }

  function getUnlockLevel() {
    if (state.userState && typeof state.userState.unlock_level === "number") {
      return state.userState.unlock_level;
    }
    return 0;
  }

  function isSandbox() {
    return Boolean(getPrefs().sandbox_unlocked);
  }

  function isUnlocked(featureKey) {
    if (window.DSMStorage && typeof window.DSMStorage.isFeatureUnlocked === "function") {
      return window.DSMStorage.isFeatureUnlocked(featureKey, getUnlockLevel());
    }
    return true;
  }

  function featureForProgram(pr) {
    return pr && pr.group === "deep" ? "programs_deep" : "programs_daily";
  }

  function isSimpleAutoFlow(practice) {
    if (state.runMode !== "single" || !practice) return false;
    if (practice.layer === "deep" || practice.id === "krest-razvyazki") return false;
    return SIMPLE_AUTOFLOW_CATS.has(practice.category);
  }

  function noiseMeta(val) {
    const n = Number(val);
    if (n <= 2) return { label: "Спокойно и ясно", cls: "state-low" };
    if (n <= 5) return { label: "Умеренный фон", cls: "state-calm" };
    if (n <= 7) return { label: "Заметное напряжение", cls: "state-mid" };
    return { label: "Высокий шум / тревога", cls: "state-high" };
  }

  function updateNoiseBadge(val, numElId, badgeElId) {
    const n = Number(val);
    const meta = noiseMeta(n);
    const numEl = $(numElId);
    const badge = $(badgeElId);
    if (numEl) numEl.textContent = String(n);
    if (badge) {
      badge.textContent = meta.label;
      badge.className = `state-badge ${meta.cls}`;
    }
  }

  function syncSoundUI() {
    const enabled = window.DSMAudioCue ? window.DSMAudioCue.isEnabled() : true;
    const tBtn = $("btn-timer-sound");
    if (tBtn) {
      tBtn.textContent = enabled ? "🔊" : "🔇";
      tBtn.classList.toggle("muted", !enabled);
      tBtn.setAttribute("aria-pressed", String(enabled));
    }
    const pBtn = $("pref-sound-btn");
    if (pBtn) {
      pBtn.textContent = enabled ? "Вкл" : "Выкл";
      pBtn.classList.toggle("on", enabled);
      pBtn.setAttribute("aria-pressed", String(enabled));
    }
  }

  function syncUnlockUI() {
    const lvl = getUnlockLevel();
    const sandbox = isSandbox();
    const totalEvents = state.userState && state.userState.hud ? Number(state.userState.hud.total_events || 0) : 0;

    const hudPill = $("hud-pill-text");
    if (hudPill) hudPill.textContent = `${totalEvents} · Ритм`;

    const chip = $("now-unlock-chip");
    if (chip) {
      chip.textContent = sandbox ? "Все 60 открыты" : `Ступень ${lvl + 1} / 4`;
      chip.classList.toggle("sandbox", sandbox);
    }

    const hint = $("now-unlock-hint");
    if (hint) {
      if (sandbox) hint.textContent = "Открыты все 60 практик и 13 программ";
      else if (lvl === 0) hint.textContent = "1 короткий шаг откроет ежедневные программы и Тело";
      else if (lvl === 1) hint.textContent = "Ещё 1 шаг откроет Зрение, Слух и Нейрогимнастику";
      else if (lvl === 2) hint.textContent = "Ещё 1 шаг откроет Глубокий слой (45–60 мин)";
      else hint.textContent = "Открыта вся карта: все 60 практик и 13 программ";
    }

    const nowToggle = $("btn-now-unlock-toggle");
    if (nowToggle) {
      nowToggle.textContent = sandbox ? "↺ Вернуть по шагам" : "🔓 Открыть всё сразу";
      nowToggle.classList.toggle("hidden", !sandbox && lvl >= 3);
    }

    const singleToggle = $("btn-single-unlock-toggle");
    if (singleToggle) {
      singleToggle.textContent = sandbox ? "↺ По шагам" : "🔓 Открыть все 60";
      singleToggle.classList.toggle("hidden", !sandbox && lvl >= 3);
    }

    const drawerBadge = $("programs-drawer-badge");
    if (drawerBadge) {
      if (sandbox || lvl >= 3) drawerBadge.textContent = "все 13 открыты";
      else if (lvl >= 1) drawerBadge.textContent = "6 из 13 открыты";
      else drawerBadge.textContent = "откроются после 1 шага";
    }

    const prefBtn = $("pref-sandbox-btn");
    const prefSub = $("pref-sandbox-sub");
    if (prefBtn) {
      prefBtn.textContent = sandbox ? "Всё открыто" : "По шагам";
      prefBtn.classList.toggle("on", sandbox);
      prefBtn.setAttribute("aria-pressed", String(sandbox));
    }
    if (prefSub) {
      prefSub.textContent = sandbox
        ? "Свободный доступ ко всем 60 практикам и 13 программам"
        : `По шагам · сейчас ступень ${lvl + 1} из 4`;
    }
  }

  async function toggleSandboxMode(sourceTag) {
    const next = !isSandbox();
    if (state.client && typeof state.client.updatePrefs === "function") {
      await state.client.updatePrefs({ sandbox_unlocked: next });
    }
    track("sandbox_unlock_toggle", { unlocked: next, source: sourceTag });
    await refreshUserState();
    renderNowHero();
    renderProgramGrid();
    renderCategoryChips();
    renderPracticeList(state.selectedCategory);
    if (state.activeTab === "rhythm") renderRhythm();
  }

  function updateFinishDeltaPreview() {
    const before = Number(state.currentNoiseBefore);
    const after = Number($("noise-after").value);
    const delta = before - after;
    const box = $("finish-delta-preview");
    if (delta > 0) {
      box.className = "delta-preview-box";
      box.innerHTML = `<span>Было <strong>${before}</strong> → стало <strong>${after}</strong></span><span class="delta-pill good">−${delta} к шуму</span>`;
    } else if (delta === 0) {
      box.className = "delta-preview-box neutral";
      box.innerHTML = `<span>Было <strong>${before}</strong> → стало <strong>${after}</strong></span><span class="delta-pill flat">ровно</span>`;
    } else {
      box.className = "delta-preview-box neutral";
      box.innerHTML = `<span>Было <strong>${before}</strong> → стало <strong>${after}</strong></span><span class="delta-pill up">+${Math.abs(delta)} · честная отметка</span>`;
    }
  }

  function setEyesClosedMode(flag) {
    const next = Boolean(flag);
    state.eyesClosed = next;
    if (next) {
      document.documentElement.setAttribute("data-blackout", "true");
      if (window.DSMAudioCue) {
        window.DSMAudioCue.unlock();
        window.DSMAudioCue.setEnabled(true);
        syncSoundUI();
      }
    } else {
      document.documentElement.removeAttribute("data-blackout");
    }
    syncTelegramChrome(next);
    const btn = $("btn-eyes-closed");
    if (btn) {
      btn.classList.toggle("active", next);
      btn.setAttribute("aria-pressed", String(next));
      btn.textContent = next ? "☀ Свет" : "🌙 Без экрана";
    }
    const whisper = $("blackout-whisper");
    if (whisper) whisper.classList.toggle("hidden", !next);
    if (visualizer && typeof visualizer.setEyesClosedGuide === "function") {
      visualizer.setEyesClosedGuide(next);
    }
  }

  function stopActiveTimer() {
    if (state.timerHandle) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
    state.paused = false;
    state.phaseEndAtMs = 0;
    if (state.eyesClosed) setEyesClosedMode(false);
    if (window.DSMAudioCue && typeof window.DSMAudioCue.releaseWakeLock === "function") {
      window.DSMAudioCue.releaseWakeLock();
    }
    if (visualizer) visualizer.stop();
  }

  function showView(viewId, showTabs = false) {
    state.currentViewId = viewId;
    allViews.forEach((v) => $(v).classList.toggle("hidden", v !== viewId));
    $("main-tabs").classList.toggle("hidden", !showTabs);
    const footer = $("app-support-footer");
    if (footer) footer.classList.toggle("hidden", viewId !== "view-programs");
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (viewId === "view-programs") trackScreen("now", "Сейчас");
    else if (viewId === "view-single") trackScreen("single", "Практики");
    else if (viewId === "view-rhythm") trackScreen("rhythm", "Мой ритм");
    else if (viewId === "view-program-detail" && state.activeProgram) {
      trackScreen(`program/${state.activeProgram.id}`, `Программа: ${state.activeProgram.title}`);
    } else if (viewId === "view-practice-detail" && state.activePractice) {
      trackScreen(`practice/${state.activePractice.id}`, `Практика: ${state.activePractice.title}`);
    } else if (viewId === "view-timer" && state.activePractice) {
      trackScreen(`timer/${state.activePractice.id || "step"}`, `Таймер: ${state.activePractice.title}`);
    } else if (viewId === "view-program-transition" && state.activeProgram) {
      trackScreen(`program-step/${state.activeProgram.id}`, `Переход: ${state.activeProgram.title}`);
    } else if (viewId === "view-finish") {
      trackScreen(`finish/${state.runMode}`, "Оценка состояния после");
    } else if (viewId === "view-done") {
      trackScreen(`done/${state.runMode}`, "Состояние зафиксировано");
    }
  }

  function setTab(tabName) {
    stopActiveTimer();
    const changed = state.activeTab !== tabName;
    state.activeTab = tabName;
    if (changed) track("tab_switch", { tab: tabName });
    const dockIdx = tabName === "single" ? 1 : tabName === "rhythm" ? 2 : 0;
    const dock = $("main-tabs");
    if (dock) {
      dock.style.setProperty("--dock-idx", String(dockIdx));
      dock.setAttribute("data-dock-idx", String(dockIdx));
    }
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    if (tabName === "programs") {
      renderNowHero();
      renderProgramGrid();
      showView("view-programs", true);
    } else if (tabName === "single") {
      renderCategoryChips();
      renderPracticeList(state.selectedCategory);
      showView("view-single", true);
    } else if (tabName === "rhythm") {
      renderRhythm();
      showView("view-rhythm", true);
    }
  }

  function goHome() {
    stopActiveTimer();
    setTab("programs");
    refreshUserState().then(() => {
      if (state.activeTab === "programs" && state.currentViewId === "view-programs") {
        renderNowHero();
        renderProgramGrid();
      }
    }).catch(() => {});
  }

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    if (tg && tg.initData) h["X-Telegram-Init-Data"] = tg.initData;
    else h["X-Dev-User-Id"] = "10001";
    return h;
  }

  function fmtClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }

  function catDisplay(catKey) {
    if (CATEGORY_META[catKey]) return CATEGORY_META[catKey];
    const clean = String(catKey || "практика");
    return { emoji: "🫧", label: clean.charAt(0).toUpperCase() + clean.slice(1) };
  }

  function findPractice(id) {
    return (state.catalog && state.catalog.practices || []).find((p) => p.id === id) || null;
  }

  function findProgram(id) {
    return (state.catalog && state.catalog.programs || []).find((p) => p.id === id) || null;
  }

  // -------- DUAL-MODE PROGRESSIVE UNLOCK / MILESTONE MODAL --------

  function stageCopyForFeature(featureKey) {
    if (featureKey === "programs_daily" || featureKey === "тело") {
      return {
        kicker: "Ступень 2 / 4 · Простой вход",
        title: "Откроется после 1 короткого шага",
        body: "Сделай 1-минутный сброс — и откроются все 6 ежедневных программ и телесные практики. Если хочешь увидеть всю карту сразу — открой её в 1 клик, без подписок.",
      };
    }
    if (featureKey === "зрение" || featureKey === "слух" || featureKey === "нейрогимнастика") {
      return {
        kicker: "Ступень 3 / 4 · Новые каналы",
        title: "Откроется после 2 практик",
        body: "Здесь практики зрения, слуха и нейрогимнастика — включая 5-фазный «Крест развязки». Можно пройти шаг по порядку или открыть все 60 практик прямо сейчас.",
      };
    }
    return {
      kicker: "Ступень 4 / 4 · Глубокий слой",
      title: "Откроется после 3 практик",
      body: "Здесь 45–60-минутные программы и глубокие практики внимания (от 20 мин). Мы бережём тебя от перегруза на старте — но ты всегда можешь открыть всё сразу в 1 клик.",
    };
  }

  function openLockModal(featureKey, pendingAction) {
    const copy = stageCopyForFeature(featureKey);
    state.modalMode = "lock";
    state.pendingUnlockAction = typeof pendingAction === "function" ? pendingAction : null;
    $("unlock-modal-kicker").textContent = copy.kicker;
    $("unlock-modal-title").textContent = copy.title;
    $("unlock-modal-body").textContent = copy.body;
    $("unlock-tribute-box").classList.add("hidden");
    $("btn-unlock-primary").textContent = "▶ Пройти короткий шаг (1 мин)";
    $("btn-unlock-primary").classList.remove("hidden");
    $("btn-unlock-all").textContent = "🔓 Открыть все 60 практик сразу";
    $("btn-unlock-all").classList.remove("hidden");
    $("btn-unlock-close").textContent = "Позже";
    $("unlock-modal").classList.remove("hidden");
    track("lock_modal_shown", { feature: featureKey, unlock_level: getUnlockLevel() });
  }

  function openMilestoneModal(level) {
    state.modalMode = "milestone";
    state.pendingUnlockAction = null;
    let kicker = "Новый слой открыт";
    let title = "✨ Открылись ежедневные программы и Тело";
    let body = "Первый шаг сделан — теперь доступны 6 готовых маршрутов на каждый день и телесные практики.";
    if (level === 2) {
      kicker = "Ступень 3 / 4 открыта";
      title = "👁 Открылись Зрение, Слух и Нейрогимнастика";
      body = "Теперь доступны практики переключения внимания — в том числе 5-фазный «Крест развязки».";
    } else if (level >= 3) {
      kicker = "Ступень 4 / 4 · Вся карта открыта";
      title = "✨ Открылся Глубокий слой";
      body = "Теперь открыты все 60 практик и 7 глубоких программ (40–60 мин). Выбирай ритм по своему состоянию.";
    }
    $("unlock-modal-kicker").textContent = kicker;
    $("unlock-modal-title").textContent = title;
    $("unlock-modal-body").textContent = body;
    $("unlock-tribute-box").classList.remove("hidden");
    $("btn-unlock-primary").textContent = "Отлично, идём дальше";
    $("btn-unlock-primary").classList.remove("hidden");
    $("btn-unlock-all").classList.add("hidden");
    $("btn-unlock-close").textContent = "Закрыть";
    $("unlock-modal").classList.remove("hidden");
    track("milestone_modal_shown", { level });
  }

  function closeUnlockModal() {
    $("unlock-modal").classList.add("hidden");
    state.pendingUnlockAction = null;
  }

  // -------- TAB 1: NOW HERO + COLLAPSED PROGRAMS DRAWER --------

  function getSmartRecommendation(moodVal, unlockLevel) {
    const mood = Number(moodVal);
    const circ = getCircadianInfo();
    if (mood >= 7) {
      const p = findPractice("fiziologicheskij-vzdoh") || state.catalog.practices[0];
      return {
        kind: "practice",
        entity: p,
        tag: "Острый сброс · 1 касание",
        sub: p.summary || "Двойной вдох и длинный выдох — быстро снижает пик тревоги и шума.",
        cta: `▶ Начать сейчас · ${p.duration_min} мин`,
      };
    }
    if (mood <= 3) {
      if (circ.isLateNight) {
        const sleepP = findPractice("dyhanie-4-7-8") || findPractice("kogerentnoe-dyhanie") || state.catalog.practices[0];
        return {
          kind: "practice",
          entity: sleepP,
          tag: "Тихое дыхание на ночь",
          sub: sleepP.summary || "Плавный длинный выдох мягко переводит нервную систему ко сну.",
          cta: `▶ Начать спокойно · ${sleepP.duration_min} мин`,
        };
      }
      if (unlockLevel >= 2) {
        const p = findPractice("krest-razvyazki") || findPractice("panorama");
        if (p) {
          return {
            kind: "practice",
            entity: p,
            tag: "Тренировка ясности",
            sub: p.summary || "Раздели взгляд и внимание — спокойная настройка фокуса.",
            cta: `▶ Открыть практику · ${p.duration_min} мин`,
          };
        }
      }
      const p = findPractice("kogerentnoe-dyhanie") || findPractice("nablyudenie-dyhaniya") || state.catalog.practices[0];
      return {
        kind: "practice",
        entity: p,
        tag: "Углубить спокойствие",
        sub: p.summary || "Ровный мягкий ритм дыхания закрепляет ясное состояние.",
        cta: `▶ Начать сейчас · ${p.duration_min} мин`,
      };
    }

    // Mood 4..6 ("Фон") — strictly follows local device clock (05-11 утро, 12-16 день, 17-20 вечер, 21-04 перед-сном)
    if (unlockLevel >= 1) {
      const pr = findProgram(circ.progId);
      if (pr) {
        return {
          kind: "program",
          entity: pr,
          tag: circ.routeTag,
          sub: pr.outcome || pr.goal || "Спокойный маршрут из нескольких коротких шагов.",
          cta: `▶ Запустить «${pr.title}» · ${pr.duration_min} мин`,
        };
      }
    }

    if (circ.isLateNight) {
      const np = findPractice("dyhanie-4-7-8") || findPractice("vydoh-dlinnee") || findPractice("fiziologicheskij-vzdoh") || state.catalog.practices[0];
      return {
        kind: "practice",
        entity: np,
        tag: "Ночной сброс · 1 касание",
        sub: np.summary || "Плавный выдох перед сном — убирает дневной шум без яркого экрана.",
        cta: `▶ Начать сейчас · ${np.duration_min} мин`,
      };
    }

    const fallbackId = abVariant === "B" ? "myagkoe-dyhanie" : "fiziologicheskij-vzdoh";
    const p = findPractice(fallbackId) || findPractice("fiziologicheskij-vzdoh") || state.catalog.practices[0];
    return {
      kind: "practice",
      entity: p,
      tag: "Мягкий старт · 1 касание",
      sub: p.summary || "Короткая точка входа, чтобы переключить фон в тишину.",
      cta: `▶ Начать сейчас · ${p.duration_min} мин`,
    };
  }

  function renderNowHero(animateMorph = false) {
    if (!state.catalog) return;
    document.querySelectorAll(".mood-pill").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.mood) === Number(state.selectedMood));
    });
    const rec = getSmartRecommendation(state.selectedMood, getUnlockLevel());
    state.currentRecommendation = rec;
    if (rec && rec.entity) {
      $("now-rec-tag").textContent = rec.tag;
      $("now-rec-title").textContent = `${rec.entity.emoji || "🫧"} ${rec.entity.title}`;
      $("now-rec-sub").textContent = rec.sub;
      $("btn-now-start").textContent = rec.cta;
      const recBox = $("now-rec-box");
      if (animateMorph && recBox) {
        recBox.classList.remove("is-morphing");
        void recBox.offsetWidth;
        recBox.classList.add("is-morphing");
      }
    }
    syncUnlockUI();
  }

  function renderProgramGrid(force = false) {
    if (!state.catalog) return;
    const key = `${state.programGroup}:${getUnlockLevel()}:${isSandbox()}`;
    if (!force && state._progGridKey === key) return;
    state._progGridKey = key;
    const grid = $("program-grid");
    const items = state.catalog.programs.filter((p) => p.group === state.programGroup);
    grid.innerHTML = items
      .map((pr, idx) => {
        const feat = featureForProgram(pr);
        const unlocked = isUnlocked(feat);
        return `
      <button class="prog-card cascade-item${unlocked ? "" : " is-locked"}" style="--stagger:${Math.min(idx, 8)}" data-prog="${esc(pr.id)}" type="button">
        <div class="prog-card-top">
          <span class="prog-card-title">${unlocked ? esc(pr.emoji) : "🔒"} ${esc(pr.title)}</span>
          <span class="prog-card-meta">${unlocked ? `${pr.duration_min} мин · ${pr.steps.length} ш. <span class="prog-chevron">›</span>` : `<span class="lock-pill">Открыть ›</span>`}</span>
        </div>
        <div class="prog-outcome-tag">Итог</div>
        <p class="prog-card-goal">${esc(pr.outcome || pr.goal || "Спокойное, собранное состояние.")}</p>
      </button>`;
      })
      .join("");
    grid.querySelectorAll("[data-prog]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pr = findProgram(btn.dataset.prog);
        if (!pr) return;
        const feat = featureForProgram(pr);
        if (!isUnlocked(feat)) {
          openLockModal(feat, () => openProgramDetail(pr.id));
          return;
        }
        openProgramDetail(pr.id);
      });
    });
  }

  function openProgramDetail(progId) {
    const pr = findProgram(progId);
    if (!pr) return;
    stopActiveTimer();
    state.activeProgram = pr;
    $("pd-title").textContent = `${pr.emoji} ${pr.title}`;
    $("pd-meta").textContent = `${pr.duration_min} мин · шагов: ${pr.steps.length}`;
    $("pd-goal").innerHTML = `<span class="prog-outcome-tag">Что ты получишь</span><br/>${esc(pr.outcome || pr.goal || "Спокойное, ясное состояние.")}`;
    $("pd-steps-count").textContent = `${pr.steps.length} шагов`;
    $("pd-steps").innerHTML = pr.steps
      .map(
        (s) =>
          `<li>${esc(s.emoji)} <strong>${esc(s.title)}</strong> <span class="route-note">· ${Math.max(1, Math.round(s.duration_sec / 60))} мин${s.note && s.kind === "practice" ? " · " + esc(s.note) : ""}</span></li>`
      )
      .join("");

    if (pr.scheme && pr.scheme.length) {
      $("pd-scheme").innerHTML = pr.scheme.map((x) => `<li>${esc(x)}</li>`).join("");
      $("pd-scheme-wrap").classList.remove("hidden");
    } else {
      $("pd-scheme-wrap").classList.add("hidden");
    }
    const routeDrawer = $("pd-route-drawer");
    if (routeDrawer) routeDrawer.open = false;

    $("pd-noise-before").value = String(state.selectedMood);
    updateNoiseBadge(state.selectedMood, "pd-before-val", "pd-before-badge");
    track("program_open", { program_id: pr.id, title: pr.title, group: pr.group });
    trackParams({ program_opened: { [pr.title]: 1 } });
    showView("view-program-detail", false);
  }

  // -------- TAB 2: SINGLE PRACTICES (PROGRESSIVE UNLOCK + 1-TAP FREEDOM) --------

  function practicesForCategory(catKey) {
    if (catKey === "__deep__") {
      return state.catalog.practices.filter((p) => p.layer === "deep");
    }
    return state.catalog.practices.filter((p) => p.category === catKey);
  }

  function availableCategories() {
    const present = new Set(state.catalog.practices.map((p) => p.category));
    const hasDeep = state.catalog.practices.some((p) => p.layer === "deep");
    const list = CATEGORY_ORDER.filter((c) => (c === "__deep__" ? hasDeep : present.has(c)));
    present.forEach((c) => {
      if (!list.includes(c)) list.push(c);
    });
    return list;
  }

  function renderCategoryChips() {
    const cats = availableCategories();
    if (!cats.includes(state.selectedCategory) || !isUnlocked(state.selectedCategory)) {
      state.selectedCategory = "дыхание";
    }
    $("cat-chips").innerHTML = cats
      .map((c) => {
        const meta = catDisplay(c);
        const cnt = practicesForCategory(c).length;
        const unlocked = isUnlocked(c);
        const act = c === state.selectedCategory ? " active" : "";
        const lockCls = unlocked ? "" : " is-locked";
        return `<button class="cat-chip${act}${lockCls}" data-cat="${esc(c)}" type="button">${unlocked ? meta.emoji : "🔒"} ${esc(meta.label)}<span class="cat-cnt">${cnt}</span></button>`;
      })
      .join("");
    $("cat-chips").querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetCat = btn.dataset.cat;
        if (!isUnlocked(targetCat)) {
          openLockModal(targetCat, () => {
            state.selectedCategory = targetCat;
            renderCategoryChips();
            renderPracticeList(targetCat);
          });
          return;
        }
        state.selectedCategory = targetCat;
        track("category_select", { category: state.selectedCategory });
        trackParams({ category_opened: { [catDisplay(state.selectedCategory).label]: 1 } });
        renderCategoryChips();
        renderPracticeList(state.selectedCategory);
      });
    });
  }

  function renderPracticeList(catKey, force = false) {
    if (!state.catalog) return;
    const key = `${catKey}:${getUnlockLevel()}:${isSandbox()}`;
    if (!force && state._pracListKey === key) return;
    state._pracListKey = key;
    const items = practicesForCategory(catKey);
    const meta = catDisplay(catKey);
    $("practice-list-title").textContent = `${meta.emoji} ${meta.label}`;
    $("practice-list-count").textContent = `${items.length} практик`;
    $("practice-list").innerHTML = items
      .map(
        (p, idx) => `
      <button class="prog-card cascade-item" style="--stagger:${Math.min(idx, 8)}" data-prac="${esc(p.id)}" type="button">
        <div class="prog-card-top">
          <span class="prog-card-title">${esc(p.emoji)} ${esc(p.title)}</span>
          <span class="prog-card-meta">${p.duration_min} мин · ${p.phases.length} ф. <span class="prog-chevron">›</span></span>
        </div>
        <p class="prog-card-goal">${esc(p.summary || "Практика внимания и сброса шума.")}</p>
      </button>`
      )
      .join("");
    $("practice-list").querySelectorAll("[data-prac]").forEach((btn) => {
      btn.addEventListener("click", () => openPracticeDetail(btn.dataset.prac));
    });
  }

  function openPracticeDetail(pid) {
    const p = findPractice(pid);
    if (!p) return;
    stopActiveTimer();
    state.activePractice = p;
    if (p.category && isUnlocked(p.category)) state.selectedCategory = p.category;
    const cat = catDisplay(p.category);

    $("pr-title").textContent = `${p.emoji} ${p.title}`;
    $("pr-meta").textContent = `${cat.emoji} ${cat.label} · ${p.duration_min} мин · фаз: ${p.phases.length}`;
    $("pr-summary").innerHTML = `<span class="prog-outcome-tag">Что ты получишь</span><br/>${esc(p.summary || "Спокойное, ясное состояние и снижение внутреннего шума.")}`;
    renderGuidanceCard($("pr-guidance"), p, null, false);

    const prep = Array.isArray(p.preparation) ? p.preparation.filter(Boolean) : [];
    if (prep.length) {
      $("pr-prep").innerHTML = prep.map((x) => `<li>${esc(x)}</li>`).join("");
      $("pr-prep-wrap").classList.remove("hidden");
    } else {
      $("pr-prep-wrap").classList.add("hidden");
    }

    $("pr-phases-count").textContent = `${(p.phases || []).length} фаз`;
    $("pr-phases").innerHTML = (p.phases || [])
      .map(
        (ph) =>
          `<li><strong>${esc(ph.title)}</strong> <span class="route-note">· ${Math.max(1, Math.round((ph.duration_sec || 60) / 60))} мин</span></li>`
      )
      .join("");

    const detDrawer = $("pr-details-drawer");
    if (detDrawer) detDrawer.open = false;

    $("noise-before").value = String(state.selectedMood);
    updateNoiseBadge(state.selectedMood, "before-val", "before-badge");
    track("practice_open", { practice_id: p.id, title: p.title, category: p.category, duration_min: p.duration_min });
    trackParams({ practice_opened: { [p.title]: 1 } });
    showView("view-practice-detail", false);
  }

  // -------- TAB 3: MY RHYTHM — PRACTICE, ANXIETY & NOISE IMPACT HUD --------

  function smoothSplinePath(coords) {
    if (!coords.length) return "";
    if (coords.length === 1) return `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
    let d = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i === 0 ? 0 : i - 1];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function buildTrendSvg(points) {
    const hostEl = $("rhythm-trend-chart");
    const rawW = hostEl && hostEl.clientWidth ? hostEl.clientWidth : 380;
    const W = Math.max(320, Math.min(860, Math.round(rawW)));
    const H = W >= 540 ? 176 : 152;
    const padL = 28;
    const padR = 16;
    const padT = 14;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = points.length;
    const yFor = (val) => padT + plotH * (1 - Math.max(0, Math.min(10, val)) / 10);
    const xFor = (i) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));

    const gridLines = [0, 5, 10]
      .map((v) => {
        const y = yFor(v).toFixed(1);
        return `
          <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--dsm-line-subtle)" stroke-dasharray="${v === 5 ? "4 4" : "none"}" />
          <text x="${padL - 7}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" fill="var(--dsm-ink-muted)" font-size="10.5" font-weight="600">${v}</text>
        `;
      })
      .join("");

    const afterCoords = points.map((pt, i) => [xFor(i), yFor(pt.after)]);
    const beforeCoords = points.map((pt, i) => [xFor(i), yFor(pt.before)]);
    const afterPath = smoothSplinePath(afterCoords);
    const beforePath = smoothSplinePath(beforeCoords);
    const areaPath =
      n > 1
        ? `${afterPath} L ${afterCoords[n - 1][0].toFixed(1)} ${(H - padB).toFixed(1)} L ${afterCoords[0][0].toFixed(1)} ${(H - padB).toFixed(1)} Z`
        : "";

    const capsules = points
      .map((pt, i) => {
        const x = xFor(i).toFixed(1);
        const yB = yFor(pt.before).toFixed(1);
        const yA = yFor(pt.after).toFixed(1);
        const label = pt.ts ? pt.ts.slice(5, 10).replace("-", ".") : `#${i + 1}`;
        return `
          <line x1="${x}" y1="${yB}" x2="${x}" y2="${yA}" stroke="var(--dsm-line-subtle)" stroke-width="5" stroke-linecap="round" />
          <circle cx="${x}" cy="${yB}" r="4.2" fill="var(--dsm-coral)" stroke="var(--viz-surface)" stroke-width="1.6" />
          <circle cx="${x}" cy="${yA}" r="5.2" fill="var(--viz-surface)" stroke="var(--dsm-cobalt)" stroke-width="2.6" />
          <text x="${x}" y="${H - 7}" text-anchor="middle" fill="var(--dsm-ink-muted)" font-size="10" font-weight="600">${esc(label)}</text>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Волна уровня тревоги и шума до и после практик">
        <defs>
          <linearGradient id="waveAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:var(--dsm-cyan)" stop-opacity="0.32" />
            <stop offset="60%" style="stop-color:var(--dsm-cobalt)" stop-opacity="0.12" />
            <stop offset="100%" style="stop-color:var(--dsm-cobalt)" stop-opacity="0.0" />
          </linearGradient>
          <linearGradient id="waveStrokeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:var(--dsm-cyan)" />
            <stop offset="55%" style="stop-color:var(--dsm-cobalt)" />
            <stop offset="100%" style="stop-color:var(--dsm-indigo)" />
          </linearGradient>
        </defs>
        ${gridLines}
        ${n > 1 ? `<path d="${areaPath}" fill="url(#waveAreaGrad)" />` : ""}
        ${n > 1 ? `<path d="${beforePath}" fill="none" stroke="var(--dsm-coral)" stroke-opacity="0.48" stroke-width="1.8" stroke-dasharray="4 4" />` : ""}
        ${n > 1 ? `<path d="${afterPath}" fill="none" stroke="url(#waveStrokeGrad)" stroke-width="3.2" stroke-linecap="round" />` : ""}
        ${capsules}
      </svg>
    `;
  }

  function syncAtmosphereUI() {
    const circ = getCircadianInfo();
    document.documentElement.setAttribute("data-atmosphere", circ.atmosphere);
    document.documentElement.setAttribute("data-theme", state.eyesClosed || circ.atmosphere === "night" ? "dark" : "light");
    syncTelegramChrome(state.eyesClosed);
    const pillTxt = $("atmosphere-pill-text");
    if (pillTxt) pillTxt.textContent = circ.pillLabel;
    const prefBtn = $("pref-atmo-btn");
    const prefSub = $("pref-atmo-sub");
    if (prefBtn) {
      const btnMap = { auto: "Авто", morning: "🌅 Утро", sunset: "🌇 Вечер", night: "🌌 Ночь" };
      prefBtn.textContent = btnMap[activeAtmoMode] || "Авто";
      prefBtn.classList.toggle("on", activeAtmoMode === "auto");
    }
    if (prefSub) {
      prefSub.textContent =
        activeAtmoMode === "auto"
          ? `По часам устройства (${String(circ.hour).padStart(2, "0")}:00) · сейчас ${circ.pillLabel.replace("Авто · ", "")}`
          : `Вручную выбрано: ${circ.pillLabel} (нажми, чтобы вернуть Авто)`;
    }
  }

  async function cycleAtmosphereMode(sourceTag) {
    const curIdx = Math.max(0, ATMO_CYCLE.indexOf(activeAtmoMode));
    activeAtmoMode = ATMO_CYCLE[(curIdx + 1) % ATMO_CYCLE.length];
    try {
      localStorage.setItem("dsm_atmo_v1", activeAtmoMode);
    } catch (_) {}
    syncAtmosphereUI();
    renderNowHero(true);
    if (state.activeTab === "rhythm") renderRhythm();
    track("atmosphere_switch", { mode: activeAtmoMode, atmosphere: getCircadianInfo().atmosphere, source: sourceTag });
    if (state.client && typeof state.client.updatePrefs === "function") {
      state.client.updatePrefs({ atmosphere_mode: activeAtmoMode }).catch(() => {});
    }
  }

  function renderRhythm() {
    syncSoundUI();
    syncUnlockUI();
    syncAtmosphereUI();
    const st = state.userState;
    if (!st) {
      $("rhythm-impact-hero").className = "hud-hero empty";
      $("rhythm-impact-hero").innerHTML = `<div class="muted" style="margin:0">Нет данных (подключи Telegram или локальный режим).</div>`;
      $("rhythm-stats").innerHTML = "";
      $("rhythm-chart-wrap").classList.add("hidden");
      $("rhythm-top-wrap").classList.add("hidden");
      $("rhythm-curve").innerHTML = "";
      $("rhythm-history").innerHTML = "";
      return;
    }

    const hud = st.hud || {
      completed_practices: st.total_sessions || 0,
      completed_programs: (st.recent_program_runs || []).filter((r) => r.status === "completed").length,
      total_events: st.total_sessions || 0,
      total_minutes: 0,
      calm_days: 0,
      avg_noise_before: 0,
      avg_noise_after: 0,
      avg_delta_noise: st.avg_delta_noise || 0,
      reduction_pct: 0,
      improved_pct: 0,
      recent_trend: [],
      top_effective: [],
    };

    const hero = $("rhythm-impact-hero");
    if (hud.total_events > 0) {
      hero.className = "hud-hero";
      const pctBefore = Math.min(100, Math.round((hud.avg_noise_before / 10) * 100));
      const pctAfter = Math.min(100, Math.round((hud.avg_noise_after / 10) * 100));
      const dropText =
        hud.avg_delta_noise > 0
          ? `−${hud.avg_delta_noise} балла · −${hud.reduction_pct}%`
          : hud.avg_delta_noise === 0
          ? "ровный фон"
          : `+${Math.abs(hud.avg_delta_noise)} балла`;
      const chipCls = hud.avg_delta_noise > 0 ? "hud-delta-chip" : "hud-delta-chip neutral";

      hero.innerHTML = `
        <div class="hud-hero-top">
          <div>
            <div class="hud-kicker">Средний шум и тревога</div>
            <div class="hud-big-shift">
              <span>${hud.avg_noise_before}</span><span class="arr">→</span><span class="after-num">${hud.avg_noise_after}</span>
            </div>
          </div>
          <div class="${chipCls}">${dropText}</div>
        </div>
        <div class="hud-bar-pair">
          <div class="hud-bar-row">
            <span>До</span>
            <div class="hud-bar-track"><div class="hud-bar-fill before" style="width:${pctBefore}%"></div></div>
            <strong>${hud.avg_noise_before}</strong>
          </div>
          <div class="hud-bar-row">
            <span>После</span>
            <div class="hud-bar-track"><div class="hud-bar-fill after" style="width:${pctAfter}%"></div></div>
            <strong style="color:var(--emerald)">${hud.avg_noise_after}</strong>
          </div>
        </div>
        <div class="hud-hero-foot">
          <span>В <strong>${hud.improved_pct}%</strong> сессий шум и тревога снижались</span>
          <span>Замеров: ${hud.total_events}${hud.total_focus_returns > 0 ? ` · Возвратов: ${hud.total_focus_returns}` : ""}</span>
        </div>
      `;
    } else {
      hero.className = "hud-hero empty";
      hero.innerHTML = `
        <div style="font-size:28px;margin-bottom:6px">🫧</div>
        <div style="font-weight:650;margin-bottom:4px">Твой ритм спокойствия пока пуст</div>
        <p class="muted" style="margin:0 0 10px">Отмечай уровень тревоги и шума до и после практики — здесь появится живой график влияния практик на твоё состояние.</p>
        <button id="btn-hud-first" class="btn primary small" type="button">⚡ Попробовать 1-мин сброс</button>
      `;
      $("btn-hud-first").addEventListener("click", () => {
        track("hud_first_cta_click");
        const p = findPractice("fiziologicheskij-vzdoh");
        if (p) launchSinglePractice(p, state.selectedMood);
      });
    }

    $("rhythm-stats").innerHTML = `
      <div class="stat-box"><div class="stat-val">${hud.completed_practices}</div><div class="stat-lbl">Практик</div></div>
      <div class="stat-box"><div class="stat-val">${hud.completed_programs}</div><div class="stat-lbl">Программ</div></div>
      <div class="stat-box"><div class="stat-val">${hud.total_minutes}</div><div class="stat-lbl">Минут</div></div>
      <div class="stat-box"><div class="stat-val">${hud.calm_days}</div><div class="stat-lbl">Дней</div></div>
    `;

    const trend = hud.recent_trend || [];
    if (trend.length > 0) {
      $("rhythm-chart-wrap").classList.remove("hidden");
      $("rhythm-trend-chart").innerHTML = buildTrendSvg(trend);
    } else {
      $("rhythm-chart-wrap").classList.add("hidden");
    }

    const top = hud.top_effective || [];
    if (top.length > 0) {
      $("rhythm-top-wrap").classList.remove("hidden");
      $("rhythm-top-effective").innerHTML = top
        .map((item) => {
          const pillCls = item.avg_delta > 0 ? "good" : item.avg_delta === 0 ? "flat" : "up";
          const pillTxt = item.avg_delta > 0 ? `−${item.avg_delta}` : item.avg_delta === 0 ? "0" : `+${Math.abs(item.avg_delta)}`;
          return `
            <button class="list-row clickable" data-open-kind="${esc(item.kind)}" data-open-id="${esc(item.entity_id)}" type="button">
              <div class="row-main">
                <span class="row-title">${esc(item.emoji)} ${esc(item.title)}</span>
                <span class="row-sub">сессий: ${item.count} · в среднем ${item.avg_before} → ${item.avg_after}</span>
              </div>
              <div class="row-right">
                <span class="delta-pill ${pillCls}">${pillTxt}</span>
              </div>
            </button>
          `;
        })
        .join("");
      $("rhythm-top-effective").querySelectorAll("[data-open-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          track("hud_top_practice_click", { kind: btn.dataset.openKind, entity_id: btn.dataset.openId });
          if (btn.dataset.openKind === "program") openProgramDetail(btn.dataset.openId);
          else openPracticeDetail(btn.dataset.openId);
        });
      });
    } else {
      $("rhythm-top-wrap").classList.add("hidden");
    }

    const curve = st.schedule || [];
    $("rhythm-curve").innerHTML = curve.length
      ? curve
          .slice(0, 8)
          .map((c) => {
            const pct = Math.max(0, Math.min(100, Math.round((c.stability_score || 0) * 100)));
            const title = c.title || c.practice_id;
            const emoji = c.emoji || "🫧";
            const dueDate = String(c.next_due_at || "").slice(0, 10);
            return `
              <div class="list-row">
                <div class="row-main">
                  <span class="row-title">${esc(emoji)} ${esc(title)}</span>
                  <span class="row-sub">ступень S${c.step} · след. окно ${esc(dueDate)}</span>
                </div>
                <div class="row-right">
                  <span style="font-size:12px;font-weight:650">${pct}%</span>
                  <div class="stab-wrap"><div class="stab-track"><div class="stab-fill" style="width:${pct}%"></div></div></div>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="muted">Пока пусто — пройди первую практику, чтобы запустить мягкое закрепление.</div>`;

    const hist = [...trend].reverse();
    $("rhythm-history").innerHTML = hist.length
      ? hist
          .slice(0, 10)
          .map((e) => {
            const pillCls = e.delta > 0 ? "good" : e.delta === 0 ? "flat" : "up";
            const pillTxt = e.delta > 0 ? `−${e.delta}` : e.delta === 0 ? "0" : `+${Math.abs(e.delta)}`;
            const dateStr = e.ts ? e.ts.slice(0, 10) : "";
            const kindTag = e.kind === "program" ? "программа" : `${e.duration_min} мин`;
            return `
              <div class="list-row">
                <div class="row-main">
                  <span class="row-title">${esc(e.emoji)} ${esc(e.title)}</span>
                  <span class="row-sub">${esc(kindTag)} · ${esc(dateStr)} · шум ${e.before} → ${e.after}</span>
                </div>
                <div class="row-right">
                  <span class="delta-pill ${pillCls}">${pillTxt}</span>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div class="muted">Завершённых замеров состояния пока нет.</div>`;

    if ($("rhythm-storage-note") && state.client) {
      $("rhythm-storage-note").textContent = `Хранение: ${state.client.storageLabel}`;
    }
  }

  async function refreshUserState() {
    try {
      if (!state.client) return;
      const st = await state.client.getState();
      if (!st) return;
      state.userState = st;

      if (st.prefs) {
        if (window.DSMAudioCue && typeof window.DSMAudioCue.setEnabled === "function") {
          window.DSMAudioCue.setEnabled(st.prefs.sound_enabled !== false);
        }
        if (typeof st.prefs.last_noise_level === "number") {
          state.selectedMood = st.prefs.last_noise_level;
        }
      }
      syncSoundUI();
      syncUnlockUI();

      // Resume active program banner
      const act = state.userState.active_program_run;
      const rBanner = $("resume-banner");
      if (act) {
        const pr = findProgram(act.program_id);
        const title = pr ? `${pr.emoji} ${pr.title}` : act.title || act.program_id;
        rBanner.innerHTML = `
          <span>▶ Незавершено: <strong>${esc(title)}</strong> (шаг ${act.current_step_idx + 1}/${act.total_steps})</span>
          <button id="btn-resume-prog" class="btn primary small" type="button">Продолжить</button>
        `;
        rBanner.classList.remove("hidden");
        $("btn-resume-prog").addEventListener("click", () => {
          if (!pr) return;
          track("resume_program_click", { program_id: pr.id, step_idx: act.current_step_idx });
          state.runMode = "program";
          state.activeProgram = pr;
          state.activeProgramRunId = act.run_id;
          state.currentNoiseBefore = Number(act.noise_before ?? 5);
          state.programStepIdx = Math.min(act.current_step_idx, pr.steps.length - 1);
          launchProgramStep(state.programStepIdx);
        });
      } else {
        rBanner.classList.add("hidden");
      }

      // Clickable Ebbinghaus due nudge banner
      const due = state.userState.due_triggers || [];
      const dBanner = $("due-banner");
      if (due.length > 0) {
        const top = due[0];
        const humanName = `${top.emoji || "🫧"} ${top.title || top.practice_id}`;
        const copyText = top.gentle_recovery
          ? `🌿 Мягкий возврат: пауза — это нормально. 60 сек дыхания без давления.`
          : `🔁 Окно закрепления (ступень S${top.step}): ${humanName}`;
        dBanner.innerHTML = `
          <span class="due-copy">${esc(copyText)}</span>
          <button id="btn-due-go" class="btn primary small" type="button">▶ Освежить</button>
        `;
        dBanner.classList.remove("hidden");
        $("btn-due-go").addEventListener("click", () => {
          track("due_banner_click", { target: top.suggested_micro_id || top.entity_id, gentle: Boolean(top.gentle_recovery) });
          if (top.gentle_recovery) {
            const p = findPractice(top.suggested_micro_id || "fiziologicheskij-vzdoh");
            if (p) launchSinglePractice(p, state.selectedMood);
          } else if (top.kind === "program") {
            openProgramDetail(top.entity_id);
          } else {
            openPracticeDetail(top.entity_id || top.practice_id);
          }
        });
      } else {
        dBanner.classList.add("hidden");
      }
    } catch (_) {}
  }

  // -------- TIMER ENGINE (Wall-Clock + WakeLock + Smart Auto-Start for Simple Practices) --------

  function renderGuidanceCard(el, practice, phaseObj, compact) {
    if (!el) return;
    const g = practice && practice.guidance;
    const eyeTxt = (phaseObj && phaseObj.eye_cue) || (g && g.eyes);
    const attnTxt = (phaseObj && phaseObj.attn_cue) || (g && g.attention);
    const bodyTxt = !compact && g && g.body;
    const lostTxt = !compact && g && g.if_lost;

    if (!eyeTxt && !attnTxt && !bodyTxt && !lostTxt) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    const rows = [];
    if (eyeTxt) rows.push(`<div class="g-row"><span class="g-key eye">👁 Глаза</span><span class="g-val">${esc(eyeTxt)}</span></div>`);
    if (attnTxt) rows.push(`<div class="g-row"><span class="g-key attn">✦ Внимание</span><span class="g-val">${esc(attnTxt)}</span></div>`);
    if (bodyTxt) rows.push(`<div class="g-row"><span class="g-key body">🫁 Тело</span><span class="g-val">${esc(bodyTxt)}</span></div>`);
    if (lostTxt) rows.push(`<div class="g-row"><span class="g-key lost">🌿 Если сбился</span><span class="g-val">${esc(lostTxt)}</span></div>`);
    el.innerHTML = rows.join("");
    el.classList.remove("hidden");
  }

  function updateFocusReturnBar() {
    const bar = $("focus-return-bar");
    const cnt = $("focus-return-count");
    if (!bar || !cnt) return;
    const p = state.activePractice;
    const show = Boolean(
      p && (p.interactive_kind === "focus_return" || ["внимание", "зрение", "слух"].includes(p.category) || p.layer === "deep")
    );
    bar.classList.toggle("hidden", !show);
    cnt.textContent = String(state.focusReturns);
  }

  function stepIllustrationIcon(text) {
    const t = String(text || "").toLowerCase();
    if (/кулак|ребр|ладон|пальц|рук|кист|кольц|хлоп|стуч/.test(t)) return "✋";
    if (/вдох|выдох|дыхан|дыш|нос|живот|лёгк|легк|пауза/.test(t)) return "🫧";
    if (/глаз|взгляд|смотр|точк|окн|комнат|пространств|объём|объем|горизонт|свет|цвет/.test(t)) return "👁️";
    if (/звук|слух|слыш|слуш|тишин|шум/.test(t)) return "👂";
    if (/сядь|сид|спин|стул|поз|встан|ляг/.test(t)) return "🪑";
    if (/стоп|пол|плеч|челюст|тел|мышц|напряг|отпуст|вес|опор|встрях/.test(t)) return "🧍";
    if (/секунд|минут|счёт|счет|цифр|раз|ритм|темп/.test(t)) return "⏱️";
    if (/повтор|цикл|продолж|вернись|снова|шаг назад/.test(t)) return "🔁";
    if (/мысл|вниман|отметь|замет|наблюд|осозна|ярлык|ощущ/.test(t)) return "🎯";
    return "🌿";
  }

  function renderStepCards(steps) {
    return (steps || [])
      .map((raw, i) => {
        const clean = String(raw || "").trim();
        const icon = stepIllustrationIcon(clean);
        const semiIdx = clean.indexOf("; ");
        let bodyHtml = `<div class="step-card-text">${esc(clean)}</div>`;
        if (semiIdx > 18 && clean.length - semiIdx > 18) {
          const mainPart = clean.slice(0, semiIdx).trim();
          const subPart = clean.slice(semiIdx + 2).trim();
          const capSub = subPart.charAt(0).toUpperCase() + subPart.slice(1);
          bodyHtml = `<div class="step-card-text">${esc(mainPart)}.</div><div class="step-card-sub">${esc(capSub)}</div>`;
        }
        return `
          <div class="step-card">
            <div class="step-card-icon" aria-hidden="true">${icon}</div>
            <div class="step-card-body">
              <div class="step-card-num">Шаг ${i + 1}</div>
              ${bodyHtml}
            </div>
          </div>
        `;
      })
      .join("");
  }

  function setPhaseStatusPill(kind, label) {
    const pill = $("timer-status-pill");
    if (!pill) return;
    pill.className = `phase-status-pill ${kind}`;
    pill.textContent = label;
  }

  function launchProgramStep(stepIdx) {
    const pr = state.activeProgram;
    if (!pr || stepIdx >= pr.steps.length) {
      openFinishScreen(true);
      return;
    }
    state.programStepIdx = stepIdx;
    const step = pr.steps[stepIdx];
    const pct = Math.round(((stepIdx + 1) / pr.steps.length) * 100);
    $("timer-prog-header").classList.remove("hidden");
    $("timer-prog-bar").style.width = `${pct}%`;
    $("timer-prog-label").textContent = `${pr.emoji} ${pr.title} · Шаг ${stepIdx + 1} из ${pr.steps.length}`;
    $("btn-skip-step").classList.remove("hidden");
    $("btn-stop-early").classList.remove("full-span");
    $("btn-stop-early").textContent = "Завершить программу";

    if (step.kind === "practice" && step.practice_id) {
      const p = findPractice(step.practice_id);
      if (p) {
        state.activePractice = p;
        state.activePhases = p.phases;
      }
    } else {
      state.activePractice = { emoji: step.emoji, title: step.title, id: null };
      state.activePhases = [
        {
          title: step.title,
          duration_sec: step.duration_sec,
          steps: [step.note || step.title, "Просто побудь в этом шаге до сигнала таймера."],
        },
      ];
    }
    state.elapsedSec = 0;
    state.focusReturns = 0;
    const helpTip = $("sound-help-tip");
    if (helpTip) helpTip.classList.add("hidden");
    showView("view-timer", false);
    if (visualizer) visualizer.mount(state.activePractice, { startPaused: true, phaseIdx: 0, phaseObj: state.activePhases[0] });
    preparePhase(0);
  }

  function preparePhase(idx) {
    const phases = state.activePhases;
    if (idx >= phases.length) {
      onPracticeOrStepComplete(false);
      return;
    }
    clearInterval(state.timerHandle);
    state.timerHandle = null;
    state.phaseIdx = idx;
    const ph = phases[idx];
    state.remainingSec = ph.duration_sec;
    state.paused = true;
    if (visualizer) {
      visualizer.setPhase(idx, ph);
      visualizer.setPaused(true);
    }

    $("timer-practice-title").textContent = `${state.activePractice.emoji} ${state.activePractice.title}`;
    $("timer-phase-counter").textContent = `Шаг ${idx + 1}/${phases.length}`;
    $("timer-phase-title").textContent = ph.title;
    $("timer-clock").textContent = fmtClock(state.remainingSec);
    setPhaseStatusPill("ready", "Прочитай шаг");

    renderGuidanceCard($("ready-guidance"), state.activePractice, ph, true);
    const cardsHtml = renderStepCards(ph.steps);
    $("ready-steps-list").innerHTML = cardsHtml;
    $("running-steps-list").innerHTML = cardsHtml;
    $("running-guide-details").open = false;

    const isLast = idx + 1 >= phases.length;
    const nextLbl = isLast ? (state.runMode === "program" ? "Завершить шаг →" : "К оценке →") : "След. фаза →";
    $("btn-ready-skip").textContent = nextLbl;
    $("btn-next-phase").textContent = nextLbl;
    $("btn-phase-go").textContent = idx === 0 ? "Готов · Поехали →" : `Готов к фазе ${idx + 1} · Поехали →`;

    // Smart Timer Start: simple breath/body/sound single practices flow straight into live visualizer!
    if (isSimpleAutoFlow(state.activePractice)) {
      beginRunningPhase();
      return;
    }

    $("phase-ready-pane").classList.remove("hidden");
    $("phase-running-pane").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function beginRunningPhase() {
    unlockAudio();
    if (window.DSMAudioCue && typeof window.DSMAudioCue.acquireWakeLock === "function") {
      window.DSMAudioCue.acquireWakeLock();
    }
    state.paused = false;
    state.phaseEndAtMs = Date.now() + state.remainingSec * 1000;
    state.lastTickAtMs = Date.now();

    $("phase-ready-pane").classList.add("hidden");
    $("phase-running-pane").classList.remove("hidden");
    $("running-guide-details").open = false;
    $("btn-pause").textContent = "⏸ Пауза";
    setPhaseStatusPill("running", "Идёт таймер");
    updateFocusReturnBar();
    syncSoundUI();

    const curPhase = state.activePhases[state.phaseIdx] || null;
    track("practice_go", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      category: state.activePractice ? state.activePractice.category || "program_step" : "unknown",
      phase_idx: state.phaseIdx,
      run_mode: state.runMode,
    });

    if (visualizer) {
      if (!visualizer.running) {
        visualizer.mount(state.activePractice, { startPaused: false, phaseIdx: state.phaseIdx, phaseObj: curPhase });
      } else {
        visualizer.setPhase(state.phaseIdx, curPhase);
        visualizer.startFromZero();
      }
    }

    clearInterval(state.timerHandle);
    // Wall-clock 250ms loop: zero drift even if phone sleeps or tab throttles
    state.timerHandle = setInterval(() => {
      if (state.paused) return;
      const now = Date.now();
      const dtSec = Math.max(0, (now - state.lastTickAtMs) / 1000);
      state.lastTickAtMs = now;
      state.elapsedSec += dtSec;

      const rem = Math.max(0, Math.ceil((state.phaseEndAtMs - now) / 1000));
      if (rem !== state.remainingSec) {
        state.remainingSec = rem;
        $("timer-clock").textContent = fmtClock(rem);
      }
      if (rem <= 0) {
        clearInterval(state.timerHandle);
        state.timerHandle = null;
        if (visualizer) visualizer.playPhaseDoneChime();
        else if (window.DSMAudioCue) window.DSMAudioCue.playPhaseDoneChime();
        preparePhase(state.phaseIdx + 1);
      }
    }, 250);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onPracticeOrStepComplete(skipped) {
    stopActiveTimer();
    if (state.runMode === "single") {
      openFinishScreen(!skipped);
      return;
    }
    let data = { done_all_steps: state.programStepIdx + 1 >= state.activeProgram.steps.length };
    try {
      data = await state.client.advanceProgramStep({
        run_id: state.activeProgramRunId,
        step_idx: state.programStepIdx,
        duration_sec: Math.max(10, Math.round(state.elapsedSec)),
        skipped,
      });
    } catch (_) {}
    track("program_step_done", {
      program_id: state.activeProgram.id,
      step_idx: state.programStepIdx,
      skipped: Boolean(skipped),
    });
    if (data.done_all_steps || state.programStepIdx + 1 >= state.activeProgram.steps.length) {
      openFinishScreen(true);
      return;
    }
    const nextIdx = state.programStepIdx + 1;
    const nextStep = state.activeProgram.steps[nextIdx];
    const pct = Math.round(((state.programStepIdx + 1) / state.activeProgram.steps.length) * 100);
    $("tr-bar").style.width = `${pct}%`;
    $("tr-counter").textContent = `Выполнено ${state.programStepIdx + 1} из ${state.activeProgram.steps.length} шагов`;
    $("tr-heading").textContent = skipped ? "Шаг пропущен (без вины)" : "Шаг выполнен ✓";
    $("tr-next-info").textContent = `Далее: ${nextStep.emoji} ${nextStep.title} (${Math.max(1, Math.round(nextStep.duration_sec / 60))} мин)`;
    showView("view-program-transition", false);
  }

  function openFinishScreen(completed) {
    stopActiveTimer();
    state.completed = completed;
    state.frictionTag = completed ? "none" : "stopped_early";
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.tag === state.frictionTag));

    const suggestedAfter = Math.max(0, state.currentNoiseBefore - 2);
    $("noise-after").value = String(suggestedAfter);
    updateNoiseBadge(suggestedAfter, "after-val", "after-badge");
    updateFinishDeltaPreview();

    if (state.runMode === "program" && state.activeProgram) {
      $("finish-title").textContent = `Финиш: ${state.activeProgram.emoji} ${state.activeProgram.title}`;
      const obs = state.activeProgram.observations || [];
      if (obs.length) {
        $("finish-obs").innerHTML = obs.map((q) => `<li>${esc(q)}</li>`).join("");
        $("finish-obs-wrap").classList.remove("hidden");
      } else {
        $("finish-obs-wrap").classList.add("hidden");
      }
    } else {
      $("finish-title").textContent = state.activePractice
        ? `После: ${state.activePractice.emoji} ${state.activePractice.title}`
        : "Как состояние после?";
      $("finish-obs-wrap").classList.add("hidden");
    }
    showView("view-finish", false);
  }

  async function startAndLaunchProgram(pr, noiseBeforeVal) {
    if (!pr) return;
    unlockAudio();
    state.runMode = "program";
    state.activeProgram = pr;
    state.currentNoiseBefore = Number(noiseBeforeVal);
    try {
      const data = await state.client.startProgram({
        program_id: pr.id,
        noise_before: state.currentNoiseBefore,
        trigger_source: triggerSource,
      });
      state.activeProgramRunId = data.run_id;
      track("program_start", {
        program_id: pr.id,
        title: pr.title,
        noise_before: state.currentNoiseBefore,
      });
      trackParams({ program_started: { [pr.title]: 1 } });
      launchProgramStep(0);
    } catch (err) {
      alert(`Ошибка старта: ${err.message}`);
    }
  }

  function launchSinglePractice(practice, overrideNoiseBefore) {
    if (!practice) return;
    unlockAudio();
    state.runMode = "single";
    state.activeProgram = null;
    state.activePractice = practice;
    state.activePhases = practice.phases;
    state.elapsedSec = 0;
    state.focusReturns = 0;
    state.currentNoiseBefore =
      overrideNoiseBefore !== undefined ? Number(overrideNoiseBefore) : Number($("noise-before").value);
    state.sessionKey = `wa:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    track("practice_start", {
      practice_id: practice.id,
      title: practice.title,
      category: practice.category,
      noise_before: state.currentNoiseBefore,
    });
    trackParams({ practice_started: { [practice.title]: 1 } });
    $("timer-prog-header").classList.add("hidden");
    $("btn-skip-step").classList.add("hidden");
    $("btn-stop-early").classList.add("full-span");
    $("btn-stop-early").textContent = "Завершить и отметить состояние";
    const helpTip = $("sound-help-tip");
    if (helpTip) helpTip.classList.add("hidden");
    showView("view-timer", false);
    if (visualizer) visualizer.mount(state.activePractice, { startPaused: true, phaseIdx: 0, phaseObj: state.activePhases[0] });
    preparePhase(0);
  }

  function updateDoneContinueButton() {
    const btn = $("btn-done-continue");
    if (!btn) return;
    state.doneContinueTarget = null;
    if (state.runMode === "single" && state.activePractice && Number(state.activePractice.duration_min || 5) <= 3) {
      const targetId = getUnlockLevel() >= 2 ? "panorama" : "nablyudenie-dyhaniya";
      const nextP = findPractice(targetId);
      if (nextP && nextP.id !== state.activePractice.id) {
        state.doneContinueTarget = nextP;
        btn.textContent = `🌿 Продлить спокойствие · ${nextP.title} (${nextP.duration_min} мин)`;
        btn.classList.remove("hidden");
        return;
      }
    }
    btn.classList.add("hidden");
  }

  // -------- INIT & EVENT WIRING --------

  function normalizeCatalog(cat) {
    const byId = Object.fromEntries((cat.practices || []).map((p) => [p.id, p]));
    (cat.programs || []).forEach((pr) => {
      if (!pr.group) pr.group = String(pr.id || "").startsWith("глубокая-") ? "deep" : "daily";
      if (!Array.isArray(pr.steps) || pr.steps.length === 0) {
        pr.steps = (pr.practice_ids || [])
          .map((pid) => byId[pid])
          .filter(Boolean)
          .map((p) => ({
            kind: "practice",
            practice_id: p.id,
            title: p.title,
            emoji: p.emoji,
            duration_sec: p.total_sec || p.duration_min * 60,
            note: "",
          }));
      }
      if (!Array.isArray(pr.scheme)) pr.scheme = [];
      if (!Array.isArray(pr.observations)) pr.observations = [];
    });
    return cat;
  }

  async function init() {
    try {
      state.client = await window.DSMStorage.createClient({ tg, authHeaders });
      state.catalog = normalizeCatalog(state.client.catalog);

      if (deepLink.unlockAll && typeof state.client.updatePrefs === "function") {
        await state.client.updatePrefs({ sandbox_unlocked: true });
      }
      await refreshUserState();

      if (!qsAtmoOverride && getPrefs().atmosphere_mode && ATMO_CYCLE.includes(getPrefs().atmosphere_mode)) {
        activeAtmoMode = getPrefs().atmosphere_mode;
        try { localStorage.setItem("dsm_atmo_v1", activeAtmoMode); } catch (_) {}
      }
      syncAtmosphereUI();

      // On wide iPad Landscape / Desktop viewports, reveal the 13 routes deck right away
      const progDrawer = $("programs-drawer");
      if (progDrawer && window.innerWidth >= 960) {
        progDrawer.open = true;
      }

      renderNowHero();
      renderProgramGrid();
      renderCategoryChips();
      renderPracticeList(state.selectedCategory);

      track("app_open", {
        env: isInsideTelegram() ? "telegram" : "web",
        mode: state.client.mode,
        ab: abVariant,
        src: triggerSource,
        unlock_level: getUnlockLevel(),
      });

      if (deepLink.programId && findProgram(deepLink.programId)) {
        openProgramDetail(deepLink.programId);
      } else if (deepLink.practiceId && findPractice(deepLink.practiceId)) {
        openPracticeDetail(deepLink.practiceId);
      } else if (deepLink.category && CATEGORY_META[deepLink.category]) {
        state.selectedCategory = deepLink.category;
        setTab("single");
      } else if (deepLink.tab && ["programs", "single", "rhythm"].includes(deepLink.tab)) {
        setTab(deepLink.tab);
      } else {
        setTab("programs");
      }
    } catch (err) {
      $("program-grid").innerHTML = `<div class="banner">Ошибка загрузки каталога: ${esc(err.message)}. Проверь наличие <code>catalog.json</code> или локального сервера.</div>`;
    } finally {
      const veil = $("liquid-boot-veil");
      if (veil) {
        requestAnimationFrame(() => veil.classList.add("dissolved"));
      }
    }
  }

  // Brand, Circadian Atmosphere pill, HUD pill & global Home buttons
  $("brand-home").addEventListener("click", goHome);
  if ($("atmosphere-pill")) {
    $("atmosphere-pill").addEventListener("click", () => cycleAtmosphereMode("topbar_pill"));
  }
  if ($("pref-atmo-btn")) {
    $("pref-atmo-btn").addEventListener("click", () => cycleAtmosphereMode("rhythm_settings"));
  }
  setInterval(() => {
    if (activeAtmoMode === "auto") {
      syncAtmosphereUI();
      if (state.currentViewId === "view-programs") renderNowHero(false);
    }
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activeAtmoMode === "auto") {
      syncAtmosphereUI();
      if (state.currentViewId === "view-programs") renderNowHero(false);
    }
  });
  let _resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (state.activeTab === "rhythm" && state.currentViewId === "view-rhythm") {
        renderRhythm();
      }
    }, 120);
  });
  $("hud-pill").addEventListener("click", () => setTab("rhythm"));
  $("btn-prog-back").addEventListener("click", () => setTab("programs"));
  $("btn-prog-home").addEventListener("click", goHome);
  $("btn-pr-back").addEventListener("click", () => setTab("single"));
  $("btn-pr-home").addEventListener("click", goHome);
  $("btn-timer-home").addEventListener("click", () => {
    track("timer_exit_home", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      run_mode: state.runMode,
    });
    goHome();
  });
  $("btn-tr-home").addEventListener("click", goHome);
  $("btn-finish-cancel").addEventListener("click", goHome);
  $("btn-done-home-top").addEventListener("click", goHome);
  $("btn-back-home").addEventListener("click", goHome);
  $("btn-done-rhythm").addEventListener("click", () => {
    track("done_open_rhythm");
    setTab("rhythm");
  });
  $("btn-done-continue").addEventListener("click", () => {
    if (!state.doneContinueTarget) return;
    track("done_continue_click", { practice_id: state.doneContinueTarget.id });
    launchSinglePractice(state.doneContinueTarget, Number($("noise-after").value || 3));
  });

  // 1-Screen Mood selector & 1-Tap Hero CTA
  document.querySelectorAll(".mood-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedMood = Number(btn.dataset.mood);
      track("now_mood_select", { mood: state.selectedMood });
      if (state.client && typeof state.client.updatePrefs === "function") {
        state.client.updatePrefs({ last_noise_level: state.selectedMood }).catch(() => {});
      }
      renderNowHero(true);
    });
  });

  $("btn-now-start").addEventListener("click", () => {
    const rec = state.currentRecommendation;
    if (!rec || !rec.entity) return;
    track("now_hero_start", {
      kind: rec.kind,
      entity_id: rec.entity.id,
      mood: state.selectedMood,
      ab: abVariant,
    });
    if (rec.kind === "program") {
      startAndLaunchProgram(rec.entity, state.selectedMood);
    } else {
      launchSinglePractice(rec.entity, state.selectedMood);
    }
  });

  // Progressive Sandbox Unlock toggles
  $("btn-now-unlock-toggle").addEventListener("click", () => toggleSandboxMode("now_hero"));
  $("btn-single-unlock-toggle").addEventListener("click", () => toggleSandboxMode("single_header"));
  $("pref-sandbox-btn").addEventListener("click", () => toggleSandboxMode("rhythm_settings"));

  // Sound toggles & iOS audio diagnostic
  async function toggleSound(sourceTag) {
    unlockAudio();
    const cur = window.DSMAudioCue ? window.DSMAudioCue.isEnabled() : true;
    const next = !cur;
    if (window.DSMAudioCue) {
      window.DSMAudioCue.setEnabled(next);
      if (next) window.DSMAudioCue.playCue(432, 0.14, 0.06, true);
    }
    syncSoundUI();
    track("sound_toggle", { enabled: next, source: sourceTag });
    if (state.client && typeof state.client.updatePrefs === "function") {
      await state.client.updatePrefs({ sound_enabled: next });
    }
  }
  $("btn-timer-sound").addEventListener("click", () => toggleSound("timer_header"));
  $("pref-sound-btn").addEventListener("click", () => toggleSound("rhythm_settings"));
  if ($("btn-eyes-closed")) {
    $("btn-eyes-closed").addEventListener("click", () => {
      const next = !state.eyesClosed;
      setEyesClosedMode(next);
      track("eyes_closed_toggle", {
        enabled: next,
        practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      });
    });
  }

  $("btn-sound-help").addEventListener("click", () => {
    if (window.DSMAudioCue) {
      window.DSMAudioCue.setEnabled(true);
      window.DSMAudioCue.playTestTone();
      syncSoundUI();
      const d = window.DSMAudioCue.getDiagnostics();
      const tip = $("sound-help-tip");
      tip.textContent = `Тестовый тон отправлен · Движок: ${d.ctxState} · Канал: ${d.iosTag}. Если на iPhone тихо — добавь громкость медиа кнопками сбоку.`;
      tip.classList.remove("hidden");
      track("sound_help_test", { ctx_state: d.ctxState, ios_tag: d.iosTag });
    }
  });

  // Export & Reset in Rhythm settings
  $("btn-export-json").addEventListener("click", async () => {
    if (!state.client || typeof state.client.exportSnapshot !== "function") return;
    const snap = await state.client.exportSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dsm-practices-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    track("rhythm_export_json");
  });

  $("btn-reset-all").addEventListener("click", async () => {
    if (!window.confirm("Сбросить локальный прогресс, историю и кривую Эббингауза?")) return;
    if (state.client && typeof state.client.resetAll === "function") {
      await state.client.resetAll();
    }
    track("rhythm_reset_all");
    await refreshUserState();
    renderNowHero();
    renderProgramGrid();
    renderCategoryChips();
    renderPracticeList(state.selectedCategory);
    renderRhythm();
  });

  // Dual-mode Unlock / Milestone Modal actions
  $("unlock-modal-backdrop").addEventListener("click", closeUnlockModal);
  $("btn-unlock-close").addEventListener("click", closeUnlockModal);
  $("btn-unlock-primary").addEventListener("click", () => {
    const mode = state.modalMode;
    closeUnlockModal();
    if (mode === "lock") {
      const p = findPractice("fiziologicheskij-vzdoh");
      if (p) launchSinglePractice(p, state.selectedMood);
    }
  });
  $("btn-unlock-all").addEventListener("click", async () => {
    const pending = state.pendingUnlockAction;
    if (state.client && typeof state.client.updatePrefs === "function") {
      await state.client.updatePrefs({ sandbox_unlocked: true });
    }
    track("sandbox_unlock_toggle", { unlocked: true, source: "lock_modal" });
    await refreshUserState();
    renderNowHero();
    renderProgramGrid();
    renderCategoryChips();
    renderPracticeList(state.selectedCategory);
    closeUnlockModal();
    if (typeof pending === "function") pending();
  });

  // Tribute donations
  function openTributeDonation(placement) {
    const inTg = isInsideTelegram();
    const targetUrl = inTg ? TRIBUTE_TG_URL : TRIBUTE_WEB_URL;
    const entityId =
      state.runMode === "program"
        ? state.activeProgram ? state.activeProgram.id : "none"
        : state.activePractice ? state.activePractice.id : "none";
    track("donate_click", {
      provider: "tribute",
      placement,
      env: inTg ? "telegram" : "web",
      screen: state.currentViewId,
      run_mode: state.runMode,
      entity_id: entityId,
      delta_noise: state.lastDeltaNoise,
    });
    trackParams({ donate_clicked: { tribute: 1, [placement]: 1, [inTg ? "telegram" : "web"]: 1 } });
    if (inTg && tg && typeof tg.openTelegramLink === "function") {
      tg.openTelegramLink(targetUrl);
    } else if (inTg && tg && typeof tg.openLink === "function") {
      tg.openLink(targetUrl);
    } else {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  }

  $("btn-support-tribute").addEventListener("click", () => openTributeDonation("done_card"));
  $("btn-footer-tribute").addEventListener("click", () => openTributeDonation("footer"));
  $("btn-unlock-tribute").addEventListener("click", () => openTributeDonation("milestone_modal"));
  if ($("btn-rhythm-tribute")) {
    $("btn-rhythm-tribute").addEventListener("click", () => openTributeDonation("rhythm_card"));
  }

  // Top tabs & subtabs
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  document.querySelectorAll(".subtab").forEach((b) => {
    b.addEventListener("click", () => {
      state.programGroup = b.dataset.pgroup;
      track("program_group_switch", { group: state.programGroup });
      document.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === b));
      renderProgramGrid();
    });
  });

  // Noise / anxiety sliders with live human labels
  $("pd-noise-before").addEventListener("input", (e) => {
    updateNoiseBadge(e.target.value, "pd-before-val", "pd-before-badge");
  });
  $("noise-before").addEventListener("input", (e) => {
    updateNoiseBadge(e.target.value, "before-val", "before-badge");
  });
  $("noise-after").addEventListener("input", (e) => {
    updateNoiseBadge(e.target.value, "after-val", "after-badge");
    updateFinishDeltaPreview();
  });

  // Program start & transition
  $("btn-prog-start").addEventListener("click", () => {
    if (!state.activeProgram) return;
    startAndLaunchProgram(state.activeProgram, Number($("pd-noise-before").value));
  });

  $("btn-tr-continue").addEventListener("click", () => launchProgramStep(state.programStepIdx + 1));
  $("btn-tr-pause-exit").addEventListener("click", () => {
    if (state.activeProgram) {
      track("program_pause_exit", { program_id: state.activeProgram.id, step_idx: state.programStepIdx });
    }
    goHome();
  });

  // Single practice quick cards & launch
  document.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      track("quick_reset_click", { practice_id: btn.dataset.quick });
      openPracticeDetail(btn.dataset.quick);
    });
  });

  $("btn-start-single").addEventListener("click", () => {
    if (state.activePractice) launchSinglePractice(state.activePractice);
  });

  // Ready briefing -> Start timer
  $("btn-phase-go").addEventListener("click", beginRunningPhase);
  $("btn-ready-skip").addEventListener("click", () => {
    track("phase_skip", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      phase_idx: state.phaseIdx,
      stage: "ready",
    });
    preparePhase(state.phaseIdx + 1);
  });
  $("btn-ready-stop").addEventListener("click", () => {
    track("timer_stop_early", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      run_mode: state.runMode,
      stage: "ready",
    });
    openFinishScreen(false);
  });

  // Active timer actions
  $("btn-focus-return").addEventListener("click", () => {
    state.focusReturns += 1;
    $("focus-return-count").textContent = String(state.focusReturns);
    const btn = $("btn-focus-return");
    btn.classList.add("pulsed");
    setTimeout(() => btn.classList.remove("pulsed"), 220);
    if (visualizer) visualizer.pulseReturn();
    track("focus_return_tap", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      phase_idx: state.phaseIdx,
      count: state.focusReturns,
    });
  });

  $("btn-pause").addEventListener("click", () => {
    if (!state.paused) {
      state.remainingSec = Math.max(0, Math.ceil((state.phaseEndAtMs - Date.now()) / 1000));
      state.paused = true;
      if (window.DSMAudioCue) window.DSMAudioCue.releaseWakeLock();
    } else {
      state.paused = false;
      state.phaseEndAtMs = Date.now() + state.remainingSec * 1000;
      state.lastTickAtMs = Date.now();
      if (window.DSMAudioCue) window.DSMAudioCue.acquireWakeLock();
    }
    if (visualizer) visualizer.setPaused(state.paused);
    $("btn-pause").textContent = state.paused ? "▶ Продолжить" : "⏸ Пауза";
    setPhaseStatusPill(state.paused ? "paused" : "running", state.paused ? "На паузе" : "Идёт таймер");
    track("timer_pause_toggle", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      paused: state.paused,
    });
  });

  $("running-guide-details").addEventListener("toggle", (e) => {
    track("timer_guide_toggle", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      open: Boolean(e.target.open),
    });
  });

  $("btn-next-phase").addEventListener("click", () => {
    track("phase_skip", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      phase_idx: state.phaseIdx,
      stage: "running",
    });
    preparePhase(state.phaseIdx + 1);
  });
  $("btn-skip-step").addEventListener("click", () => {
    if (state.activeProgram) {
      track("program_step_skip", { program_id: state.activeProgram.id, step_idx: state.programStepIdx });
    }
    onPracticeOrStepComplete(true);
  });
  $("btn-stop-early").addEventListener("click", () => {
    track("timer_stop_early", {
      practice_id: state.activePractice ? state.activePractice.id || "step" : "unknown",
      run_mode: state.runMode,
      stage: "running",
    });
    openFinishScreen(false);
  });

  // Finish screen
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.frictionTag = chip.dataset.tag;
      track("friction_tag_select", { tag: state.frictionTag });
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    });
  });

  $("btn-save").addEventListener("click", async () => {
    const saveBtn = $("btn-save");
    if (saveBtn) saveBtn.classList.add("is-gliding");
    try {
      if (state.runMode === "program") {
        const data = await state.client.finishProgram({
          run_id: state.activeProgramRunId,
          noise_after: Number($("noise-after").value),
          friction_tag: state.frictionTag,
          completed: state.completed,
        });
        const afterVal = Number($("noise-after").value);
        state.lastDeltaNoise = Number(data.delta_noise || 0);
        const shiftStr = data.delta_noise > 0 ? `−${data.delta_noise} к шуму` : data.delta_noise === 0 ? "без изменений" : `+${Math.abs(data.delta_noise)}`;
        track("program_finish", {
          program_id: state.activeProgram ? state.activeProgram.id : "unknown",
          title: state.activeProgram ? state.activeProgram.title : "unknown",
          steps_done: data.steps_done,
          total_steps: data.total_steps,
          noise_before: state.currentNoiseBefore,
          noise_after: afterVal,
          delta_noise: data.delta_noise,
          friction_tag: state.frictionTag,
          completed: Boolean(state.completed),
        });
        if (state.activeProgram) {
          trackParams({ program_finished: { [state.activeProgram.title]: 1 } });
        }
        $("done-summary").textContent =
          `Программа «${data.program_title}» (${data.steps_done}/${data.total_steps} шагов)\n` +
          `Тревога и шум: ${state.currentNoiseBefore} → ${afterVal} (${shiftStr})\n` +
          `Кривая Эббингауза: ступень S${data.schedule.step} (устойчивость ${Math.round(data.schedule.stability_score * 100)}%)\n` +
          `Следующее окно: ${String(data.schedule.next_due_at || "").slice(0, 10)}\n\n${data.reflection.text}`;
      } else {
        const payload = {
          practice_id: state.activePractice.id,
          noise_before: state.currentNoiseBefore,
          noise_after: Number($("noise-after").value),
          duration_sec: Math.max(10, Math.round(state.elapsedSec)),
          focus_returns: state.focusReturns,
          friction_tag: state.frictionTag,
          trigger_source: triggerSource,
          completed: state.completed,
          idempotency_key: state.sessionKey,
        };
        const data = await state.client.completeSession(payload);
        const s = data.schedule;
        state.lastDeltaNoise = Number(data.delta_noise || 0);
        const shiftStr = data.delta_noise > 0 ? `−${data.delta_noise} к шуму` : data.delta_noise === 0 ? "без изменений" : `+${Math.abs(data.delta_noise)}`;
        track("practice_finish", {
          practice_id: state.activePractice.id,
          title: state.activePractice.title,
          category: state.activePractice.category || "unknown",
          noise_before: payload.noise_before,
          noise_after: payload.noise_after,
          delta_noise: data.delta_noise,
          focus_returns: state.focusReturns,
          friction_tag: state.frictionTag,
          completed: Boolean(state.completed),
        });
        trackParams({ practice_finished: { [state.activePractice.title]: 1 } });
        const focusLine = state.focusReturns > 0 ? `Возвратов внимания: ${state.focusReturns} (каждый возврат — тренировка навыка)\n` : "";
        $("done-summary").textContent =
          `Практика «${state.activePractice.title}»\n` +
          `Тревога и шум: ${payload.noise_before} → ${payload.noise_after} (${shiftStr})\n` +
          focusLine +
          `Кривая Эббингауза: ступень S${s.step} (устойчивость ${Math.round(s.stability_score * 100)}%)\n` +
          `Следующее окно: ${String(s.next_due_at || "").slice(0, 10)}\n\n${data.reflection.text}`;
      }
    } catch (err) {
      $("done-summary").textContent = `Ошибка: ${err.message}`;
    } finally {
      if (saveBtn) saveBtn.classList.remove("is-gliding");
    }

    await refreshUserState();
    renderNowHero();
    renderProgramGrid();
    renderCategoryChips();
    updateDoneContinueButton();
    track("donate_card_shown", { run_mode: state.runMode, delta_noise: state.lastDeltaNoise });
    showView("view-done", false);

    // Trigger Milestone Celebration Modal (with warm Tribute) on 1st, 2nd, 3rd completed session
    const totalEvents = state.userState && state.userState.hud ? Number(state.userState.hud.total_events || 0) : 0;
    const milestoneLvl = Math.min(3, totalEvents);
    const seen = Array.isArray(getPrefs().seen_milestones) ? getPrefs().seen_milestones : [];
    if (!isSandbox() && milestoneLvl >= 1 && !seen.includes(milestoneLvl)) {
      if (state.client && typeof state.client.markMilestoneSeen === "function") {
        await state.client.markMilestoneSeen(milestoneLvl);
        await refreshUserState();
      }
      openMilestoneModal(milestoneLvl);
    }
  });

  init();
})();
