/* DSM Visual Companion Engine v2.0 — 60fps silky-smooth SVG/DOM visualizers
 * - Frame-rate independent exponential smoothing (lerpExp) + gentle trails
 * - 2-marker phase-synchronized engine (👁 Взгляд vs ✦ Внимание) for Cross & Attention Rotation
 * - Zero .innerHTML writes inside requestAnimationFrame
 * - Pulse feedback for gentle «Поймал уход · Вернул фокус» taps
 */
(() => {
  // ---------------- Subtle WebAudio Soft Chime / Tactile Pulse (delegates to DSMAudioCue iOS engine) ----------------
  let audioCtx = null;
  function playSoftCue(freq = 432, dur = 0.1, gainPeak = 0.045) {
    if (window.DSMAudioCue && typeof window.DSMAudioCue.playCue === "function") {
      window.DSMAudioCue.playCue(freq, dur, gainPeak);
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state !== "running") audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(gainPeak, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur + 0.025);
    } catch (_) {}
  }

  function triggerHaptic(kind = "light") {
    try {
      const hf = window.Telegram?.WebApp?.HapticFeedback;
      if (hf && hf.impactOccurred) hf.impactOccurred(kind);
    } catch (_) {}
  }

  function lerpExp(cur, target, speed, dt) {
    const k = 1 - Math.exp(-speed * Math.min(0.1, Math.max(0.001, dt)));
    return cur + (target - cur) * k;
  }

  function easeInOutSine(u) {
    const c = Math.max(0, Math.min(1, u));
    return 0.5 - 0.5 * Math.cos(Math.PI * c);
  }

  const EYE_COLOR = "#3778ff";
  const ATTN_COLOR = "#f59e0b";
  const BREATH_COLOR = "#0ea57a";

  // ---------------- Exact Practice -> Visual Spec Registry (All 60 practices) ----------------
  const SPECS = {
    // 01-дыхание (13)
    "fiziologicheskij-vzdoh": {
      engine: "breath",
      shape: "orb",
      color: "#5ba4f5",
      cycles: [
        { label: "Вдох носом", sec: 2.2, target: 0.72, tone: 396 },
        { label: "Мягкий дозахват", sec: 1.1, target: 1.0, tone: 480 },
        { label: "Долгий выдох ртом", sec: 6.5, target: 0.22, tone: 285 },
        { label: "Спокойная пауза", sec: 2.0, target: 0.22, tone: 0 },
      ],
    },
    "kvadratnoe-dyhanie": {
      engine: "breath",
      shape: "square",
      color: "#6db8f8",
      cycles: [
        { label: "Вдох", sec: 4.0, target: 1.0, tone: 432 },
        { label: "Мягкая пауза", sec: 4.0, target: 1.0, tone: 480 },
        { label: "Выдох", sec: 4.0, target: 0.25, tone: 324 },
        { label: "Тихая пауза", sec: 4.0, target: 0.25, tone: 384 },
      ],
    },
    "dyhanie-4-7-8": {
      engine: "breath",
      shape: "orb",
      color: "#8b9cf6",
      cycles: [
        { label: "Спокойный вдох носом", sec: 4.0, target: 1.0, tone: 432 },
        { label: "Мягкая задержка", sec: 7.0, target: 1.0, tone: 480 },
        { label: "Плавный длинный выдох", sec: 8.0, target: 0.2, tone: 288 },
      ],
    },
    "kogerentnoe-dyhanie": {
      engine: "breath",
      shape: "orb",
      color: "#58c9a0",
      cycles: [
        { label: "Ровный вдох", sec: 5.5, target: 1.0, tone: 432 },
        { label: "Ровный выдох", sec: 5.5, target: 0.24, tone: 324 },
      ],
    },
    "vydoh-dlinnee": {
      engine: "breath",
      shape: "orb",
      color: "#6db8f8",
      cycles: [
        { label: "Спокойный вдох", sec: 4.0, target: 0.95, tone: 432 },
        { label: "Длинный выдох", sec: 8.0, target: 0.2, tone: 294 },
      ],
    },
    "pauza-posle-vydoha": {
      engine: "breath",
      shape: "orb",
      color: "#4ecdc4",
      cycles: [
        { label: "Вдох", sec: 4.0, target: 0.95, tone: 432 },
        { label: "Выдох", sec: 5.0, target: 0.22, tone: 320 },
        { label: "Тихая пауза", sec: 4.0, target: 0.22, tone: 0 },
      ],
    },
    "nadi-shodhana": {
      engine: "breath",
      shape: "nostrils",
      color: "#a599f6",
      cycles: [
        { label: "Левая сторона · Вдох", sec: 4.0, target: 1.0, side: "left", tone: 432 },
        { label: "Мягкая смена", sec: 2.0, target: 1.0, side: "center", tone: 0 },
        { label: "Правая сторона · Выдох", sec: 4.0, target: 0.25, side: "right", tone: 324 },
        { label: "Правая сторона · Вдох", sec: 4.0, target: 1.0, side: "right", tone: 432 },
        { label: "Мягкая смена", sec: 2.0, target: 1.0, side: "center", tone: 0 },
        { label: "Левая сторона · Выдох", sec: 4.0, target: 0.25, side: "left", tone: 324 },
      ],
    },
    "gudenie": {
      engine: "breath",
      shape: "hum",
      color: "#b794f4",
      cycles: [
        { label: "Мягкий вдох", sec: 4.0, target: 0.95, tone: 432 },
        { label: "Плавное гудение «М-м-м…»", sec: 7.5, target: 0.25, vibrate: true, tone: 216 },
      ],
    },
    "dyhanie-volna": {
      engine: "breath",
      shape: "wave",
      color: "#6db8f8",
      cycles: [
        { label: "Волна: живот", sec: 2.0, target: 0.5, tone: 360 },
        { label: "Волна: грудь", sec: 2.0, target: 0.8, tone: 432 },
        { label: "Волна: ключицы", sec: 1.5, target: 1.0, tone: 480 },
        { label: "Плавный спад сверху вниз", sec: 5.5, target: 0.2, tone: 288 },
      ],
    },
    "svyaznoe-dyhanie": {
      engine: "breath",
      shape: "orb",
      color: "#6db8f8",
      cycles: [
        { label: "Связный вдох (без паузы)", sec: 3.5, target: 0.95, tone: 432 },
        { label: "Связный выдох (без паузы)", sec: 3.5, target: 0.28, tone: 340 },
      ],
    },
    "myagkoe-dyhanie": {
      engine: "breath",
      shape: "orb",
      color: "#6ee7c8",
      cycles: [
        { label: "Тихий мягкий вдох", sec: 4.5, target: 0.82, tone: 396 },
        { label: "Лёгкий выдох", sec: 5.5, target: 0.26, tone: 297 },
      ],
    },
    "nablyudenie-dyhaniya": {
      engine: "breath",
      shape: "orb",
      color: "#7dd3fc",
      cycles: [
        { label: "Замечай вдох", sec: 4.5, target: 0.88, tone: 396 },
        { label: "Замечай выдох", sec: 5.0, target: 0.26, tone: 310 },
      ],
    },
    "zevok": {
      engine: "breath",
      shape: "orb",
      color: "#e8c37c",
      cycles: [
        { label: "Потянись и мягко зевни", sec: 4.0, target: 1.0, tone: 432 },
        { label: "Отпусти челюсть на выдохе", sec: 5.0, target: 0.2, tone: 280 },
      ],
    },

    // 06-нейрогимнастика (15)
    "kulak-rebro-ladon": {
      engine: "neuro",
      mode: "gestures",
      defaultPaceSec: 1.5,
      accent: "#e8c37c",
      items: [
        { icon: "✊", title: "КУЛАК", sub: "Пальцы собраны, кисть мягко на столе" },
        { icon: "🤚", title: "РЕБРО", sub: "Ладонь вертикально на ребро мизинца" },
        { icon: "🖐", title: "ЛАДОНЬ", sub: "Пальцы спокойно раскрыты вниз" },
      ],
    },
    "kolca": {
      engine: "neuro",
      mode: "fingers",
      defaultPaceSec: 1.2,
      accent: "#6db8f8",
      sequence: [
        { finger: 1, label: "Большой + Указательный" },
        { finger: 2, label: "Большой + Средний" },
        { finger: 3, label: "Большой + Безымянный" },
        { finger: 4, label: "Большой + Мизинец" },
        { finger: 3, label: "Обратно: Безымянный" },
        { finger: 2, label: "Обратно: Средний" },
      ],
    },
    "palcevaya-gimnastika": {
      engine: "neuro",
      mode: "gestures",
      defaultPaceSec: 1.6,
      accent: "#a599f6",
      items: [
        { icon: "👌", title: "ЛЕВАЯ: ОК · ПРАВАЯ: МИР ✌️", sub: "Чёткая спокойная фиксация" },
        { icon: "✌️", title: "СМЕНА! ЛЕВАЯ: МИР · ПРАВАЯ: ОК 👌", sub: "Переключи обе руки одновременно" },
        { icon: "👍", title: "ЛЕВАЯ: КЛАСС · ПРАВАЯ: ЛАДОНЬ 🖐", sub: "Плечи и челюсть расслаблены" },
        { icon: "🖐", title: "СМЕНА! ЛЕВАЯ: ЛАДОНЬ · ПРАВАЯ: КЛАСС 👍", sub: "Ровный темп без спешки" },
      ],
    },
    "krest-ruk": {
      engine: "neuro",
      mode: "cross",
      defaultPaceSec: 1.8,
      accent: "#58c9a0",
      steps: [
        { active: "LR", label: "Левая рука → Правое ухо · Правая → Нос" },
        { active: "CLAP", label: "Мягкий хлопок · сброс" },
        { active: "RL", label: "Правая рука → Левое ухо · Левая → Нос" },
        { active: "CLAP", label: "Мягкий хлопок · сброс" },
      ],
    },
    "perekryostnye-shagi": {
      engine: "neuro",
      mode: "cross",
      defaultPaceSec: 1.6,
      accent: "#58c9a0",
      steps: [
        { active: "LR", label: "Левый локоть ↔ Правое колено" },
        { active: "RL", label: "Правый локоть ↔ Левое колено" },
      ],
    },
    "ritm-tepping": {
      engine: "neuro",
      mode: "polyrhythm",
      defaultPaceSec: 0.65,
      accent: "#e8c37c",
      leftBeats: [1, 0, 0, 1, 0, 0],
      rightBeats: [1, 0, 1, 0, 1, 0],
    },
    "motornaya-posledovatelnost": {
      engine: "neuro",
      mode: "gestures",
      defaultPaceSec: 1.4,
      accent: "#6db8f8",
      items: [
        { icon: "👏", title: "1 · ХЛОПОК", sub: "Чёткий старт цикла" },
        { icon: "🦵", title: "2 · ПО КОЛЕНЯМ", sub: "Обе ладони синхронно" },
        { icon: "🫰", title: "3 · ЩЕЛЧОК", sub: "Лёгкий акцент пальцами" },
        { icon: "🙌", title: "4 · КРЕСТ НА ГРУДЬ", sub: "Смена верхней руки каждый цикл" },
      ],
    },
    "sustavnaya-tochnost": {
      engine: "neuro",
      mode: "gestures",
      defaultPaceSec: 2.5,
      accent: "#4ecdc4",
      items: [
        { icon: "🔄", title: "ЗАПЯСТЬЯ", sub: "Медленный круг, предплечье неподвижно" },
        { icon: "💪", title: "ЛОКТИ", sub: "Изолированная дуга без рывка" },
        { icon: "🧭", title: "ПЛЕЧИ", sub: "Плавное скольжение лопаток" },
        { icon: "🦶", title: "ГОЛЕНОСТОП", sub: "Точный мягкий круг носком" },
      ],
    },
    "nevedushchaya-ruka": {
      engine: "neuro",
      mode: "gestures",
      defaultPaceSec: 3.0,
      accent: "#e8c37c",
      items: [
        { icon: "✍️", title: "НЕВЕДУЩАЯ РУКА", sub: "Веди плавную линию в воздухе без спешки" },
        { icon: "🔁", title: "СМЕНА НАПРАВЛЕНИЯ", sub: "То же движение в обратную сторону" },
        { icon: "🎯", title: "МИКРОТОЧНОСТЬ", sub: "Замечай каждую мелкую мышцу кисти" },
      ],
    },
    "lenivye-vosmyorki": { engine: "path", mode: "infinity", color: "#6db8f8", label: "Веди взгляд и большой палец по плавной ∞" },
    "dvuruchnoe-risovanie": { engine: "path", mode: "dual", color: "#a599f6", label: "Левая: круг ◯ · Правая: квадрат ⬜ одновременно" },
    "zhonglirovanie": { engine: "path", mode: "juggle", color: "#e8c37c", label: "Каскад: бросок на пике дуги (лево ↔ право)" },
    "balans": { engine: "body", mode: "balance", color: "#58c9a0", label: "Удерживай мягкую ось равновесия" },
    "stabilizaciya-vzglyada": { engine: "eye", mode: "fixation_head", color: "#6db8f8", label: "Взгляд на точке · плавный поворот головы" },
    "vzglyad-za-celyu": { engine: "eye", mode: "smooth", color: "#6db8f8", label: "Плавное слежение глазами без поворота головы" },

    // 02-зрение (9)
    "sakkady": { engine: "eye", mode: "saccade", color: "#6db8f8", defaultPaceSec: 1.2, label: "Спокойный точный переброс взгляда между точками" },
    "otslezhivanie": { engine: "eye", mode: "smooth", color: "#58c9a0", label: "Плавное непрерывное ведение цели без рывков" },
    "krest-razvyazki": { engine: "eye", mode: "cross", color: "#6db8f8", label: "Разделение двух каналов: взгляд и внимание" },
    "blizhnij-dalnij": { engine: "eye", mode: "depth", color: "#6db8f8", defaultPaceSec: 4.0, label: "Плавное переключение фокуса: близко ↔ даль" },
    "panorama": { engine: "eye", mode: "panorama", color: "#4ecdc4", label: "Глаза спокойно в центре · внимание раскрыто к краям" },
    "rasfokus": { engine: "eye", mode: "panorama", color: "#8b9cf6", label: "Мягкий расфокус: центр и края видны одинаково" },
    "trataka": { engine: "eye", mode: "flame", color: "#e8c37c", label: "Мягкая фиксация на тёплом центре света" },
    "vizualnaya-fiksaciya": { engine: "eye", mode: "fixation", color: "#6db8f8", label: "Спокойная точка фиксации без напряжения лба" },
    "utrennij-svet": { engine: "eye", mode: "sun", color: "#f3d37a", label: "Естественный дневной свет (лицом к небу, не на солнце)" },

    // 03-слух (4)
    "tri-kruga-zvuka": { engine: "sound", mode: "three_rings", color: "#6db8f8" },
    "lokalizaciya-zvuka": { engine: "sound", mode: "radar", color: "#a599f6" },
    "uderzhanie-zvuka": { engine: "sound", mode: "hold", color: "#58c9a0" },
    "pole-zvuka": { engine: "sound", mode: "field", color: "#6db8f8" },

    // 04-тело (7)
    "skanirovanie-tela": { engine: "body", mode: "scan", color: "#6db8f8", label: "Луч внимания плавно проходит по зонам тела" },
    "glubokij-otdyh": { engine: "body", mode: "scan", color: "#8b9cf6", label: "NSDR: мягко отпускай вес каждой зоны в опору" },
    "progressivnaya-relaksaciya": { engine: "body", mode: "tense_release", color: "#e8c37c", label: "5с мягкое напряжение → 10с полное отпускание" },
    "tryaska": { engine: "body", mode: "shake", color: "#f0a672", label: "Свободная тряска: мягко сбрось мышечный зажим" },
    "zazemlenie-stopy": { engine: "body", mode: "feet", color: "#58c9a0", label: "Опора через стопы: почувствуй спокойный вес в полу" },
    "medlennoe-dvizhenie": { engine: "body", mode: "slow", color: "#4ecdc4", label: "Сверхмедленное движение без единого рывка" },
    "holod": { engine: "body", mode: "cold", color: "#6db8f8", label: "Прохладная вода на лицо или запястья · ровный выдох" },

    // 05-внимание (8)
    "5-4-3-2-1": { engine: "attention", mode: "ground54321", color: "#58c9a0" },
    "serijnye-semyorki": { engine: "attention", mode: "sevens", color: "#6db8f8" },
    "vrashchenie-vnimaniya": { engine: "attention", mode: "orbit_attn", color: "#e8c37c" },
    "dekoncentraciya-vnimaniya": { engine: "attention", mode: "deconc", color: "#4ecdc4" },
    "drop-anchor": { engine: "attention", mode: "ace", color: "#6db8f8" },
    "nazyvanie-emocij": { engine: "attention", mode: "labels", color: "#d89cf6", words: ["Напряжение", "Усталость", "Тревога", "Интерес", "Покой", "Ясность"] },
    "kategorii": { engine: "attention", mode: "labels", color: "#e8c37c", words: ["Округлое", "Тёплое", "Дерево", "Свет", "Тень", "Движение"] },
    "dvojnaya-zadacha": { engine: "attention", mode: "dual_task", color: "#8b9cf6" },

    // 00-глубокий-слой (4)
    "kasina-sveta": { engine: "deep", mode: "light", color: "#f3d37a", label: "Спокойное световое пятно в центре поля" },
    "kasina-prostranstva": { engine: "deep", mode: "space", color: "#6db8f8", label: "Открытый объём пространства без границ" },
    "sozercanie-neba": { engine: "deep", mode: "sky", color: "#7cc2f9", label: "Открытое небо · мысли проходят как облака" },
    "tishina-bez-obekta": { engine: "deep", mode: "silence", color: "#9db0c6", label: "Тишина без опоры и лишнего усилия" },
  };

  // ---------------- Main Visualizer Controller ----------------
  class PracticeVisualizer {
    constructor(containerEl) {
      this.el = containerEl;
      this.raf = null;
      this.running = false;
      this.paused = false;
      this.soundOn = false;
      this.eyesClosedGuide = false;
      this.paceMult = 1.0;
      this.spec = null;
      this.phaseIdx = 0;
      this.phaseObj = null;
      this.startTs = 0;
      this.lastNow = 0;
      this.pauseAccum = 0;
      this.pauseStart = 0;
      this.lastCueIdx = -1;
      this.sevensVal = 100;
      this.returnPulse = 0; // 0..1 decaying ripple on focus-return tap
      this._state = {};
      this._chips = [];
      this._polyL = [];
      this._polyR = [];
      this._lastDomKey = -1;
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      if (window.DSMAudioCue && typeof window.DSMAudioCue.stopBreathGlide === "function") {
        window.DSMAudioCue.stopBreathGlide();
      }
    }

    setEyesClosedGuide(flag) {
      this.eyesClosedGuide = Boolean(flag);
      if (this.eyesClosedGuide) {
        this.soundOn = true;
        const sb = this.el && this.el.querySelector("#viz-sound-btn");
        if (sb) {
          sb.textContent = "🔔 Такт: вкл";
          sb.classList.add("active");
        }
      } else if (window.DSMAudioCue && typeof window.DSMAudioCue.stopBreathGlide === "function") {
        window.DSMAudioCue.stopBreathGlide();
      }
    }

    setPaused(p) {
      if (this.paused === p) return;
      this.paused = p;
      if (p) {
        this.pauseStart = performance.now();
        if (window.DSMAudioCue && typeof window.DSMAudioCue.stopBreathGlide === "function") {
          window.DSMAudioCue.stopBreathGlide();
        }
      } else {
        this.pauseAccum += performance.now() - this.pauseStart;
      }
    }

    startFromZero() {
      this.paused = false;
      this.startTs = performance.now();
      this.lastNow = this.startTs;
      this.pauseAccum = 0;
      this.pauseStart = 0;
      this.lastCueIdx = -1;
      this._lastDomKey = -1;
    }

    setPhase(phaseIdx, phaseObj) {
      this.phaseIdx = Number(phaseIdx || 0);
      this.phaseObj = phaseObj || null;
      this._updateChannelLegend();
    }

    setPaceMult(mult) {
      const m = Math.max(0.6, Math.min(2.0, Number(mult || 1.0)));
      this.paceMult = m;
      const lbl = this.el && this.el.querySelector("#viz-pace-val");
      if (lbl && this.spec && this.spec.defaultPaceSec) {
        lbl.textContent = `${(this.spec.defaultPaceSec / m).toFixed(1)}с`;
      }
    }

    pulseReturn() {
      this.returnPulse = 1.0;
      triggerHaptic("light");
      if (this.soundOn) playSoftCue(528, 0.09, 0.035);
    }

    playPhaseDoneChime() {
      triggerHaptic("medium");
      if (this.soundOn) {
        playSoftCue(432, 0.14, 0.045);
        setTimeout(() => playSoftCue(528, 0.18, 0.038), 140);
      }
    }

    getElapsedSec(now) {
      const eff = this.paused ? this.pauseStart : now;
      return Math.max(0, (eff - this.startTs - this.pauseAccum) / 1000);
    }

    mount(practice, opts = {}) {
      this.stop();
      const pid = practice && practice.id;
      this.spec = (pid && SPECS[pid]) || this._fallbackSpec(practice);
      this.running = true;
      this.paused = Boolean(opts.startPaused);
      this.paceMult = 1.0;
      this.phaseIdx = Number(opts.phaseIdx || 0);
      this.phaseObj = opts.phaseObj || (practice && practice.phases && practice.phases[this.phaseIdx]) || null;
      this.startTs = performance.now();
      this.lastNow = this.startTs;
      this.pauseAccum = 0;
      this.pauseStart = this.startTs;
      this.lastCueIdx = -1;
      this.sevensVal = 100;
      this.returnPulse = 0;
      this._state = {
        ex: 130, ey: 92, ax: 130, ay: 92, r: 9,
        eyeTrail: [[130, 92], [130, 92], [130, 92]],
        attnTrail: [[130, 92], [130, 92], [130, 92]],
        fRingX: 68, fRingY: 42,
        scanY: 150,
        defocusR: 26,
      };
      this._chips = [];
      this._polyL = [];
      this._polyR = [];
      this._lastDomKey = -1;

      const supportsSpeed =
        Boolean(this.spec.defaultPaceSec) ||
        this.spec.engine === "breath" ||
        this.spec.engine === "path" ||
        (this.spec.engine === "eye" && ["cross", "smooth", "saccade", "depth"].includes(this.spec.mode));

      this.el.innerHTML = `
        <div class="viz-channel-legend hidden" id="viz-channel-legend"></div>
        <div class="viz-stage" id="viz-stage"></div>
        <div class="viz-controls">
          <button type="button" class="viz-pill" id="viz-sound-btn">${this.soundOn ? "🔔 Такт: вкл" : "🔕 Такт: выкл"}</button>
          ${
            supportsSpeed
              ? `<div class="viz-pace" role="group" aria-label="Темп визуала">
                  <button type="button" class="viz-pill pace-opt" data-pace="0.75">0.75×</button>
                  <button type="button" class="viz-pill pace-opt active" data-pace="1">1.0×</button>
                  <button type="button" class="viz-pill pace-opt" data-pace="1.25">1.25×</button>
                 </div>`
              : `<span class="viz-hint-pill">Плавное сопровождение</span>`
          }
        </div>
      `;

      const stage = this.el.querySelector("#viz-stage");
      const vizTrack = (goal, p) => {
        if (window.DSMAnalytics && typeof window.DSMAnalytics.track === "function") {
          window.DSMAnalytics.track(goal, p);
        }
      };

      this.el.querySelector("#viz-sound-btn").addEventListener("click", (e) => {
        this.soundOn = !this.soundOn;
        e.currentTarget.textContent = this.soundOn ? "🔔 Такт: вкл" : "🔕 Такт: выкл";
        e.currentTarget.classList.toggle("active", this.soundOn);
        if (this.soundOn) playSoftCue(432, 0.09, 0.04);
        vizTrack("viz_sound_toggle", { on: this.soundOn });
      });

      this.el.querySelectorAll(".pace-opt").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = Number(btn.dataset.pace || 1);
          this.paceMult = val;
          this.el.querySelectorAll(".pace-opt").forEach((b) => b.classList.toggle("active", b === btn));
          triggerHaptic("light");
          vizTrack("pace_change", { pace_mult: val, practice_id: pid || "unknown" });
        });
      });

      this._initDom(stage);
      this._updateChannelLegend();

      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.06, Math.max(0.001, (now - this.lastNow) / 1000));
        this.lastNow = now;
        this._frame(this.getElapsedSec(now), dt);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    _fallbackSpec(practice) {
      const cat = (practice && practice.folder_category) || "";
      if (cat.includes("дыхание")) return SPECS["kogerentnoe-dyhanie"];
      if (cat.includes("зрение")) return SPECS["otslezhivanie"];
      if (cat.includes("слух")) return SPECS["pole-zvuka"];
      if (cat.includes("тело")) return SPECS["skanirovanie-tela"];
      if (cat.includes("нейро")) return SPECS["kulak-rebro-ladon"];
      if (cat.includes("глубокий")) return SPECS["kasina-prostranstva"];
      return SPECS["vrashchenie-vnimaniya"];
    }

    _cue(idx, freq = 432, prevTarget = 0.5, curTarget = 0.5, durSec = 4.0) {
      if (this.paused || idx === this.lastCueIdx) return;
      this.lastCueIdx = idx;
      triggerHaptic("light");
      if (this.eyesClosedGuide && window.DSMAudioCue && typeof window.DSMAudioCue.playBreathGlide === "function") {
        if (curTarget > prevTarget + 0.05) {
          window.DSMAudioCue.playBreathGlide(272, 396, durSec, 0.034);
          return;
        }
        if (curTarget < prevTarget - 0.05) {
          window.DSMAudioCue.playBreathGlide(396, 236, durSec, 0.032);
          return;
        }
      }
      if ((this.soundOn || this.eyesClosedGuide) && freq > 0) playSoftCue(freq, 0.085, 0.045);
    }

    _crossPhaseKind() {
      const vp = this.phaseObj && this.phaseObj.viz_phase;
      if (vp) return vp;
      const order = ["sync", "eye_orbit_attn_center", "eye_center_attn_cw", "eye_center_attn_ccw", "defocus"];
      return order[Math.min(order.length - 1, Math.max(0, this.phaseIdx))];
    }

    _updateChannelLegend() {
      if (!this.el || !this.spec) return;
      const leg = this.el.querySelector("#viz-channel-legend");
      if (!leg) return;
      const isTwoChannel =
        (this.spec.engine === "eye" && this.spec.mode === "cross") ||
        (this.spec.engine === "attention" && this.spec.mode === "orbit_attn");
      if (!isTwoChannel) {
        leg.classList.add("hidden");
        return;
      }
      leg.classList.remove("hidden");
      let eyeTxt = "Глаза спокойно в центре";
      let attnTxt = "Внимание мягко скользит по кругу";

      if (this.spec.mode === "cross") {
        const kind = this._crossPhaseKind();
        const defaults = {
          sync: ["Глаза по кругу (по часовой)", "Внимание вместе со взглядом"],
          eye_orbit_attn_center: ["Глаза по кругу (по часовой)", "Внимание спокойно в центре"],
          eye_center_attn_cw: ["Глаза мягко в центре", "Внимание по кругу (по часовой)"],
          eye_center_attn_ccw: ["Глаза мягко в центре", "Внимание против часовой"],
          defocus: ["Взгляд сквозь центр", "Внимание на всё поле сразу"],
        };
        const pair = defaults[kind] || defaults.sync;
        eyeTxt = (this.phaseObj && this.phaseObj.eye_cue) || pair[0];
        attnTxt = (this.phaseObj && this.phaseObj.attn_cue) || pair[1];
      } else if (this.spec.mode === "orbit_attn") {
        eyeTxt = (this.phaseObj && this.phaseObj.eye_cue) || "Глаза закрыты или мягко в центре";
        attnTxt = (this.phaseObj && this.phaseObj.attn_cue) || "Внимание плавно обходит 4 сектора";
      }

      leg.innerHTML = `
        <span class="vz-leg eye"><i class="vz-dot eye"></i><strong>Взгляд:</strong> ${eyeTxt}</span>
        <span class="vz-leg attn"><i class="vz-dot attn"></i><strong>Внимание:</strong> ${attnTxt}</span>
      `;
    }

    _initDom(stage) {
      const s = this.spec;
      if (s.engine === "breath") {
        const petals = [0, 60, 120, 180, 240, 300]
          .map(
            (deg, i) =>
              `<circle id="vz-p${i}" cx="130" cy="100" r="22" fill="${s.color}" opacity="0.14" transform="rotate(${deg} 130 100)"/>`
          )
          .join("");
        stage.innerHTML = `
          <svg viewBox="0 0 260 202" class="viz-svg">
            <defs>
              <linearGradient id="ringArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:var(--dsm-cyan)"/>
                <stop offset="54%" style="stop-color:var(--dsm-cobalt)"/>
                <stop offset="100%" style="stop-color:var(--dsm-indigo)"/>
              </linearGradient>
              <radialGradient id="orbGrad" cx="48%" cy="38%" r="60%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.96"/>
                <stop offset="56%" stop-color="${s.color}" stop-opacity="0.32"/>
                <stop offset="100%" stop-color="${s.color}" stop-opacity="0.06"/>
              </radialGradient>
            </defs>
            ${
              s.shape === "square"
                ? `<rect x="55" y="25" width="150" height="150" rx="30" fill="var(--viz-surface)" stroke="var(--viz-track)" stroke-width="8"/>`
                : `<circle cx="130" cy="100" r="78" fill="var(--viz-surface)" stroke="var(--viz-track)" stroke-width="10"/>
                   <circle id="vz-prog-arc" cx="130" cy="100" r="78" fill="none" stroke="url(#ringArcGrad)" stroke-width="10" stroke-linecap="round" stroke-dasharray="490.1" stroke-dashoffset="490.1" transform="rotate(-90 130 100)"/>`
            }
            <circle id="vz-return-ring" cx="130" cy="100" r="30" fill="none" stroke="${BREATH_COLOR}" stroke-width="2.5" opacity="0"/>
            <circle id="vz-halo" cx="130" cy="100" r="52" fill="${s.color}" opacity="0.10"/>
            <g id="vz-petals">${petals}</g>
            <circle id="vz-orb" cx="130" cy="100" r="44" fill="url(#orbGrad)" stroke="rgba(255,255,255,0.82)" stroke-width="1.5"/>
            <circle id="vz-trail2" cx="130" cy="22" r="3.8" fill="#3778ff" opacity="0.22"/>
            <circle id="vz-trail1" cx="130" cy="22" r="5.2" fill="#3778ff" opacity="0.42"/>
            <circle id="vz-sat" cx="130" cy="22" r="7.5" fill="#ffffff" stroke="#3778ff" stroke-width="3"/>
            <text id="vz-sec" x="130" y="106" text-anchor="middle" fill="var(--viz-ink)" font-size="21" font-weight="800"></text>
          </svg>
          <div id="vz-lbl" class="viz-caption"></div>`;
      } else if (s.engine === "eye" && s.mode === "cross") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 180" class="viz-svg">
            <rect x="14" y="8" width="232" height="164" rx="22" fill="var(--viz-surface)" stroke="var(--viz-track)" stroke-width="1.5"/>
            <line x1="130" y1="24" x2="130" y2="156" stroke="var(--viz-track)" stroke-width="1.5" stroke-dasharray="3 4"/>
            <line x1="56" y1="90" x2="204" y2="90" stroke="var(--viz-track)" stroke-width="1.5" stroke-dasharray="3 4"/>
            <circle cx="130" cy="90" r="56" fill="none" stroke="var(--viz-track)" stroke-width="2"/>
            <circle id="vz-defocus-ring" cx="130" cy="90" r="30" fill="none" stroke="${BREATH_COLOR}" stroke-width="2" opacity="0"/>
            <circle id="vz-return-ring" cx="130" cy="90" r="18" fill="none" stroke="${BREATH_COLOR}" stroke-width="2.5" opacity="0"/>
            <circle cx="130" cy="90" r="5" fill="var(--viz-track)"/>
            <circle cx="130" cy="90" r="2.4" fill="var(--viz-ink)"/>

            <circle id="vz-et2" cx="130" cy="34" r="3.5" fill="${EYE_COLOR}" opacity="0.18"/>
            <circle id="vz-et1" cx="130" cy="34" r="5" fill="${EYE_COLOR}" opacity="0.34"/>
            <circle id="vz-eglow" cx="130" cy="34" r="15" fill="${EYE_COLOR}" opacity="0.18"/>
            <circle id="vz-edot" cx="130" cy="34" r="7.5" fill="#ffffff" stroke="${EYE_COLOR}" stroke-width="3.2"/>

            <circle id="vz-at2" cx="130" cy="90" r="3.5" fill="${ATTN_COLOR}" opacity="0.18"/>
            <circle id="vz-at1" cx="130" cy="90" r="5" fill="${ATTN_COLOR}" opacity="0.36"/>
            <circle id="vz-aglow" cx="130" cy="90" r="16" fill="${ATTN_COLOR}" opacity="0.22"/>
            <circle id="vz-adot" cx="130" cy="90" r="6.8" fill="${ATTN_COLOR}" stroke="#ffffff" stroke-width="2"/>
          </svg>
          <div id="vz-elbl" class="viz-caption"></div>`;
      } else if (s.engine === "attention" && s.mode === "orbit_attn") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 182" class="viz-svg">
            <rect x="14" y="8" width="232" height="166" rx="22" fill="var(--viz-surface)" stroke="var(--viz-track)" stroke-width="1.5"/>
            <circle cx="130" cy="92" r="54" fill="none" stroke="var(--viz-track)" stroke-width="2"/>
            <text x="130" y="29" text-anchor="middle" fill="var(--viz-muted)" font-size="10.5" font-weight="700">СПЕРЕДИ</text>
            <text x="208" y="96" text-anchor="middle" fill="var(--viz-muted)" font-size="10.5" font-weight="700">СПРАВА</text>
            <text x="130" y="164" text-anchor="middle" fill="var(--viz-muted)" font-size="10.5" font-weight="700">СЗАДИ</text>
            <text x="52" y="96" text-anchor="middle" fill="var(--viz-muted)" font-size="10.5" font-weight="700">СЛЕВА</text>
            <circle id="vz-return-ring" cx="130" cy="92" r="18" fill="none" stroke="${BREATH_COLOR}" stroke-width="2.5" opacity="0"/>
            <circle cx="130" cy="92" r="12" fill="${EYE_COLOR}" opacity="0.14"/>
            <circle cx="130" cy="92" r="5.5" fill="#ffffff" stroke="${EYE_COLOR}" stroke-width="2.6"/>
            <circle id="vz-at2" cx="130" cy="38" r="3.5" fill="${ATTN_COLOR}" opacity="0.18"/>
            <circle id="vz-at1" cx="130" cy="38" r="5" fill="${ATTN_COLOR}" opacity="0.34"/>
            <circle id="vz-aglow" cx="130" cy="38" r="16" fill="${ATTN_COLOR}" opacity="0.22"/>
            <circle id="vz-adot" cx="130" cy="38" r="7" fill="${ATTN_COLOR}" stroke="#ffffff" stroke-width="2"/>
          </svg>
          <div id="vz-olbl" class="viz-caption"></div>`;
      } else if (s.engine === "neuro" && s.mode === "gestures") {
        stage.innerHTML = `
          <div class="neuro-card">
            <div class="neuro-ring-wrap">
              <svg viewBox="0 0 120 120" class="neuro-ring-svg">
                <circle cx="60" cy="60" r="52" fill="var(--viz-surface)" stroke="var(--viz-track)" stroke-width="7"/>
                <circle id="vz-nring" cx="60" cy="60" r="52" fill="none" stroke="#3778ff" stroke-width="7"
                  stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7" transform="rotate(-90 60 60)"/>
              </svg>
              <div id="vz-nicon" class="neuro-icon">✊</div>
            </div>
            <div id="vz-ntitle" class="neuro-title"></div>
            <div id="vz-nsub" class="neuro-sub"></div>
            <div id="vz-nstrip" class="neuro-strip"></div>
            <div id="vz-nnext" class="neuro-next-hint"></div>
          </div>`;
        const strip = stage.querySelector("#vz-nstrip");
        this._chips = s.items.map((it) => {
          const sp = document.createElement("span");
          sp.className = "nchip";
          sp.textContent = `${it.icon} ${it.title.split(" ")[0]}`;
          strip.appendChild(sp);
          return sp;
        });
      } else if (s.engine === "neuro" && s.mode === "fingers") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 178" class="viz-svg">
            <g transform="translate(30,15)">
              <rect x="65" y="105" width="70" height="58" rx="20" fill="var(--viz-surface)" stroke="var(--viz-track)"/>
              <line id="f-0" x1="65" y1="132" x2="34" y2="105" stroke="${s.accent}" stroke-width="14" stroke-linecap="round"/>
              <line id="f-1" x1="76" y1="108" x2="68" y2="42" stroke="var(--viz-track)" stroke-width="13" stroke-linecap="round"/>
              <line id="f-2" x1="94" y1="105" x2="96" y2="28" stroke="var(--viz-track)" stroke-width="13" stroke-linecap="round"/>
              <line id="f-3" x1="112" y1="106" x2="122" y2="38" stroke="var(--viz-track)" stroke-width="13" stroke-linecap="round"/>
              <line id="f-4" x1="128" y1="112" x2="146" y2="62" stroke="var(--viz-track)" stroke-width="12" stroke-linecap="round"/>
              <circle id="f-ring-glow" cx="68" cy="42" r="16" fill="#3778ff" opacity="0.22"/>
              <circle id="f-ring" cx="68" cy="42" r="10" fill="none" stroke="#3778ff" stroke-width="3"/>
            </g>
          </svg>
          <div id="vz-flbl" class="viz-caption"></div>`;
      } else if (s.engine === "neuro" && s.mode === "cross") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 176" class="viz-svg">
            <circle cx="130" cy="36" r="14" fill="var(--viz-track)"/>
            <line x1="130" y1="52" x2="130" y2="116" stroke="var(--viz-track)" stroke-width="4" stroke-linecap="round"/>
            <line id="cr-lr" x1="78" y1="74" x2="176" y2="148" stroke="var(--viz-track)" stroke-width="5" stroke-linecap="round"/>
            <line id="cr-rl" x1="182" y1="74" x2="84" y2="148" stroke="var(--viz-track)" stroke-width="5" stroke-linecap="round"/>
            <circle id="cr-tl" cx="78" cy="74" r="12" fill="var(--viz-track)"/>
            <circle id="cr-tr" cx="182" cy="74" r="12" fill="var(--viz-track)"/>
            <circle id="cr-bl" cx="84" cy="148" r="12" fill="var(--viz-track)"/>
            <circle id="cr-br" cx="176" cy="148" r="12" fill="var(--viz-track)"/>
          </svg>
          <div id="vz-clbl" class="viz-caption"></div>`;
      } else if (s.engine === "neuro" && s.mode === "polyrhythm") {
        stage.innerHTML = `
          <div class="poly-wrap">
            <div class="poly-row"><span class="poly-tag">ЛЕВАЯ (2)</span><div class="poly-dots" id="poly-l"></div></div>
            <div class="poly-row"><span class="poly-tag">ПРАВАЯ (3)</span><div class="poly-dots" id="poly-r"></div></div>
            <div id="vz-plbl" class="neuro-sub" style="margin-top:8px">Полиритмия 2 против 3 · отбивай по подсветке</div>
          </div>`;
        const pl = stage.querySelector("#poly-l");
        const pr = stage.querySelector("#poly-r");
        this._polyL = s.leftBeats.map((v) => {
          const d = document.createElement("span");
          d.className = `pdot${v ? " beat" : ""}`;
          pl.appendChild(d);
          return d;
        });
        this._polyR = s.rightBeats.map((v) => {
          const d = document.createElement("span");
          d.className = `pdot${v ? " beat" : ""}`;
          pr.appendChild(d);
          return d;
        });
      } else if (s.engine === "path") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 205" class="viz-svg">
            ${
              s.mode === "infinity"
                ? `<path d="M130,95 C165,45 225,45 225,95 C225,145 165,145 130,95 C95,45 35,45 35,95 C35,145 95,145 130,95 Z" fill="none" stroke="var(--viz-track)" stroke-width="3.5"/>
                   <circle id="vz-pt2" cx="130" cy="95" r="4" fill="#3778ff" opacity="0.22"/>
                   <circle id="vz-pt1" cx="130" cy="95" r="6" fill="#3778ff" opacity="0.4"/>
                   <circle id="vz-pdot" cx="130" cy="95" r="8.5" fill="#ffffff" stroke="#3778ff" stroke-width="3"/>`
                : s.mode === "dual"
                ? `<circle cx="72" cy="95" r="42" fill="none" stroke="var(--viz-track)" stroke-width="2.8"/>
                   <rect x="148" y="53" width="84" height="84" rx="8" fill="none" stroke="var(--viz-track)" stroke-width="2.8"/>
                   <circle id="vz-dl" cx="114" cy="95" r="8" fill="${EYE_COLOR}"/>
                   <circle id="vz-dr" cx="148" cy="53" r="8" fill="#4f46e5"/>`
                : `<path d="M60,145 Q130,20 200,145" fill="none" stroke="var(--viz-track)" stroke-width="2.5" stroke-dasharray="5 5"/>
                   <circle id="vz-j1" cx="60" cy="145" r="9" fill="${EYE_COLOR}"/>
                   <circle id="vz-j2" cx="130" cy="70" r="9" fill="${ATTN_COLOR}"/>
                   <circle id="vz-j3" cx="200" cy="145" r="9" fill="${BREATH_COLOR}"/>`
            }
          </svg>
          <div class="viz-caption">${s.label}</div>`;
      } else if (s.engine === "eye") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 176" class="viz-svg">
            <rect x="14" y="12" width="232" height="154" rx="22" fill="var(--viz-surface)" stroke="var(--viz-track)" stroke-width="1.5"/>
            <circle id="vz-eperi2" cx="130" cy="90" r="72" fill="none" stroke="#3778ff" stroke-width="1.8" opacity="0"/>
            <circle id="vz-eperi" cx="130" cy="90" r="52" fill="none" stroke="#3778ff" stroke-width="2.5" opacity="0"/>
            <circle id="vz-return-ring" cx="130" cy="90" r="18" fill="none" stroke="${BREATH_COLOR}" stroke-width="2.5" opacity="0"/>
            <circle id="vz-et2" cx="130" cy="90" r="3.5" fill="#3778ff" opacity="0"/>
            <circle id="vz-et1" cx="130" cy="90" r="5.5" fill="#3778ff" opacity="0"/>
            <circle id="vz-eglow" cx="130" cy="90" r="20" fill="#3778ff" opacity="0.20"/>
            <circle id="vz-edot" cx="130" cy="90" r="8" fill="#ffffff" stroke="#3778ff" stroke-width="3"/>
          </svg>
          <div id="vz-elbl" class="viz-caption">${s.label}</div>`;
      } else if (s.engine === "sound") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 178" class="viz-svg">
            <circle id="sr-wave" cx="130" cy="92" r="20" fill="none" stroke="#3778ff" stroke-width="2" opacity="0.28"/>
            <circle id="sr-3" cx="130" cy="92" r="74" fill="none" stroke="#3778ff" stroke-width="2.2" opacity="0.22"/>
            <circle id="sr-2" cx="130" cy="92" r="49" fill="none" stroke="#3778ff" stroke-width="2.2" opacity="0.22"/>
            <circle id="sr-1" cx="130" cy="92" r="24" fill="none" stroke="#3778ff" stroke-width="2.2" opacity="0.22"/>
            <circle id="vz-return-ring" cx="130" cy="92" r="18" fill="none" stroke="${BREATH_COLOR}" stroke-width="2.5" opacity="0"/>
            <circle cx="130" cy="92" r="5.5" fill="#3778ff"/>
            <circle id="sr-ping-glow" cx="130" cy="40" r="13" fill="#4f46e5" opacity="0"/>
            <circle id="sr-ping" cx="130" cy="40" r="6" fill="#4f46e5" opacity="0"/>
          </svg>
          <div id="vz-slbl" class="viz-caption"></div>`;
      } else if (s.engine === "body") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 182" class="viz-svg">
            <defs>
              <linearGradient id="scanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#24d2ff" stop-opacity="0.08"/>
                <stop offset="50%" stop-color="#3778ff" stop-opacity="0.52"/>
                <stop offset="100%" stop-color="#24d2ff" stop-opacity="0.08"/>
              </linearGradient>
            </defs>
            <g id="vz-bodyg" stroke="var(--viz-track)" stroke-width="3.6" fill="none" stroke-linecap="round">
              <circle cx="130" cy="34" r="13"/>
              <line x1="130" y1="48" x2="130" y2="112"/>
              <line x1="130" y1="60" x2="96" y2="96"/>
              <line x1="130" y1="60" x2="164" y2="96"/>
              <line x1="130" y1="112" x2="108" y2="164"/>
              <line x1="130" y1="112" x2="152" y2="164"/>
            </g>
            <rect id="vz-scan" x="64" y="150" width="132" height="16" rx="8" fill="url(#scanGrad)"/>
          </svg>
          <div id="vz-blbl" class="viz-caption">${s.label}</div>`;
      } else if (s.engine === "attention") {
        if (s.mode === "sevens") {
          stage.innerHTML = `
            <div class="neuro-card">
              <div class="neuro-sub">Вычитай спокойно по 7 вслух или про себя</div>
              <div id="vz-7num" class="clock-inline" style="margin:8px 0">100</div>
              <button type="button" id="vz-7next" class="btn primary small">− 7 (следующее)</button>
            </div>`;
          stage.querySelector("#vz-7next").addEventListener("click", () => {
            this.sevensVal = this.sevensVal - 7 < 0 ? 100 : this.sevensVal - 7;
            stage.querySelector("#vz-7num").textContent = String(this.sevensVal);
            triggerHaptic("light");
          });
        } else {
          stage.innerHTML = `
            <div class="neuro-card" id="vz-attn-card">
              <div id="vz-abadge" class="attn-badge"></div>
              <div id="vz-atitle" class="neuro-title"></div>
              <div id="vz-asub" class="neuro-sub"></div>
            </div>`;
        }
      } else if (s.engine === "deep") {
        stage.innerHTML = `
          <svg viewBox="0 0 260 176" class="viz-svg">
            <defs>
              <radialGradient id="deepGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#24d2ff" stop-opacity="0.68"/>
                <stop offset="55%" stop-color="#3778ff" stop-opacity="0.24"/>
                <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <circle id="vz-deep-outer" cx="130" cy="90" r="72" fill="none" stroke="#3778ff" stroke-width="1.5" opacity="0.24"/>
            <circle id="vz-return-ring" cx="130" cy="90" r="24" fill="none" stroke="${BREATH_COLOR}" stroke-width="2.5" opacity="0"/>
            <circle id="vz-korb" cx="130" cy="90" r="56" fill="url(#deepGrad)"/>
          </svg>
          <div class="viz-caption">${s.label}</div>`;
      }
    }

    _tickReturnRipple(dt) {
      if (this.returnPulse <= 0) return;
      this.returnPulse = Math.max(0, this.returnPulse - dt * 1.15);
      const p = 1 - this.returnPulse;
      const ring = this.el && this.el.querySelector("#vz-return-ring");
      if (ring) {
        ring.setAttribute("r", (16 + p * 66).toFixed(1));
        ring.setAttribute("opacity", (this.returnPulse * 0.72).toFixed(2));
      }
      const card = this.el && this.el.querySelector("#vz-attn-card");
      if (card) {
        card.style.boxShadow =
          this.returnPulse > 0.02
            ? `0 0 ${Math.round(this.returnPulse * 24)}px rgba(88, 201, 160, ${(this.returnPulse * 0.35).toFixed(2)})`
            : "";
      }
    }

    _frame(rawT, dt) {
      const s = this.spec;
      this._tickReturnRipple(dt);
      const t = rawT * this.paceMult;

      if (s.engine === "breath") {
        const total = s.cycles.reduce((a, c) => a + c.sec, 0);
        const mod = t % total;
        let acc = 0, idx = 0, prevTarget = s.cycles[s.cycles.length - 1].target;
        for (let i = 0; i < s.cycles.length; i++) {
          if (mod < acc + s.cycles[i].sec) { idx = i; break; }
          prevTarget = s.cycles[i].target;
          acc += s.cycles[i].sec;
        }
        const cur = s.cycles[idx];
        const frac = Math.min(1, (mod - acc) / cur.sec);
        const ease = easeInOutSine(frac);
        const level = prevTarget + (cur.target - prevTarget) * ease;
        const vib = cur.vibrate ? Math.sin(rawT * 22) * 1.8 : 0;
        const r = 26 + level * 38 + vib;
        this._cue(idx, cur.tone, prevTarget, cur.target, cur.sec / this.paceMult);

        const orb = this.el.querySelector("#vz-orb");
        const halo = this.el.querySelector("#vz-halo");
        const sat = this.el.querySelector("#vz-sat");
        const progArc = this.el.querySelector("#vz-prog-arc");
        const petalsGrp = this.el.querySelector("#vz-petals");
        if (orb) orb.setAttribute("r", (r * 0.92).toFixed(1));
        if (halo) halo.setAttribute("r", (r + 16 + Math.sin(rawT * 1.4) * 2.5).toFixed(1));
        if (progArc) {
          const gProg = Math.max(0.02, Math.min(1, mod / total));
          progArc.setAttribute("stroke-dashoffset", (490.1 * (1 - gProg)).toFixed(1));
        }
        if (petalsGrp) {
          const rot = (rawT * 8) % 360;
          petalsGrp.setAttribute("transform", `rotate(${rot.toFixed(1)} 130 100)`);
          const offset = 4 + level * 22;
          const pr = 14 + level * 24;
          for (let i = 0; i < 6; i++) {
            const pe = this.el.querySelector(`#vz-p${i}`);
            if (pe) {
              const ang = (i * Math.PI) / 3;
              pe.setAttribute("cx", (130 + Math.cos(ang) * offset).toFixed(1));
              pe.setAttribute("cy", (100 + Math.sin(ang) * offset).toFixed(1));
              pe.setAttribute("r", pr.toFixed(1));
            }
          }
        }

        const orbitPoint = (gFrac) => {
          const gf = ((gFrac % 1) + 1) % 1;
          if (s.shape === "square") {
            const per = gf * 4;
            const side = Math.floor(per);
            const sf = per - side;
            if (side === 0) return [55 + sf * 150, 25];
            if (side === 1) return [205, 25 + sf * 150];
            if (side === 2) return [205 - sf * 150, 175];
            return [55, 175 - sf * 150];
          }
          const ang = -Math.PI / 2 + gf * Math.PI * 2;
          return [130 + Math.cos(ang) * 78, 100 + Math.sin(ang) * 78];
        };
        const globalFrac = mod / total;
        const [sx, sy] = orbitPoint(globalFrac);
        const [t1x, t1y] = orbitPoint(globalFrac - 0.02);
        const [t2x, t2y] = orbitPoint(globalFrac - 0.044);
        if (sat) { sat.setAttribute("cx", sx.toFixed(1)); sat.setAttribute("cy", sy.toFixed(1)); }
        const tr1 = this.el.querySelector("#vz-trail1");
        const tr2 = this.el.querySelector("#vz-trail2");
        if (tr1) { tr1.setAttribute("cx", t1x.toFixed(1)); tr1.setAttribute("cy", t1y.toFixed(1)); }
        if (tr2) { tr2.setAttribute("cx", t2x.toFixed(1)); tr2.setAttribute("cy", t2y.toFixed(1)); }

        const rem = Math.max(0.1, (cur.sec - (mod - acc)) / this.paceMult);
        const secEl = this.el.querySelector("#vz-sec");
        const lblEl = this.el.querySelector("#vz-lbl");
        if (secEl) secEl.textContent = rem.toFixed(1);
        if (lblEl) lblEl.textContent = cur.label;
      } else if (s.engine === "eye" && s.mode === "cross") {
        // Silky 2-marker phase-synchronized engine for «Крест развязки»
        const kind = this._crossPhaseKind();
        const cx = 130, cy = 90, R = 56;
        const angCW = -Math.PI / 2 + t * ((Math.PI * 2) / 11.5);
        const angCCW = -Math.PI / 2 - t * ((Math.PI * 2) / 11.5);

        let txE = cx, tyE = cy, txA = cx, tyA = cy;
        let lbl = "Взгляд и внимание идут вместе по кругу";
        let defocusTarget = 0;

        if (kind === "sync") {
          txE = cx + Math.cos(angCW) * R;
          tyE = cy + Math.sin(angCW) * R;
          txA = txE;
          tyA = tyE;
          lbl = "Фаза 1 · Синхрон: взгляд и внимание вместе";
        } else if (kind === "eye_orbit_attn_center") {
          txE = cx + Math.cos(angCW) * R;
          tyE = cy + Math.sin(angCW) * R;
          txA = cx;
          tyA = cy;
          lbl = "Фаза 2 · Глаза по кругу · Внимание держит центр";
        } else if (kind === "eye_center_attn_cw") {
          txE = cx;
          tyE = cy;
          txA = cx + Math.cos(angCW) * R;
          tyA = cy + Math.sin(angCW) * R;
          lbl = "Фаза 3 · Глаза в центре · Внимание по часовой";
        } else if (kind === "eye_center_attn_ccw") {
          txE = cx;
          tyE = cy;
          txA = cx + Math.cos(angCCW) * R;
          tyA = cy + Math.sin(angCCW) * R;
          lbl = "Фаза 4 · Глаза в центре · Внимание против часовой";
        } else {
          txE = cx; tyE = cy; txA = cx; tyA = cy;
          defocusTarget = 1;
          lbl = "Фаза 5 · Расфокус: центр и края поля одновременно";
        }

        const st = this._state;
        st.ex = lerpExp(st.ex, txE, 8.5, dt);
        st.ey = lerpExp(st.ey, tyE, 8.5, dt);
        st.ax = lerpExp(st.ax, txA, 8.5, dt);
        st.ay = lerpExp(st.ay, tyA, 8.5, dt);

        // Soft trailing history
        st.eyeTrail[0][0] = lerpExp(st.eyeTrail[0][0], st.ex, 7.0, dt);
        st.eyeTrail[0][1] = lerpExp(st.eyeTrail[0][1], st.ey, 7.0, dt);
        st.eyeTrail[1][0] = lerpExp(st.eyeTrail[1][0], st.eyeTrail[0][0], 5.5, dt);
        st.eyeTrail[1][1] = lerpExp(st.eyeTrail[1][1], st.eyeTrail[0][1], 5.5, dt);

        st.attnTrail[0][0] = lerpExp(st.attnTrail[0][0], st.ax, 7.0, dt);
        st.attnTrail[0][1] = lerpExp(st.attnTrail[0][1], st.ay, 7.0, dt);
        st.attnTrail[1][0] = lerpExp(st.attnTrail[1][0], st.attnTrail[0][0], 5.5, dt);
        st.attnTrail[1][1] = lerpExp(st.attnTrail[1][1], st.attnTrail[0][1], 5.5, dt);

        const breathPulse = Math.sin(rawT * 1.8) * 2.2;
        const setPt = (id, x, y, r) => {
          const el = this.el.querySelector(id);
          if (!el) return;
          el.setAttribute("cx", x.toFixed(1));
          el.setAttribute("cy", y.toFixed(1));
          if (r != null) el.setAttribute("r", r.toFixed(1));
        };

        setPt("#vz-et1", st.eyeTrail[0][0], st.eyeTrail[0][1]);
        setPt("#vz-et2", st.eyeTrail[1][0], st.eyeTrail[1][1]);
        setPt("#vz-eglow", st.ex, st.ey, 14 + breathPulse * 0.6);
        setPt("#vz-edot", st.ex, st.ey, kind === "sync" ? 9.2 : 7.4);

        setPt("#vz-at1", st.attnTrail[0][0], st.attnTrail[0][1]);
        setPt("#vz-at2", st.attnTrail[1][0], st.attnTrail[1][1]);
        setPt("#vz-aglow", st.ax, st.ay, 15 - breathPulse * 0.6);
        setPt("#vz-adot", st.ax, st.ay, kind === "sync" ? 5.2 : 6.8);

        const defRing = this.el.querySelector("#vz-defocus-ring");
        if (defRing) {
          const wave = 34 + 34 * (0.5 + 0.5 * Math.sin(rawT * 0.85));
          defRing.setAttribute("r", wave.toFixed(1));
          defRing.setAttribute("opacity", defocusTarget ? (0.28 + 0.25 * Math.sin(rawT * 0.85)).toFixed(2) : "0");
        }
        const lblEl = this.el.querySelector("#vz-elbl");
        if (lblEl) lblEl.textContent = lbl;
      } else if (s.engine === "attention" && s.mode === "orbit_attn") {
        // 2-channel silky orbit for «Вращение внимания»
        const cx = 130, cy = 92, R = 54;
        const ang = -Math.PI / 2 + t * ((Math.PI * 2) / 16);
        const txA = cx + Math.cos(ang) * R;
        const tyA = cy + Math.sin(ang) * R;
        const st = this._state;
        st.ax = lerpExp(st.ax, txA, 7.5, dt);
        st.ay = lerpExp(st.ay, tyA, 7.5, dt);
        st.attnTrail[0][0] = lerpExp(st.attnTrail[0][0], st.ax, 6.0, dt);
        st.attnTrail[0][1] = lerpExp(st.attnTrail[0][1], st.ay, 6.0, dt);
        st.attnTrail[1][0] = lerpExp(st.attnTrail[1][0], st.attnTrail[0][0], 4.5, dt);
        st.attnTrail[1][1] = lerpExp(st.attnTrail[1][1], st.attnTrail[0][1], 4.5, dt);

        const setPt = (id, x, y) => {
          const el = this.el.querySelector(id);
          if (el) { el.setAttribute("cx", x.toFixed(1)); el.setAttribute("cy", y.toFixed(1)); }
        };
        setPt("#vz-at1", st.attnTrail[0][0], st.attnTrail[0][1]);
        setPt("#vz-at2", st.attnTrail[1][0], st.attnTrail[1][1]);
        setPt("#vz-aglow", st.ax, st.ay);
        setPt("#vz-adot", st.ax, st.ay);

        const normAng = (((ang + Math.PI / 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const secIdx = Math.floor(((normAng + Math.PI / 4) % (Math.PI * 2)) / (Math.PI / 2));
        const names = ["Сектор: Спереди", "Сектор: Справа", "Сектор: Сзади", "Сектор: Слева"];
        this._cue(Math.floor(t / 4), 400 + secIdx * 32);
        const olbl = this.el.querySelector("#vz-olbl");
        if (olbl) olbl.textContent = names[secIdx] || names[0];
      } else if (s.engine === "neuro" && s.mode === "gestures") {
        const pace = (s.defaultPaceSec || 1.5) / this.paceMult;
        const stepNo = Math.floor(rawT / pace);
        const idx = stepNo % s.items.length;
        const frac = (rawT % pace) / pace;
        this._cue(stepNo, 396 + idx * 45);
        const item = s.items[idx];
        const ring = this.el.querySelector("#vz-nring");
        if (ring) ring.setAttribute("stroke-dashoffset", (326.7 * (1 - frac)).toFixed(1));
        const ic = this.el.querySelector("#vz-nicon");
        if (ic) {
          ic.style.transform = `scale(${(1 + Math.sin(frac * Math.PI) * 0.1).toFixed(3)})`;
        }
        if (this._lastDomKey !== idx) {
          this._lastDomKey = idx;
          if (ic) ic.textContent = item.icon;
          this.el.querySelector("#vz-ntitle").textContent = item.title;
          this.el.querySelector("#vz-nsub").textContent = item.sub;
          this._chips.forEach((ch, i) => ch.classList.toggle("active", i === idx));
          const nextItem = s.items[(idx + 1) % s.items.length];
          const nextEl = this.el.querySelector("#vz-nnext");
          if (nextEl && nextItem) nextEl.textContent = `Далее: ${nextItem.icon} ${nextItem.title}`;
        }
      } else if (s.engine === "neuro" && s.mode === "fingers") {
        const pace = (s.defaultPaceSec || 1.2) / this.paceMult;
        const stepNo = Math.floor(rawT / pace);
        const cur = s.sequence[stepNo % s.sequence.length];
        this._cue(stepNo, 380 + cur.finger * 42);
        const tips = { 1: [68, 42], 2: [96, 28], 3: [122, 38], 4: [146, 62] };
        const [tx, ty] = tips[cur.finger] || [68, 42];
        this._state.fRingX = lerpExp(this._state.fRingX, tx, 11, dt);
        this._state.fRingY = lerpExp(this._state.fRingY, ty, 11, dt);
        const ring = this.el.querySelector("#f-ring");
        const rglow = this.el.querySelector("#f-ring-glow");
        if (ring) { ring.setAttribute("cx", this._state.fRingX.toFixed(1)); ring.setAttribute("cy", this._state.fRingY.toFixed(1)); }
        if (rglow) { rglow.setAttribute("cx", this._state.fRingX.toFixed(1)); rglow.setAttribute("cy", this._state.fRingY.toFixed(1)); }
        if (this._lastDomKey !== cur.finger) {
          this._lastDomKey = cur.finger;
          for (let f = 1; f <= 4; f++) {
            const line = this.el.querySelector(`#f-${f}`);
            if (line) line.setAttribute("stroke", f === cur.finger ? "#3778ff" : "var(--viz-track)");
          }
          this.el.querySelector("#vz-flbl").textContent = cur.label;
        }
      } else if (s.engine === "neuro" && s.mode === "cross") {
        const pace = (s.defaultPaceSec || 1.6) / this.paceMult;
        const stepNo = Math.floor(rawT / pace);
        const idx = stepNo % s.steps.length;
        const cur = s.steps[idx];
        this._cue(stepNo, cur.active === "LR" ? 432 : cur.active === "RL" ? 348 : 496);
        if (this._lastDomKey !== idx) {
          this._lastDomKey = idx;
          const on = "#3778ff", off = "var(--viz-track)";
          this.el.querySelector("#cr-lr").setAttribute("stroke", cur.active === "LR" ? on : off);
          this.el.querySelector("#cr-rl").setAttribute("stroke", cur.active === "RL" ? on : off);
          this.el.querySelector("#cr-tl").setAttribute("fill", cur.active === "LR" ? on : off);
          this.el.querySelector("#cr-br").setAttribute("fill", cur.active === "LR" ? on : off);
          this.el.querySelector("#cr-tr").setAttribute("fill", cur.active === "RL" ? on : off);
          this.el.querySelector("#cr-bl").setAttribute("fill", cur.active === "RL" ? on : off);
          this.el.querySelector("#vz-clbl").textContent = cur.label;
        }
      } else if (s.engine === "neuro" && s.mode === "polyrhythm") {
        const pace = (s.defaultPaceSec || 0.65) / this.paceMult;
        const stepNo = Math.floor(rawT / pace);
        const slot = stepNo % 6;
        const hitL = s.leftBeats[slot], hitR = s.rightBeats[slot];
        this._cue(stepNo, hitL && hitR ? 528 : hitL ? 330 : hitR ? 432 : 0);
        if (this._lastDomKey !== slot) {
          this._lastDomKey = slot;
          this._polyL.forEach((el, i) => {
            const isNow = i === slot;
            el.classList.toggle("now", isNow);
            el.style.background = isNow && s.leftBeats[i] ? EYE_COLOR : "";
            el.style.borderColor = isNow && s.leftBeats[i] ? EYE_COLOR : "";
          });
          this._polyR.forEach((el, i) => {
            const isNow = i === slot;
            el.classList.toggle("now", isNow);
            el.style.background = isNow && s.rightBeats[i] ? s.accent : "";
            el.style.borderColor = isNow && s.rightBeats[i] ? s.accent : "";
          });
        }
      } else if (s.engine === "path") {
        if (s.mode === "infinity") {
          const pt = (a) => [130 + 92 * Math.sin(a), 95 + 45 * Math.sin(2 * a)];
          const a = t * 0.95;
          const [x, y] = pt(a);
          const [x1, y1] = pt(a - 0.14);
          const [x2, y2] = pt(a - 0.3);
          const setP = (sel, px, py) => {
            const el = this.el.querySelector(sel);
            if (el) { el.setAttribute("cx", px.toFixed(1)); el.setAttribute("cy", py.toFixed(1)); }
          };
          setP("#vz-pdot", x, y);
          setP("#vz-pt1", x1, y1);
          setP("#vz-pt2", x2, y2);
        } else if (s.mode === "dual") {
          const a = t * 1.1;
          this.el.querySelector("#vz-dl").setAttribute("cx", (72 + 42 * Math.cos(a)).toFixed(1));
          this.el.querySelector("#vz-dl").setAttribute("cy", (95 + 42 * Math.sin(a)).toFixed(1));
          const p = ((t * 0.42) % 1) * 4;
          const side = Math.floor(p), f = p - side;
          let rx = 148, ry = 53;
          if (side === 0) { rx = 148 + f * 84; ry = 53; }
          else if (side === 1) { rx = 232; ry = 53 + f * 84; }
          else if (side === 2) { rx = 232 - f * 84; ry = 137; }
          else { rx = 148; ry = 137 - f * 84; }
          this.el.querySelector("#vz-dr").setAttribute("cx", rx.toFixed(1));
          this.el.querySelector("#vz-dr").setAttribute("cy", ry.toFixed(1));
        } else {
          ["#vz-j1", "#vz-j2", "#vz-j3"].forEach((sel, i) => {
            const u = (t * 0.58 + i / 3) % 1;
            const x = 60 + 140 * (u < 0.5 ? u * 2 : (1 - u) * 2);
            const h = Math.sin(u * Math.PI * 2);
            const y = 145 - Math.abs(h) * 105;
            const el = this.el.querySelector(sel);
            if (el) { el.setAttribute("cx", x.toFixed(1)); el.setAttribute("cy", y.toFixed(1)); }
          });
        }
      } else if (s.engine === "eye") {
        let tx = 130, ty = 90, tr = 8.5, showTrails = false;
        if (s.mode === "saccade") {
          const pace = (s.defaultPaceSec || 1.2) / this.paceMult;
          const pts = [[46, 90], [214, 90], [46, 42], [214, 138], [214, 42], [46, 138]];
          const k = Math.floor(rawT / pace);
          this._cue(k, 460);
          [tx, ty] = pts[k % pts.length];
          showTrails = true;
        } else if (s.mode === "smooth") {
          tx = 130 + 82 * Math.sin(t * 0.72);
          ty = 90 + 34 * Math.sin(t * 1.44);
          showTrails = true;
        } else if (s.mode === "depth") {
          const pace = (s.defaultPaceSec || 4.0) / this.paceMult;
          const stepNo = Math.floor(rawT / pace);
          const near = stepNo % 2 === 0;
          this._cue(stepNo, near ? 432 : 324);
          tr = near ? 19 : 5.5;
          const p1 = this.el.querySelector("#vz-eperi");
          if (p1) {
            p1.setAttribute("opacity", near ? "0.35" : "0.14");
            p1.setAttribute("r", (near ? 44 : 66).toFixed(1));
          }
          this.el.querySelector("#vz-elbl").textContent = near
            ? "Ближний фокус (20–30 см · резкость на пальце)"
            : "Дальний фокус (окно / горизонт · расслабь глаза)";
        } else if (s.mode === "panorama") {
          const w1 = 0.5 + 0.5 * Math.sin(rawT * 0.55);
          const w2 = 0.5 + 0.5 * Math.sin(rawT * 0.55 - 1.2);
          const p1 = this.el.querySelector("#vz-eperi");
          const p2 = this.el.querySelector("#vz-eperi2");
          if (p1) {
            p1.setAttribute("opacity", (0.18 + 0.42 * w1).toFixed(2));
            p1.setAttribute("r", (40 + w1 * 26).toFixed(1));
          }
          if (p2) {
            p2.setAttribute("opacity", (0.1 + 0.28 * w2).toFixed(2));
            p2.setAttribute("r", (56 + w2 * 22).toFixed(1));
          }
          tr = 6.5;
        } else if (s.mode === "flame" || s.mode === "sun") {
          tr = 11 + Math.sin(rawT * 1.5) * 1.4 + Math.sin(rawT * 3.1) * 0.5;
        } else {
          tr = 8 + Math.sin(rawT * 1.6) * 1.2;
        }

        const st = this._state;
        const spd = s.mode === "saccade" ? 13 : s.mode === "depth" ? 3.8 : 9.0;
        st.ex = lerpExp(st.ex, tx, spd, dt);
        st.ey = lerpExp(st.ey, ty, spd, dt);
        st.r = lerpExp(st.r, tr, 4.5, dt);

        st.eyeTrail[0][0] = lerpExp(st.eyeTrail[0][0], st.ex, 7.5, dt);
        st.eyeTrail[0][1] = lerpExp(st.eyeTrail[0][1], st.ey, 7.5, dt);
        st.eyeTrail[1][0] = lerpExp(st.eyeTrail[1][0], st.eyeTrail[0][0], 5.5, dt);
        st.eyeTrail[1][1] = lerpExp(st.eyeTrail[1][1], st.eyeTrail[0][1], 5.5, dt);

        const et1 = this.el.querySelector("#vz-et1");
        const et2 = this.el.querySelector("#vz-et2");
        if (et1 && et2) {
          et1.setAttribute("opacity", showTrails ? "0.34" : "0");
          et2.setAttribute("opacity", showTrails ? "0.18" : "0");
          et1.setAttribute("cx", st.eyeTrail[0][0].toFixed(1));
          et1.setAttribute("cy", st.eyeTrail[0][1].toFixed(1));
          et2.setAttribute("cx", st.eyeTrail[1][0].toFixed(1));
          et2.setAttribute("cy", st.eyeTrail[1][1].toFixed(1));
        }

        this.el.querySelector("#vz-edot").setAttribute("cx", st.ex.toFixed(1));
        this.el.querySelector("#vz-edot").setAttribute("cy", st.ey.toFixed(1));
        this.el.querySelector("#vz-edot").setAttribute("r", st.r.toFixed(1));
        this.el.querySelector("#vz-eglow").setAttribute("cx", st.ex.toFixed(1));
        this.el.querySelector("#vz-eglow").setAttribute("cy", st.ey.toFixed(1));
        this.el.querySelector("#vz-eglow").setAttribute("r", (st.r + 14).toFixed(1));
      } else if (s.engine === "sound") {
        const rings = ["#sr-1", "#sr-2", "#sr-3"];
        const labels = ["Ближний круг · дыхание и тело", "Средний круг · звуки комнаты", "Дальний круг · звуки снаружи"];
        const idx = Math.floor(rawT / 8) % 3;
        rings.forEach((sel, i) => {
          const active = s.mode === "field" || i === idx;
          const el = this.el.querySelector(sel);
          if (el) el.setAttribute("opacity", active ? (0.48 + 0.3 * Math.sin(rawT * 1.4 + i)).toFixed(2) : "0.12");
        });
        const wave = this.el.querySelector("#sr-wave");
        if (wave) {
          const u = (rawT * 0.28) % 1;
          wave.setAttribute("r", (14 + u * 66).toFixed(1));
          wave.setAttribute("opacity", ((1 - u) * 0.42).toFixed(2));
        }
        if (s.mode === "radar") {
          const ang = rawT * 0.55;
          const px = 130 + 52 * Math.cos(ang);
          const py = 92 + 52 * Math.sin(ang);
          const ping = this.el.querySelector("#sr-ping");
          const pglow = this.el.querySelector("#sr-ping-glow");
          ping.setAttribute("opacity", "0.92");
          ping.setAttribute("cx", px.toFixed(1));
          ping.setAttribute("cy", py.toFixed(1));
          if (pglow) { pglow.setAttribute("opacity", "0.24"); pglow.setAttribute("cx", px.toFixed(1)); pglow.setAttribute("cy", py.toFixed(1)); }
          this.el.querySelector("#vz-slbl").textContent = "Найди самый тихий источник звука в пространстве";
        } else {
          this.el.querySelector("#vz-slbl").textContent = s.mode === "field" ? "Слушай всё звуковое пространство целиком" : labels[idx];
        }
      } else if (s.engine === "body") {
        const scan = this.el.querySelector("#vz-scan");
        const bodyg = this.el.querySelector("#vz-bodyg");
        if (s.mode === "shake") {
          const dx = Math.sin(rawT * 24) * 3.2;
          bodyg.setAttribute("transform", `translate(${dx.toFixed(1)}, 0)`);
          scan.setAttribute("opacity", "0.14");
        } else if (s.mode === "tense_release") {
          const cycle = rawT % 15;
          const tense = cycle < 5;
          this._cue(Math.floor(rawT / 5) % 3 === 0 ? 1 : 0, tense ? 432 : 288);
          const targetY = 48 + ((Math.floor(rawT / 15) % 4) * 32);
          this._state.scanY = lerpExp(this._state.scanY, targetY, 4.5, dt);
          scan.setAttribute("fill", tense ? "#e8c37c" : BREATH_COLOR);
          scan.setAttribute("opacity", tense ? "0.48" : "0.32");
          scan.setAttribute("y", this._state.scanY.toFixed(1));
          this.el.querySelector("#vz-blbl").textContent = tense
            ? `Мягко напряги зону (${Math.ceil(5 - cycle)} с)`
            : `Полностью отпусти в опору (${Math.ceil(15 - cycle)} с)`;
        } else if (s.mode === "feet") {
          scan.setAttribute("y", "152");
          scan.setAttribute("opacity", (0.26 + 0.3 * (0.5 + 0.5 * Math.sin(rawT * 1.1))).toFixed(2));
        } else if (s.mode === "balance") {
          const ang = Math.sin(rawT * 0.7) * 2.4;
          bodyg.setAttribute("transform", `rotate(${ang.toFixed(1)} 130 164)`);
          scan.setAttribute("y", "156");
        } else {
          const zones = ["Стопы и опора", "Голени и колени", "Таз и поясница", "Живот и дыхание", "Грудь и плечи", "Шея и лицо"];
          const u = (rawT % 28) / 28;
          const y = 154 - easeInOutSine(u) * 124;
          scan.setAttribute("y", y.toFixed(1));
          this.el.querySelector("#vz-blbl").textContent = `Зона: ${zones[Math.min(5, Math.floor(u * 6))]}`;
        }
      } else if (s.engine === "attention" && s.mode !== "sevens") {
        const badge = this.el.querySelector("#vz-abadge");
        const title = this.el.querySelector("#vz-atitle");
        const sub = this.el.querySelector("#vz-asub");
        if (s.mode === "ground54321") {
          const steps = [
            ["5", "НАЙДИ 5 ВЕЩЕЙ ГЛАЗАМИ", "Назови их про себя спокойно"],
            ["4", "ОЩУТИ 4 ПРИКОСНОВЕНИЯ", "Одежда, стул, стопы, воздух"],
            ["3", "УСЛЫШЬ 3 РАЗНЫХ ЗВУКА", "Даже самые тихие"],
            ["2", "ЗАМЕТЬ 2 ЗАПАХА", "Или свежесть воздуха на вдохе"],
            ["1", "ОЩУТИ 1 ВКУС / ОПОРУ", "Спокойный выдох — ты здесь"],
          ];
          const k = Math.floor(rawT / 14) % 5;
          this._cue(k, 396 + k * 24);
          if (this._lastDomKey !== k) {
            this._lastDomKey = k;
            [badge.textContent, title.textContent, sub.textContent] = steps[k];
          }
        } else if (s.mode === "ace") {
          const steps = [
            ["A", "ПРИЗНАЙ (Acknowledge)", "Отметь мысль или чувство без борьбы"],
            ["C", "ВЕРНИСЬ В ТЕЛО (Come back)", "Надави стопами в пол, расправь плечи"],
            ["E", "ВКЛЮЧИСЬ В МИР (Engage)", "Осмотри комнату и сделай один шаг"],
          ];
          const k = Math.floor(rawT / 12) % 3;
          if (this._lastDomKey !== k) {
            this._lastDomKey = k;
            [badge.textContent, title.textContent, sub.textContent] = steps[k];
          }
        } else if (s.mode === "deconc") {
          if (this._lastDomKey !== 1) {
            this._lastDomKey = 1;
            badge.textContent = "◎";
            title.textContent = "ВСЕ КАНАЛЫ ОДНОВРЕМЕННО";
            sub.textContent = "Удерживай равномерный фон без фиксации на одной детали";
          }
        } else if (s.mode === "labels") {
          const k = Math.floor(rawT / 7) % s.words.length;
          if (this._lastDomKey !== k) {
            this._lastDomKey = k;
            badge.textContent = "🏷";
            title.textContent = s.words[k];
            sub.textContent = "Замечай и называй коротко одним спокойным словом";
          }
        } else {
          if (this._lastDomKey !== 2) {
            this._lastDomKey = 2;
            badge.textContent = "⚖️";
            title.textContent = "УДЕРЖИВАЙ ДВА ПОТОКА";
            sub.textContent = "Ровное дыхание на фоне + спокойный счёт";
          }
        }
      } else if (s.engine === "deep") {
        const korb = this.el.querySelector("#vz-korb");
        const outer = this.el.querySelector("#vz-deep-outer");
        if (korb) korb.setAttribute("r", (54 + Math.sin(rawT * 0.42) * 5).toFixed(1));
        if (outer) {
          outer.setAttribute("r", (68 + Math.sin(rawT * 0.42 - 0.8) * 6).toFixed(1));
          outer.setAttribute("opacity", (0.14 + 0.14 * (0.5 + 0.5 * Math.sin(rawT * 0.42))).toFixed(2));
        }
      }
    }
  }

  window.DSMVisualizer = { PracticeVisualizer, SPECS };
})();
