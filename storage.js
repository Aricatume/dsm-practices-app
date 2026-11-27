/* Unified Storage & Domain Engine: Server API when available, or 100% Static (Telegram CloudStorage / localStorage). */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DSMStorage = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const INTERVALS_MINUTES = [20, 1440, 4320, 10080, 20160, 43200];
  const STABILITY_BY_STEP = [0.2, 0.35, 0.55, 0.72, 0.86, 0.96];
  const MICRO_RECOVERY_IDS = ["fiziologicheskij-vzdoh", "dyhanie-4-7-8", "kvadratnoe-dyhanie"];
  const VALID_FRICTION = new Set(["none", "tired", "rushed", "distracted", "stopped_early"]);
  const CHUNK_UTF8_LIMIT = 3800; // Strict UTF-8 bytes (< 4096 B Telegram CloudStorage limit for Cyrillic!)

  function utf8ByteLength(str) {
    const s = String(str || "");
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(s).length;
    }
    try {
      return unescape(encodeURIComponent(s)).length;
    } catch (_) {
      return s.length * 2;
    }
  }

  function splitUtf8Chunks(str, maxBytes = CHUNK_UTF8_LIMIT) {
    const s = String(str || "");
    if (utf8ByteLength(s) <= maxBytes) return [s];
    const chunks = [];
    let cur = "";
    let curBytes = 0;
    for (const ch of s) {
      const b = utf8ByteLength(ch);
      if (curBytes + b > maxBytes && cur.length > 0) {
        chunks.push(cur);
        cur = ch;
        curBytes = b;
      } else {
        cur += ch;
        curBytes += b;
      }
    }
    if (cur.length > 0) chunks.push(cur);
    return chunks;
  }

  function defaultPrefs() {
    return {
      sandbox_unlocked: false,
      sound_enabled: true,
      atmosphere_mode: "auto",
      seen_milestones: [],
      last_noise_level: 5,
      updated_at: 0,
    };
  }

  function computeUnlockLevel(totalEvents, prefs) {
    if (prefs && prefs.sandbox_unlocked) return 3;
    return Math.max(0, Math.min(3, Number(totalEvents || 0)));
  }

  function isFeatureUnlocked(featureKey, unlockLevel) {
    const lvl = Number(unlockLevel || 0);
    if (
      featureKey === "programs" ||
      featureKey === "now" ||
      featureKey === "rhythm" ||
      featureKey === "quick" ||
      featureKey === "дыхание"
    ) {
      return true;
    }
    if (featureKey === "programs_daily" || featureKey === "тело") return lvl >= 1;
    if (featureKey === "зрение" || featureKey === "слух" || featureKey === "нейрогимнастика") return lvl >= 2;
    if (featureKey === "programs_deep" || featureKey === "внимание" || featureKey === "__deep__") return lvl >= 3;
    return true;
  }

  function mergeById(localArr, cloudArr, idKey, tsKey, limit) {
    const map = new Map();
    const ingest = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (!item || !item[idKey]) continue;
        const prev = map.get(item[idKey]);
        if (!prev || String(item[tsKey] || "") >= String(prev[tsKey] || "")) {
          map.set(item[idKey], item);
        }
      }
    };
    ingest(cloudArr);
    ingest(localArr);
    return Array.from(map.values())
      .sort((a, b) => String(a[tsKey] || "").localeCompare(String(b[tsKey] || "")))
      .slice(-limit);
  }

  function mergeCurves(localMap, cloudMap) {
    const out = {};
    const keys = new Set([
      ...Object.keys(cloudMap && typeof cloudMap === "object" ? cloudMap : {}),
      ...Object.keys(localMap && typeof localMap === "object" ? localMap : {}),
    ]);
    for (const k of keys) {
      const a = localMap && localMap[k];
      const b = cloudMap && cloudMap[k];
      if (!a) out[k] = b;
      else if (!b) out[k] = a;
      else {
        const tsA = String(a.last_completed_at || "");
        const tsB = String(b.last_completed_at || "");
        out[k] = tsA >= tsB ? a : b;
      }
    }
    return out;
  }

  function mergePrefs(localP, cloudP) {
    const base = defaultPrefs();
    const lp = localP && typeof localP === "object" ? localP : null;
    const cp = cloudP && typeof cloudP === "object" ? cloudP : null;
    if (!lp && !cp) return base;
    const winner =
      lp && cp ? (Number(lp.updated_at || 0) >= Number(cp.updated_at || 0) ? lp : cp) : lp || cp;
    const seen = Array.from(
      new Set([
        ...(Array.isArray(lp && lp.seen_milestones) ? lp.seen_milestones : []),
        ...(Array.isArray(cp && cp.seen_milestones) ? cp.seen_milestones : []),
      ])
    );
    const validAtmo = new Set(["auto", "morning", "sunset", "night"]);
    const atmoMode = validAtmo.has(winner.atmosphere_mode) ? winner.atmosphere_mode : "auto";
    return {
      ...base,
      ...winner,
      sandbox_unlocked: Boolean(winner.sandbox_unlocked),
      sound_enabled: winner.sound_enabled !== false,
      atmosphere_mode: atmoMode,
      seen_milestones: seen,
      last_noise_level: Math.max(0, Math.min(10, Number(winner.last_noise_level ?? 5))),
      updated_at: Math.max(Number(lp && lp.updated_at || 0), Number(cp && cp.updated_at || 0)),
    };
  }

  function utcNowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  }

  function addMinutesIso(iso, mins) {
    const dt = new Date(iso);
    return new Date(dt.getTime() + mins * 60000).toISOString().replace(/\.\d{3}Z$/, "+00:00");
  }

  function buildReflection(title, delta, frictionTag) {
    if (frictionTag && frictionTag !== "none") {
      return {
        mode: "deterministic_no_llm",
        text: `Замечено сопротивление (${frictionTag}) — это нормальный сигнал, без давления (сабай-сабай). В следующий раз можно зайти на 60 сек.`,
      };
    }
    if (delta >= 2) {
      return {
        mode: "deterministic_no_llm",
        text: `Шум снизился на ${delta} балла после «${title}». Заметь 1 физическое ощущение прямо сейчас (дыхание, плечи, челюсть) — это якорит навык.`,
      };
    }
    if (delta >= 0) {
      return {
        mode: "deterministic_no_llm",
        text: `Спокойное завершение «${title}». Даже ровный фон без скачка тренирует внимание и укрепляет след на кривой Эббингауза.`,
      };
    }
    return {
      mode: "deterministic_no_llm",
      text: `Честная фиксация после «${title}». Повышение шума — ценное наблюдение, а не ошибка; система предложит более мягкий вход.`,
    };
  }

  // -------- Low-level KV backend: Telegram.WebApp.CloudStorage -> localStorage -> in-memory --------

  function createKvAdapter(tgObj, localStore) {
    const tg = tgObj || (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null);
    const cloudAllowed = !!(tg && (typeof tg.isVersionAtLeast !== "function" || tg.isVersionAtLeast("6.9")));
    const hasCloud = !!(
      cloudAllowed &&
      tg.CloudStorage &&
      typeof tg.CloudStorage.getItem === "function" &&
      typeof tg.CloudStorage.setItem === "function"
    );
    const mem = Object.create(null);

    function localRawGet(key) {
      if (localStore) {
        try {
          const v = localStore.getItem(key);
          if (v != null) return v;
        } catch (_) {}
      }
      return mem[key] ?? null;
    }

    function cloudRawGet(key) {
      if (!hasCloud) return Promise.resolve(null);
      return new Promise((resolve) => {
        try {
          tg.CloudStorage.getItem(key, (err, val) => {
            if (err) resolve(null);
            else resolve(val || null);
          });
        } catch (_) {
          resolve(null);
        }
      });
    }

    function rawSet(key, value) {
      const str = String(value);
      if (localStore) {
        try {
          localStore.setItem(key, str);
        } catch (_) {}
      }
      mem[key] = str;
      if (hasCloud) {
        if (utf8ByteLength(str) > 4096) {
          return Promise.resolve(false);
        }
        return new Promise((resolve) => {
          try {
            tg.CloudStorage.setItem(key, str, () => resolve(true));
          } catch (_) {
            resolve(false);
          }
        });
      }
      return Promise.resolve(true);
    }

    function rawRemove(key) {
      if (localStore) {
        try {
          localStore.removeItem(key);
        } catch (_) {}
      }
      delete mem[key];
      if (hasCloud && typeof tg.CloudStorage.removeItem === "function") {
        return new Promise((resolve) => {
          try {
            tg.CloudStorage.removeItem(key, () => resolve(true));
          } catch (_) {
            resolve(false);
          }
        });
      }
      return Promise.resolve(true);
    }

    async function readJsonFrom(getter, key, fallback) {
      const metaRaw = await getter(`${key}__n`);
      if (metaRaw && /^[1-9]\d*$/.test(metaRaw)) {
        const count = Number(metaRaw);
        const parts = [];
        for (let i = 0; i < count; i += 1) {
          const part = await getter(`${key}__${i}`);
          if (part == null) return fallback;
          parts.push(part);
        }
        try {
          return JSON.parse(parts.join(""));
        } catch (_) {
          return fallback;
        }
      }
      const single = await getter(key);
      if (!single) return fallback;
      try {
        return JSON.parse(single);
      } catch (_) {
        return fallback;
      }
    }

    async function getJson(key, fallback, mergeFn) {
      const localVal = await readJsonFrom((k) => Promise.resolve(localRawGet(k)), key, null);
      if (!hasCloud) {
        return localVal !== null ? localVal : fallback;
      }
      const cloudVal = await readJsonFrom(cloudRawGet, key, null);
      if (localVal === null && cloudVal === null) return fallback;
      if (typeof mergeFn === "function") {
        return mergeFn(localVal, cloudVal);
      }
      return localVal !== null ? localVal : cloudVal;
    }

    async function setJson(key, obj) {
      const serialized = JSON.stringify(obj);
      const chunks = splitUtf8Chunks(serialized, CHUNK_UTF8_LIMIT);
      if (chunks.length === 1) {
        await rawSet(`${key}__n`, "0");
        await rawSet(key, chunks[0]);
        return;
      }
      for (let i = 0; i < chunks.length; i += 1) {
        await rawSet(`${key}__${i}`, chunks[i]);
      }
      await rawSet(`${key}__n`, String(chunks.length));
    }

    async function removeJson(key) {
      const metaRaw = localRawGet(`${key}__n`);
      const count = metaRaw && /^[1-9]\d*$/.test(metaRaw) ? Number(metaRaw) : 0;
      await rawRemove(key);
      await rawRemove(`${key}__n`);
      for (let i = 0; i < count; i += 1) {
        await rawRemove(`${key}__${i}`);
      }
    }

    return {
      backendName: hasCloud ? "telegram_cloud" : localStore ? "local_storage" : "memory",
      getJson,
      setJson,
      removeJson,
    };
  }

  // -------- Pure Static Local Engine (mirrors src/bot_logic.py + src/ebbinghaus.py) --------

  class LocalStaticEngine {
    constructor(catalog, kv) {
      this.catalog = catalog;
      this.kv = kv;
      this.practicesById = Object.fromEntries((catalog.practices || []).map((p) => [p.id, p]));
      this.programsById = Object.fromEntries((catalog.programs || []).map((p) => [p.id, p]));
    }

    async _loadStore() {
      const sessions = await this.kv.getJson("dsm_sessions_v1", [], (l, c) =>
        mergeById(l, c, "session_id", "completed_at", 120)
      );
      const runs = await this.kv.getJson("dsm_runs_v1", [], (l, c) =>
        mergeById(l, c, "run_id", "updated_at", 60)
      );
      const curve = await this.kv.getJson("dsm_curve_v1", {}, mergeCurves);
      const idems = await this.kv.getJson("dsm_idems_v1", [], (l, c) =>
        Array.from(new Set([...(Array.isArray(c) ? c : []), ...(Array.isArray(l) ? l : [])])).slice(-200)
      );
      const prefs = await this.kv.getJson("dsm_prefs_v1", defaultPrefs(), mergePrefs);
      return {
        sessions: Array.isArray(sessions) ? sessions : [],
        runs: Array.isArray(runs) ? runs : [],
        curve: curve && typeof curve === "object" ? curve : {},
        idems: Array.isArray(idems) ? idems : [],
        prefs: mergePrefs(prefs, null),
      };
    }

    async _saveStore(store) {
      // Keep bounded sizes for CloudStorage comfort while preserving rich history
      await this.kv.setJson("dsm_sessions_v1", store.sessions.slice(-120));
      await this.kv.setJson("dsm_runs_v1", store.runs.slice(-60));
      await this.kv.setJson("dsm_curve_v1", store.curve);
      await this.kv.setJson("dsm_idems_v1", store.idems.slice(-200));
      if (store.prefs) {
        await this.kv.setJson("dsm_prefs_v1", store.prefs);
      }
    }

    async updatePrefs(patch) {
      const store = await this._loadStore();
      const next = {
        ...defaultPrefs(),
        ...(store.prefs || {}),
        ...(patch || {}),
        updated_at: Date.now(),
      };
      if (Array.isArray(next.seen_milestones)) {
        next.seen_milestones = Array.from(new Set(next.seen_milestones));
      }
      store.prefs = next;
      await this.kv.setJson("dsm_prefs_v1", next);
      return next;
    }

    async markMilestoneSeen(level) {
      const store = await this._loadStore();
      const seen = Array.isArray(store.prefs.seen_milestones) ? store.prefs.seen_milestones.slice() : [];
      if (!seen.includes(level)) seen.push(level);
      return this.updatePrefs({ seen_milestones: seen });
    }

    async exportSnapshot() {
      const store = await this._loadStore();
      return {
        exported_at: utcNowIso(),
        backend: this.kv.backendName,
        prefs: store.prefs,
        sessions: store.sessions,
        runs: store.runs,
        curve: store.curve,
      };
    }

    async resetAll() {
      for (const k of ["dsm_sessions_v1", "dsm_runs_v1", "dsm_curve_v1", "dsm_idems_v1", "dsm_prefs_v1"]) {
        if (typeof this.kv.removeJson === "function") await this.kv.removeJson(k);
      }
      return true;
    }

    _resolveMeta(entityId) {
      const raw = String(entityId || "");
      if (raw.startsWith("program:")) {
        const pid = raw.slice("program:".length);
        const pr = this.programsById[pid];
        return {
          entity_id: pid,
          kind: "program",
          title: pr ? pr.title : pid,
          emoji: pr ? pr.emoji : "🧭",
          category: "программа",
        };
      }
      const p = this.practicesById[raw];
      return {
        entity_id: raw,
        kind: "practice",
        title: p ? p.title : raw,
        emoji: p ? p.emoji : "🫧",
        category: p ? p.category : "практика",
      };
    }

    _recordOnCurve(curveMap, practiceId, frictionTag, completed) {
      const nowIso = utcNowIso();
      const prev = curveMap[practiceId] || {
        practice_id: practiceId,
        step: 0,
        stability_score: 0.2,
        next_due_at: nowIso,
        last_completed_at: null,
        total_completions: 0,
        friction_count: 0,
      };
      let step = Number(prev.step || 0);
      let completions = Number(prev.total_completions || 0);
      let frictions = Number(prev.friction_count || 0);
      if (completed && frictionTag === "none") {
        step = Math.min(step + 1, INTERVALS_MINUTES.length - 1);
        completions += 1;
      } else {
        step = Math.max(0, step - 1);
        frictions += 1;
      }
      const nextDue = addMinutesIso(nowIso, INTERVALS_MINUTES[step]);
      const stability = STABILITY_BY_STEP[step];
      const updated = {
        practice_id: practiceId,
        step,
        stability_score: stability,
        next_due_at: nextDue,
        last_completed_at: nowIso,
        total_completions: completions,
        friction_count: frictions,
      };
      curveMap[practiceId] = updated;
      return updated;
    }

    async getState() {
      const store = await this._loadStore();
      const nowMs = Date.now();

      const allSessions = [...store.sessions].sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
      const recentSessions = allSessions.slice(0, 20).map((s) => {
        const m = this._resolveMeta(s.practice_id);
        return { ...s, title: m.title, emoji: m.emoji, category: m.category };
      });

      const schedule = Object.values(store.curve)
        .sort((a, b) => String(a.next_due_at).localeCompare(String(b.next_due_at)))
        .map((c) => {
          const m = this._resolveMeta(c.practice_id);
          return { ...c, title: m.title, emoji: m.emoji, kind: m.kind, entity_id: m.entity_id, category: m.category };
        });

      const dueTriggers = schedule
        .filter((c) => Date.parse(c.next_due_at) <= nowMs)
        .slice(0, 5)
        .map((c) => {
          const overdueDays = (nowMs - Date.parse(c.next_due_at)) / 86400000;
          const gentle = overdueDays >= 2 || Number(c.friction_count || 0) >= 2;
          return {
            practice_id: c.practice_id,
            title: c.title,
            emoji: c.emoji,
            kind: c.kind,
            entity_id: c.entity_id,
            step: c.step,
            stability_score: c.stability_score,
            next_due_at: c.next_due_at,
            gentle_recovery: gentle,
            suggested_micro_id: gentle ? MICRO_RECOVERY_IDS[0] : c.practice_id,
          };
        });

      const allRuns = [...store.runs].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      const recentRuns = allRuns.slice(0, 10).map((r) => {
        const m = this._resolveMeta(`program:${r.program_id}`);
        return { ...r, title: m.title, emoji: m.emoji };
      });
      const activeRun = recentRuns.find((r) => r.status === "in_progress") || null;

      // Build HUD identically to src/bot_logic.py
      const measured = [];
      let totalSec = 0;
      const calmDates = new Set();

      allSessions.forEach((s) => {
        const m = this._resolveMeta(s.practice_id);
        const dur = Math.max(0, Number(s.duration_sec || 0));
        totalSec += dur;
        const ts = String(s.completed_at || "");
        if (ts.length >= 10) calmDates.add(ts.slice(0, 10));
        measured.push({
          id: s.session_id,
          entity_id: m.entity_id,
          kind: "practice",
          title: m.title,
          emoji: m.emoji,
          category: m.category,
          before: Number(s.noise_before),
          after: Number(s.noise_after),
          delta: Number(s.delta_noise),
          friction_tag: s.friction_tag || "none",
          duration_min: dur > 0 ? Math.max(1, Math.round(dur / 60)) : 1,
          status: s.status || "completed",
          ts,
        });
      });

      let completedPrograms = 0;
      allRuns.forEach((r) => {
        if (r.status === "completed") completedPrograms += 1;
        if (r.noise_after == null) return;
        const m = this._resolveMeta(`program:${r.program_id}`);
        const pr = this.programsById[r.program_id];
        const durMin = pr ? Number(pr.duration_min || 10) : 10;
        totalSec += r.status === "completed" ? durMin * 60 : Math.max(60, Number(r.current_step_idx || 1) * 120);
        const ts = String(r.completed_at || r.updated_at || "");
        if (ts.length >= 10) calmDates.add(ts.slice(0, 10));
        const nb = Number(r.noise_before);
        const na = Number(r.noise_after);
        measured.push({
          id: r.run_id,
          entity_id: m.entity_id,
          kind: "program",
          title: m.title,
          emoji: m.emoji,
          category: "программа",
          before: nb,
          after: na,
          delta: nb - na,
          friction_tag: r.friction_tag || "none",
          duration_min: durMin,
          status: r.status || "completed",
          ts,
        });
      });

      measured.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      const totalEvents = measured.length;
      let avgBefore = 0.0;
      let avgAfter = 0.0;
      let avgDelta = 0.0;
      let reductionPct = 0;
      let improvedPct = 0;
      if (totalEvents > 0) {
        avgBefore = Math.round((measured.reduce((a, e) => a + e.before, 0) / totalEvents) * 10) / 10;
        avgAfter = Math.round((measured.reduce((a, e) => a + e.after, 0) / totalEvents) * 10) / 10;
        avgDelta = Math.round((measured.reduce((a, e) => a + e.delta, 0) / totalEvents) * 10) / 10;
        reductionPct = avgBefore > 0 ? Math.round(((avgBefore - avgAfter) / avgBefore) * 100) : 0;
        improvedPct = Math.round((measured.filter((e) => e.delta > 0).length / totalEvents) * 100);
      }

      const byEntity = Object.create(null);
      const byCat = Object.create(null);
      measured.forEach((e) => {
        const ek = `${e.kind}:${e.entity_id}`;
        if (!byEntity[ek]) {
          byEntity[ek] = {
            entity_id: e.entity_id,
            kind: e.kind,
            title: e.title,
            emoji: e.emoji,
            category: e.category,
            count: 0,
            sum_before: 0,
            sum_after: 0,
            sum_delta: 0,
          };
        }
        byEntity[ek].count += 1;
        byEntity[ek].sum_before += e.before;
        byEntity[ek].sum_after += e.after;
        byEntity[ek].sum_delta += e.delta;

        if (!byCat[e.category]) {
          byCat[e.category] = { category: e.category, count: 0, sum_before: 0, sum_after: 0, sum_delta: 0 };
        }
        byCat[e.category].count += 1;
        byCat[e.category].sum_before += e.before;
        byCat[e.category].sum_after += e.after;
        byCat[e.category].sum_delta += e.delta;
      });

      const topEffective = Object.values(byEntity)
        .map((v) => ({
          entity_id: v.entity_id,
          kind: v.kind,
          title: v.title,
          emoji: v.emoji,
          category: v.category,
          count: v.count,
          avg_before: Math.round((v.sum_before / v.count) * 10) / 10,
          avg_after: Math.round((v.sum_after / v.count) * 10) / 10,
          avg_delta: Math.round((v.sum_delta / v.count) * 10) / 10,
        }))
        .sort((a, b) => b.avg_delta - a.avg_delta || b.count - a.count)
        .slice(0, 5);

      const byCategory = Object.values(byCat)
        .map((v) => ({
          category: v.category,
          count: v.count,
          avg_before: Math.round((v.sum_before / v.count) * 10) / 10,
          avg_after: Math.round((v.sum_after / v.count) * 10) / 10,
          avg_delta: Math.round((v.sum_delta / v.count) * 10) / 10,
        }))
        .sort((a, b) => b.avg_delta - a.avg_delta || b.count - a.count);

      const allDeltas = allSessions.map((s) => Number(s.delta_noise || 0));
      const totalFocusReturns = allSessions.reduce((a, s) => a + Math.max(0, Number(s.focus_returns || 0)), 0);
      const prefs = store.prefs || defaultPrefs();
      const unlockLevel = computeUnlockLevel(totalEvents, prefs);
      return {
        user_id_hash: "local_static",
        storage_mode: this.kv.backendName,
        prefs,
        unlock_level: unlockLevel,
        total_sessions: allDeltas.length,
        avg_delta_noise: allDeltas.length ? Math.round((allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length) * 100) / 100 : 0.0,
        recent_sessions: recentSessions,
        schedule,
        due_triggers: dueTriggers,
        active_program_run: activeRun,
        recent_program_runs: recentRuns,
        hud: {
          completed_practices: allSessions.length,
          completed_programs: completedPrograms,
          total_events: totalEvents,
          total_minutes: totalSec >= 60 ? Math.round(totalSec / 60) : totalSec > 0 ? 1 : 0,
          total_focus_returns: totalFocusReturns,
          calm_days: calmDates.size,
          avg_noise_before: avgBefore,
          avg_noise_after: avgAfter,
          avg_delta_noise: avgDelta,
          reduction_pct: reductionPct,
          improved_pct: improvedPct,
          recent_trend: measured.slice(-12),
          top_effective: topEffective,
          by_category: byCategory,
        },
      };
    }

    async completeSession(payload) {
      const store = await this._loadStore();
      const idem = payload.idempotency_key || `sess:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      if (store.idems.includes(idem)) {
        return { dedup_skip: true, idempotency_key: idem };
      }
      const p = this.practicesById[payload.practice_id];
      if (!p) throw new Error(`Unknown practice_id: ${payload.practice_id}`);
      const nb = Math.max(0, Math.min(10, Number(payload.noise_before)));
      const na = Math.max(0, Math.min(10, Number(payload.noise_after)));
      const delta = nb - na;
      const ftag = VALID_FRICTION.has(payload.friction_tag) ? payload.friction_tag : "none";
      const completed = payload.completed !== false;
      const nowIso = utcNowIso();

      store.idems.push(idem);
      store.sessions.push({
        session_id: `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        practice_id: p.id,
        program_id: payload.program_id || null,
        trigger_source: payload.trigger_source || "manual_menu",
        started_at: nowIso,
        completed_at: nowIso,
        duration_sec: Math.max(0, Number(payload.duration_sec || 60)),
        noise_before: nb,
        noise_after: na,
        delta_noise: delta,
        focus_returns: Math.max(0, Number(payload.focus_returns || 0)),
        friction_tag: ftag,
        status: completed ? "completed" : "stopped_early",
      });
      const sched = this._recordOnCurve(store.curve, p.id, ftag, completed);
      await this._saveStore(store);

      return {
        dedup_skip: false,
        delta_noise: delta,
        schedule: sched,
        reflection: buildReflection(p.title, delta, ftag),
      };
    }

    async startProgram(payload) {
      const pr = this.programsById[payload.program_id];
      if (!pr) throw new Error(`Unknown program_id: ${payload.program_id}`);
      const store = await this._loadStore();
      const nowIso = utcNowIso();
      const runId = `lprun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const nb = Math.max(0, Math.min(10, Number(payload.noise_before)));
      const steps = pr.steps || [];
      const run = {
        run_id: runId,
        program_id: pr.id,
        trigger_source: payload.trigger_source || "manual_menu",
        started_at: nowIso,
        updated_at: nowIso,
        completed_at: null,
        current_step_idx: 0,
        total_steps: steps.length,
        completed_steps: [],
        noise_before: nb,
        noise_after: null,
        delta_noise: null,
        friction_tag: "none",
        status: "in_progress",
      };
      store.runs.push(run);
      await this._saveStore(store);
      return {
        run_id: runId,
        program_id: pr.id,
        current_step_idx: 0,
        total_steps: steps.length,
        completed_steps: [],
        noise_before: nb,
        status: "in_progress",
      };
    }

    async advanceProgramStep(payload) {
      const store = await this._loadStore();
      const run = store.runs.find((r) => r.run_id === payload.run_id);
      if (!run) throw new Error(`Unknown run_id: ${payload.run_id}`);
      const pr = this.programsById[run.program_id];
      const steps = pr ? pr.steps || [] : [];
      const stepIdx = Number(payload.step_idx);
      const completedSteps = Array.isArray(run.completed_steps) ? run.completed_steps : [];
      if (completedSteps.includes(stepIdx)) {
        return {
          dedup_skip: true,
          run_id: run.run_id,
          current_step_idx: run.current_step_idx,
          completed_steps: completedSteps,
          done_all_steps: completedSteps.length >= steps.length,
        };
      }
      completedSteps.push(stepIdx);
      run.completed_steps = completedSteps;
      run.current_step_idx = Math.min(steps.length, stepIdx + 1);
      run.updated_at = utcNowIso();

      const stepMeta = steps[stepIdx];
      if (stepMeta && stepMeta.practice_id && this.practicesById[stepMeta.practice_id] && !payload.skipped) {
        this._recordOnCurve(store.curve, stepMeta.practice_id, "none", true);
      }
      await this._saveStore(store);
      return {
        dedup_skip: false,
        run_id: run.run_id,
        current_step_idx: run.current_step_idx,
        completed_steps: completedSteps,
        total_steps: steps.length,
        done_all_steps: run.current_step_idx >= steps.length,
      };
    }

    async finishProgram(payload) {
      const store = await this._loadStore();
      const run = store.runs.find((r) => r.run_id === payload.run_id);
      if (!run) throw new Error(`Unknown run_id: ${payload.run_id}`);
      if (run.status !== "in_progress") {
        return {
          dedup_skip: true,
          run_id: run.run_id,
          delta_noise: Number(run.delta_noise || 0),
          status: run.status,
        };
      }
      const pr = this.programsById[run.program_id];
      const na = Math.max(0, Math.min(10, Number(payload.noise_after)));
      const nb = Number(run.noise_before);
      const delta = nb - na;
      const ftag = VALID_FRICTION.has(payload.friction_tag) ? payload.friction_tag : "none";
      const completed = payload.completed !== false;
      const nowIso = utcNowIso();

      run.completed_at = nowIso;
      run.updated_at = nowIso;
      run.noise_after = na;
      run.delta_noise = delta;
      run.friction_tag = ftag;
      run.status = completed ? "completed" : "stopped_early";

      const sched = this._recordOnCurve(store.curve, `program:${run.program_id}`, ftag, completed);
      await this._saveStore(store);
      return {
        dedup_skip: false,
        run_id: run.run_id,
        program_title: pr ? pr.title : run.program_id,
        steps_done: (run.completed_steps || []).length,
        total_steps: run.total_steps,
        delta_noise: delta,
        status: run.status,
        schedule: sched,
        reflection: buildReflection(pr ? pr.title : run.program_id, delta, ftag),
      };
    }
  }

  // -------- Dual-mode Client (auto-detects Server API vs Static Serverless) --------

  async function createClient({ tg, authHeaders }) {
    const forceStatic =
      typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.dataset &&
      document.documentElement.dataset.dsmMode === "static";
    let mode = "static";
    let catalog = null;

    // 1. Try Server API first (only when not built as pure static bundle)
    if (!forceStatic) {
      try {
        const healthRes = await fetch("./api/health", { cache: "no-store" });
        if (healthRes.ok) {
          const h = await healthRes.json();
          if (h && h.status === "ok") {
            const catRes = await fetch("./api/catalog", { cache: "no-store" });
            if (catRes.ok) {
              catalog = await catRes.json();
              mode = "server";
            }
          }
        }
      } catch (_) {
        mode = "static";
      }
    }

    // 2. Fallback to pure static catalog.json (GitHub Pages / Cloudflare Pages / Telegram Mini App)
    if (mode === "static") {
      const catRes = await fetch("./catalog.json?v=300", { cache: "no-store" });
      if (!catRes.ok) throw new Error(`Не найден catalog.json (HTTP ${catRes.status})`);
      catalog = await catRes.json();
    }

    const kv = createKvAdapter(tg, typeof window !== "undefined" ? window.localStorage : null);
    const localEngine = new LocalStaticEngine(catalog, kv);

    async function apiPost(path, body) {
      const res = await fetch(path, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    }

    return {
      mode,
      storageLabel:
        mode === "server"
          ? "Личная база на сервере"
          : kv.backendName === "telegram_cloud"
          ? "Облако Telegram (без сервера)"
          : "Локально на устройстве",
      catalog,
      async getState() {
        if (mode === "server") {
          const res = await fetch("./api/state", { headers: authHeaders(), cache: "no-store" });
          if (!res.ok) return null;
          return res.json();
        }
        return localEngine.getState();
      },
      async completeSession(payload) {
        if (mode === "server") return apiPost("./api/session", payload);
        return localEngine.completeSession(payload);
      },
      async startProgram(payload) {
        if (mode === "server") return apiPost("./api/program/start", payload);
        return localEngine.startProgram(payload);
      },
      async advanceProgramStep(payload) {
        if (mode === "server") return apiPost("./api/program/step", payload);
        return localEngine.advanceProgramStep(payload);
      },
      async finishProgram(payload) {
        if (mode === "server") return apiPost("./api/program/finish", payload);
        return localEngine.finishProgram(payload);
      },
      async updatePrefs(patch) {
        return localEngine.updatePrefs(patch);
      },
      async markMilestoneSeen(level) {
        return localEngine.markMilestoneSeen(level);
      },
      async exportSnapshot() {
        return localEngine.exportSnapshot();
      },
      async resetAll() {
        return localEngine.resetAll();
      },
    };
  }

  return {
    createClient,
    createKvAdapter,
    LocalStaticEngine,
    utf8ByteLength,
    splitUtf8Chunks,
    computeUnlockLevel,
    isFeatureUnlocked,
    defaultPrefs,
  };
});
