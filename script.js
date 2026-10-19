(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cockpit = $('cockpit');
  var menu = $('settingsMenu');
  var hint = $('settingsHint');
  var closeSettings = $('closeSettings');

  var STORAGE_KEY = 'speedoHudLayout';
  var SPEED_LIMIT_MPH = 60;   // Batas overspeed 60 MPH (~97 KM/H)
  var EXTREME_SPEED_MPH = 85; // Batas kecepatan ekstrem (>= 85 MPH)
  var MAX_DIAL_SPEED = 280;   // Skala maksimum dial tengah (0 - 280)
  var THEMES = ['theme-white', 'theme-pink', 'theme-yellow'];

  /* ================= DAFTAR 9 STASIUN RADIO FM BAWAAN ================= */
  var RADIO_STORAGE_KEY = 'samc_radio_custom_stations_v1';
  var defaultStations = [
    { name: "Delta FM", url: "https://s1.cloudmu.id/listen/delta_fm/radio.mp3", isCustom: false },
    { name: "Prambors FM", url: "https://s2.cloudmu.id/listen/prambors/radio.aac", isCustom: false },
    { name: "I Radio", url: "https://stream.radiojar.com/4ywdgup3bnzuv", isCustom: false },
    { name: "Female Radio", url: "https://s1.cloudmu.id/listen/female_radio/radio.mp3", isCustom: false },
    { name: "KPOP Radio", url: "https://stream9.mexiserver.com:7122/stream", isCustom: false },
    { name: "Kiss FM", url: "https://live.kissfmmedan.com/kissfm.mp3", isCustom: false },
    { name: "JGRP Radio", url: "https://s7.alhastream.com/radio/8350/live", isCustom: false },
    { name: "Hits Radio", url: "https://playerservices.streamtheworld.com/api/livestream-redirect/977_HITS_SC", isCustom: false },
    { name: "Hits Love", url: "https://radio2.vip-radios.fm:18012/stream-128kmp3-HitsLove", isCustom: false }
  ];
  var customStations = [];
  var stations = defaultStations.slice();

  /* ================= STATE & FALLBACK TARGETS ================= */
  var S = {
    engine: false,
    speed: 0,
    speedMS: 0,
    speedMode: 1, // Default/prioritas 1: MPH (0: KMH, 1: MPH, 2: Knots)
    rpm: 0,
    fuel: 100,
    health: 100,
    gear: 'N',
    lights: 0,
    left: false,
    right: false,
    belt: false,
    locked: false,
    odo: 0
  };

  var L = { tx: 0, ty: 0, scale: 1, theme: 0 };
  var mode = null;
  var prevEngineState = false;
  var prevLockedState = null;
  var popTimer = null;
  var lockSnapTimer = null;
  var greetingTimer = null;

  var elements = {
    engine: $('engine'),
    speed: $('speed'),
    rpm: $('rpm'),
    fuel: $('fuel'),
    health: $('health'),
    gear: $('gear'),
    headlights: $('headlights'),
    indicators: $('indicators'),
    seatbelts: $('seatbelts'),
    odometer: $('odometer')
  };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function num(v, d) { v = Number(v); return isNaN(v) ? (d || 0) : v; }
  var onOrOff = function (s) { return s ? 'On' : 'Off'; };

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = String(value);
  }

  // Notifikasi singkat internal di dalam layar HUD
  var hudNoticeTimer = null;
  function showHudNotice(message) {
    var el = $('hudNotice');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(hudNoticeTimer);
    hudNoticeTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2600);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /* ================= GENERATE SKALA DIAL SPEEDOMETER UTAMA (0 - 280) ================= */
  function buildSpeedometerScale() {
    var ticksGroup = $('speedoTicksGroup');
    var numsGroup = $('speedoNumsGroup');
    if (!ticksGroup || !numsGroup) return;

    ticksGroup.innerHTML = '';
    numsGroup.innerHTML = '';

    var ns = 'http://www.w3.org/2000/svg';
    var cx = 140, cy = 140;
    var startAngle = -210; // Posisi angka 0 (kiri bawah)
    var endAngle = 30;     // Posisi angka 280 (kanan bawah), rentang 240 derajat
    var totalRange = endAngle - startAngle; // 240

    for (var val = 0; val <= MAX_DIAL_SPEED; val += 5) {
      var ratio = val / MAX_DIAL_SPEED;
      var deg = startAngle + ratio * totalRange;
      var rad = (deg * Math.PI) / 180;

      var isMajor = (val % 20 === 0);
      var isMedium = (val % 10 === 0 && !isMajor);
      var isRedzone = (val >= 220);

      var rOuter = 110;
      var rInner = isMajor ? 99 : (isMedium ? 103 : 106);

      var x1 = cx + rOuter * Math.cos(rad);
      var y1 = cy + rOuter * Math.sin(rad);
      var x2 = cx + rInner * Math.cos(rad);
      var y2 = cy + rInner * Math.sin(rad);

      var line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x1.toFixed(2));
      line.setAttribute('y1', y1.toFixed(2));
      line.setAttribute('x2', x2.toFixed(2));
      line.setAttribute('y2', y2.toFixed(2));
      line.setAttribute('class', 'speedo-tick' + (isMajor ? ' major' : '') + (isRedzone ? ' redzone' : ''));
      ticksGroup.appendChild(line);

      if (isMajor) {
        var rText = 86;
        var tx = cx + rText * Math.cos(rad);
        var ty = cy + rText * Math.sin(rad);

        var txt = document.createElementNS(ns, 'text');
        txt.setAttribute('x', tx.toFixed(2));
        txt.setAttribute('y', ty.toFixed(2));
        txt.setAttribute('class', 'speedo-scale-num' + (isRedzone ? ' redzone' : ''));
        txt.textContent = String(val);
        numsGroup.appendChild(txt);
      }
    }
  }

  /* ================= JAM DIGITAL REAL-TIME ================= */
  function updateClusterClock() {
    var el = $('clockDisplay');
    if (!el) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    el.textContent = hh + ':' + mm;
  }

  /* ================= ANIMASI & SUARA SAMBUTAN "Hello Alonica" ================= */
  var alonicaAudio = new Audio('hello_alonica.mp3');
  alonicaAudio.preload = 'auto';

  function speakHelloAlonicaFallback() {
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance('Hello Alonica');
      utter.pitch = 1.38;
      utter.rate = 0.96;
      utter.volume = 0.95;
      utter.lang = 'en-US';

      var voices = window.speechSynthesis.getVoices() || [];
      var preferredKeywords = [
        'Google US English',
        'Google UK English Female',
        'Microsoft Zira',
        'Samantha',
        'Victoria',
        'Karen',
        'Female'
      ];

      var chosenVoice = null;
      for (var i = 0; i < preferredKeywords.length && !chosenVoice; i++) {
        var kw = preferredKeywords[i].toLowerCase();
        chosenVoice = voices.find(function (v) {
          return v && v.name && v.name.toLowerCase().indexOf(kw) !== -1;
        });
      }
      if (!chosenVoice) {
        chosenVoice = voices.find(function (v) {
          return v && /^en(-|_)/i.test(v.lang || '');
        });
      }
      if (chosenVoice) {
        utter.voice = chosenVoice;
      }

      window.speechSynthesis.speak(utter);
    } catch (_) {}
  }

  function speakHelloAlonica() {
    try {
      alonicaAudio.currentTime = 0;
      var playPromise = alonicaAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch(function () {
          speakHelloAlonicaFallback();
        });
      }
    } catch (_) {
      speakHelloAlonicaFallback();
    }
  }

  function triggerAlonicaGreeting() {
    var banner = $('alonicaGreeting');
    if (banner) banner.classList.add('show');
    cockpit.classList.add('greeting-active');

    speakHelloAlonica();

    if (greetingTimer) clearTimeout(greetingTimer);
    greetingTimer = setTimeout(function () {
      if (banner) banner.classList.remove('show');
      cockpit.classList.remove('greeting-active');
    }, 3200);
  }

  window.triggerAlonicaGreeting = triggerAlonicaGreeting;
  window.speakHelloAlonica = speakHelloAlonica;

  function setupKittyBowGreeting() {
    if ('speechSynthesis' in window && typeof window.speechSynthesis.getVoices === 'function') {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = function () {
        window.speechSynthesis.getVoices();
      };
    }

    var bow = $('kittyBow');
    if (!bow) return;
    bow.addEventListener('click', function (e) {
      e.stopPropagation();
      triggerAlonicaGreeting();
    });
    bow.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        triggerAlonicaGreeting();
      }
    });
  }

  /* ================= CHIME SEATBELT LEMBUT (MARIMBA D5 - A5) ================= */
  var audioCtx = null;
  var beltBeepTimer = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playBeltChime() {
    if (S.belt || !S.engine) return;
    try {
      var ctx = getAudioContext();
      var now = ctx.currentTime;
      var notes = [
        { freq: 587, delay: 0.0, dur: 0.24 },
        { freq: 880, delay: 0.19, dur: 0.34 }
      ];

      notes.forEach(function (n) {
        var osc = ctx.createOscillator();
        var sub = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.type = 'sine';
        sub.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, now + n.delay);
        sub.frequency.setValueAtTime(n.freq * 2, now + n.delay);

        gain.gain.setValueAtTime(0.0001, now + n.delay);
        gain.gain.linearRampToValueAtTime(0.075, now + n.delay + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.delay + n.dur);

        osc.connect(gain);
        sub.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + n.delay);
        sub.start(now + n.delay);
        osc.stop(now + n.delay + n.dur + 0.02);
        sub.stop(now + n.delay + n.dur + 0.02);
      });
    } catch (e) {}
  }

  function updateBeltBeep() {
    if (!S.belt && S.engine) {
      if (!beltBeepTimer) {
        playBeltChime();
        beltBeepTimer = setInterval(playBeltChime, 2200);
      }
    } else {
      if (beltBeepTimer) {
        clearInterval(beltBeepTimer);
        beltBeepTimer = null;
      }
    }
  }

  /* ================= SINKRONISASI AUDIO, MINI PILL & ANTI-BENTROK ================= */
  var radioAudio = new Audio();
  radioAudio.preload = 'none';
  radioAudio.crossOrigin = 'anonymous';
  var currentStationIndex = 0;
  var isRadioPlaying = false;

  var MUSIC_STORAGE_KEY = 'samc_music_playlist_v1';
  var musicPlayer = null;
  var musicApiReady = false;
  var musicReady = false;
  var musicPlaylist = [];
  var musicIndex = -1;
  var musicRepeat = false;
  var musicShuffle = false;
  var musicProgressTimer = null;
  var musicPendingLoad = null;

  var activeAudioSource = 'radio';
  var hasAudioActivated = false;
  var miniPillDismissed = false;

  function isYouTubePlaying() {
    if (!musicPlayer || !musicReady || typeof musicPlayer.getPlayerState !== 'function') return false;
    return musicPlayer.getPlayerState() === 1;
  }

  function updateMiniPill() {
    var pill = $('mini-music-pill');
    if (!pill) return;

    var ytPlaying = isYouTubePlaying();
    var anyPlaying = isRadioPlaying || ytPlaying;

    if (isRadioPlaying) {
      activeAudioSource = 'radio';
      hasAudioActivated = true;
      miniPillDismissed = false;
    } else if (ytPlaying) {
      activeAudioSource = 'youtube';
      hasAudioActivated = true;
      miniPillDismissed = false;
    }

    var shouldShow = hasAudioActivated && !miniPillDismissed;
    pill.classList.toggle('show', shouldShow);
    pill.classList.toggle('playing', anyPlaying);

    var badge = $('miniSourceBadge');
    if (badge) {
      if (activeAudioSource === 'youtube') {
        badge.textContent = '▶ YT';
        badge.className = 'mini-source-badge yt-mode';
      } else {
        badge.textContent = '📻 RADIO';
        badge.className = 'mini-source-badge radio-mode';
      }
    }

    var titleEl = $('miniTrackTitle');
    if (titleEl) {
      if (activeAudioSource === 'youtube') {
        var track = musicPlaylist[musicIndex];
        titleEl.textContent = track ? track.title : 'YouTube Track';
      } else {
        var st = stations[currentStationIndex] || stations[0];
        titleEl.textContent = st ? st.name : 'Radio FM';
      }
    }

    var playBtn = $('btn-mini-play');
    if (playBtn) {
      playBtn.textContent = anyPlaying ? '❚❚' : '▶';
    }
  }

  function syncAudioVisualPulse() {
    var anyPlaying = isRadioPlaying || isYouTubePlaying();
    cockpit.classList.toggle('music-playing', anyPlaying);
    cockpit.classList.toggle('radio-active', isRadioPlaying);
    updateMiniPill();
  }

  function pauseYouTubeIfNeeded() {
    if (musicPlayer && musicReady && typeof musicPlayer.pauseVideo === 'function') {
      try {
        var st = musicPlayer.getPlayerState();
        if (st === 1 || st === 3) {
          musicPlayer.pauseVideo();
        }
      } catch (_) {}
    }
    updateMusicPlayButton();
    syncAudioVisualPulse();
  }

  function pauseRadioIfNeeded() {
    if (!radioAudio.paused || isRadioPlaying) {
      radioAudio.pause();
      isRadioPlaying = false;
      updateRadioUI('Paused');
    }
    syncAudioVisualPulse();
  }

  /* ================= TAB 1: LIVE RADIO FM STREAMING ================= */
  function rebuildStationsList() {
    stations = defaultStations.concat(customStations);
    if (currentStationIndex >= stations.length) {
      currentStationIndex = Math.max(0, stations.length - 1);
    }
  }

  function loadCustomRadioStations() {
    try {
      var raw = localStorage.getItem(RADIO_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        customStations = parsed
          .filter(function (item) { return item && item.url; })
          .map(function (item) {
            return {
              name: String(item.name || 'Custom Radio'),
              url: String(item.url).trim(),
              isCustom: true
            };
          });
      }
    } catch (_) {
      customStations = [];
    }
    rebuildStationsList();
  }

  function saveCustomRadioStations() {
    try {
      localStorage.setItem(RADIO_STORAGE_KEY, JSON.stringify(customStations));
    } catch (_) {}
  }

  function extractRadioStreamUrl(input) {
    var raw = String(input || '').trim();
    if (!raw) return null;
    try {
      var url = new URL(raw);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.href;
      }
    } catch (_) {}
    return null;
  }

  function renderRadioSelectAndPlaylist() {
    var select = $('stationSelect');
    if (select) {
      select.innerHTML = '';
      stations.forEach(function (st, idx) {
        var opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = (idx + 1) + '. ' + st.name + (st.isCustom ? ' ★' : '');
        select.appendChild(opt);
      });
      select.value = String(currentStationIndex);
    }

    var list = $('radio-playlist');
    if (!list) return;
    list.innerHTML = '';

    stations.forEach(function (st, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row' + (index === currentStationIndex ? ' active' : '');

      var badgeClass = st.isCustom ? 'radio-track-badge custom' : 'radio-track-badge';
      var badgeText = st.isCustom ? 'CUSTOM' : 'FM';
      var delBtnHtml = st.isCustom
        ? '<span class="track-del-btn" data-del-radio="' + (index - defaultStations.length) + '" title="Hapus saluran ini">×</span>'
        : '';

      row.innerHTML =
        '<span class="' + badgeClass + '">' + badgeText + '</span>' +
        '<span class="music-track-copy"><strong>' + escapeHtml(st.name) + '</strong></span>' +
        '<span class="music-track-index">' + String(index + 1).padStart(2, '0') + '</span>' +
        delBtnHtml;

      row.addEventListener('click', function (e) {
        e.stopPropagation();
        var delTarget = e.target.closest('[data-del-radio]');
        if (delTarget) {
          var customIdx = Number(delTarget.getAttribute('data-del-radio'));
          removeCustomRadioStation(customIdx);
          return;
        }
        loadAndPlayRadio(index);
      });

      list.appendChild(row);
    });
  }

  function addCustomRadioStation(urlInput, nameInput) {
    var validUrl = extractRadioStreamUrl(urlInput);
    if (!validUrl) {
      showHudNotice('Link radio tidak valid');
      return false;
    }

    var existingIndex = stations.findIndex(function (item) {
      return item.url.toLowerCase() === validUrl.toLowerCase();
    });

    if (existingIndex !== -1) {
      loadAndPlayRadio(existingIndex);
      return true;
    }

    var defaultTitle = 'Radio • ' + (customStations.length + 1);
    try {
      var host = new URL(validUrl).hostname.replace(/^www\./i, '');
      if (host) defaultTitle = 'Radio • ' + host;
    } catch (_) {}

    var stationTitle = String(nameInput || '').trim() || defaultTitle;
    customStations.push({
      name: stationTitle,
      url: validUrl,
      isCustom: true
    });

    saveCustomRadioStations();
    rebuildStationsList();
    currentStationIndex = stations.length - 1;
    renderRadioSelectAndPlaylist();
    loadAndPlayRadio(currentStationIndex);
    return true;
  }

  function removeCustomRadioStation(customIdx) {
    if (customIdx < 0 || customIdx >= customStations.length) return;
    var removedGlobalIdx = defaultStations.length + customIdx;
    var wasPlayingRemoved = (currentStationIndex === removedGlobalIdx);

    customStations.splice(customIdx, 1);
    saveCustomRadioStations();
    rebuildStationsList();

    if (wasPlayingRemoved) {
      currentStationIndex = 0;
      if (isRadioPlaying) {
        loadAndPlayRadio(0);
      } else {
        radioAudio.pause();
        radioAudio.removeAttribute('src');
        updateRadioUI('Stopped');
      }
    } else if (currentStationIndex > removedGlobalIdx) {
      currentStationIndex--;
    }

    renderRadioSelectAndPlaylist();
    updateRadioUI();
  }

  function updateRadioUI(statusText) {
    var st = stations[currentStationIndex] || stations[0];
    if (st) setText('stationName', st.name);
    if (statusText) setText('radioStatus', statusText);
    var select = $('stationSelect');
    if (select && Number(select.value) !== currentStationIndex) {
      select.value = String(currentStationIndex);
    }
    var playBtn = $('btn-radio-play');
    if (playBtn) {
      playBtn.textContent = isRadioPlaying ? '❚❚' : '▶';
    }
    renderRadioSelectAndPlaylist();
    syncAudioVisualPulse();
  }

  function loadAndPlayRadio(index) {
    if (!stations.length) return;
    if (index < 0) index = stations.length - 1;
    if (index >= stations.length) index = 0;
    currentStationIndex = index;

    activeAudioSource = 'radio';
    hasAudioActivated = true;
    miniPillDismissed = false;

    pauseYouTubeIfNeeded();

    var st = stations[currentStationIndex];
    try {
      radioAudio.pause();
      radioAudio.src = st.url;
      radioAudio.load();
      isRadioPlaying = false;
      updateRadioUI('Loading...');

      var playPromise = radioAudio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(function () {
          isRadioPlaying = true;
          updateRadioUI('Now Playing');
        }).catch(function () {
          isRadioPlaying = false;
          updateRadioUI('Stream Error / Offline');
        });
      }
    } catch (e) {
      isRadioPlaying = false;
      updateRadioUI('Stopped');
    }
  }

  function toggleRadioPlayback() {
    activeAudioSource = 'radio';
    hasAudioActivated = true;
    miniPillDismissed = false;

    if (isRadioPlaying && !radioAudio.paused) {
      radioAudio.pause();
      isRadioPlaying = false;
      updateRadioUI('Paused');
    } else {
      if (!radioAudio.src) {
        loadAndPlayRadio(currentStationIndex);
      } else {
        pauseYouTubeIfNeeded();
        updateRadioUI('Loading...');
        radioAudio.play().then(function () {
          isRadioPlaying = true;
          updateRadioUI('Now Playing');
        }).catch(function () {
          loadAndPlayRadio(currentStationIndex);
        });
      }
    }
  }

  function setupRadioPlayer() {
    var select = $('stationSelect');
    var prevBtn = $('btn-radio-prev');
    var playBtn = $('btn-radio-play');
    var nextBtn = $('btn-radio-next');
    var muteBtn = $('btn-radio-mute');
    var volSlider = $('radio-volume');
    var volLabel = $('radio-volume-label');
    var addToggle = $('btn-radio-add-toggle');
    var addRow = $('radio-add-row');
    var addBtn = $('btn-radio-add');
    var urlInput = $('radio-url-input');
    var titleInput = $('radio-title-input');
    var clearBtn = $('btn-radio-clear');

    loadCustomRadioStations();
    renderRadioSelectAndPlaylist();

    if (select) {
      select.addEventListener('change', function (e) {
        e.stopPropagation();
        loadAndPlayRadio(Number(select.value));
      });
    }

    radioAudio.volume = 0.8;

    radioAudio.addEventListener('playing', function () {
      isRadioPlaying = true;
      updateRadioUI('Now Playing');
    });

    radioAudio.addEventListener('waiting', function () {
      updateRadioUI('Loading...');
    });

    radioAudio.addEventListener('pause', function () {
      if (isRadioPlaying) {
        isRadioPlaying = false;
        updateRadioUI('Paused');
      }
    });

    radioAudio.addEventListener('error', function () {
      isRadioPlaying = false;
      updateRadioUI('Stream Error / Offline');
    });

    if (playBtn) {
      playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleRadioPlayback();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        loadAndPlayRadio(currentStationIndex - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        loadAndPlayRadio(currentStationIndex + 1);
      });
    }

    if (volSlider) {
      volSlider.addEventListener('input', function () {
        var v = clamp(Number(volSlider.value), 0, 100);
        radioAudio.volume = v / 100;
        if (volLabel) volLabel.textContent = v + '%';
        if (v > 0 && radioAudio.muted) {
          radioAudio.muted = false;
          if (muteBtn) muteBtn.textContent = '🔊';
        }
      });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        radioAudio.muted = !radioAudio.muted;
        muteBtn.textContent = radioAudio.muted ? '🔇' : '🔊';
      });
    }

    if (addToggle) {
      addToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        addRow?.classList.toggle('hide');
        urlInput?.focus();
      });
    }

    var addRadioFromInputs = function () {
      if (addCustomRadioStation(urlInput?.value || '', titleInput?.value || '')) {
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
        addRow?.classList.add('hide');
      }
    };

    if (addBtn) addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      addRadioFromInputs();
    });

    [urlInput, titleInput].forEach(function (el) {
      el?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addRadioFromInputs();
        }
      });
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!customStations.length) return;
        customStations = [];
        saveCustomRadioStations();
        rebuildStationsList();
        if (currentStationIndex >= stations.length) {
          currentStationIndex = 0;
          if (isRadioPlaying) loadAndPlayRadio(0);
        }
        renderRadioSelectAndPlaylist();
        updateRadioUI();
      });
    }

    updateRadioUI('Stopped');
  }

  /* ================= TAB 2: YOUTUBE LINK & PLAYLIST ================= */
  function formatMusicTime(seconds) {
    var n = Math.max(0, Math.floor(Number(seconds) || 0));
    var m = Math.floor(n / 60);
    var s = String(n % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function extractYouTubeSource(input) {
    var raw = String(input || '').trim();
    if (!raw) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return { type: 'video', id: raw };
    try {
      var url = new URL(raw);
      var host = url.hostname.toLowerCase();
      var isYoutube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be');
      if (!isYoutube) return null;
      var watchId = url.searchParams.get('v');
      if (watchId && /^[a-zA-Z0-9_-]{11}$/.test(watchId)) return { type: 'video', id: watchId };
      var parts = url.pathname.split('/').filter(Boolean);
      var idx = parts.findIndex(function (p) { return ['embed', 'shorts', 'live'].includes(p); });
      if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) return { type: 'video', id: parts[idx + 1] };
      if (host === 'youtu.be' && parts[0] && /^[a-zA-Z0-9_-]{11}$/.test(parts[0])) return { type: 'video', id: parts[0] };
    } catch (_) {}
    return null;
  }

  function youtubeThumbnail(id) {
    return 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg';
  }

  function loadMusicPlaylist() {
    try {
      var raw = localStorage.getItem(MUSIC_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        musicPlaylist = parsed.filter(function (item) { return item && item.id; }).map(function (item) {
          return { id: String(item.id), title: String(item.title || 'YouTube Track') };
        });
      }
    } catch (_) {
      musicPlaylist = [];
    }
  }

  function saveMusicPlaylist() {
    try { localStorage.setItem(MUSIC_STORAGE_KEY, JSON.stringify(musicPlaylist)); } catch (_) {}
  }

  function renderMusicPlaylist() {
    var list = $('music-playlist');
    if (!list) return;
    list.innerHTML = '';
    if (!musicPlaylist.length) {
      var empty = document.createElement('div');
      empty.className = 'music-empty';
      empty.textContent = 'Playlist kosong. Tekan + untuk menambah lagu.';
      list.appendChild(empty);
      return;
    }
    musicPlaylist.forEach(function (track, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-track-row' + (index === musicIndex ? ' active' : '');
      row.innerHTML =
        '<span class="music-track-thumb"><img src="' + youtubeThumbnail(track.id) + '" alt=""></span>' +
        '<span class="music-track-copy"><strong>' + escapeHtml(track.title) + '</strong></span>' +
        '<span class="music-track-index">' + String(index + 1).padStart(2, '0') + '</span>';
      row.addEventListener('click', function () { playMusicIndex(index); });
      list.appendChild(row);
    });
  }

  function updateMusicMeta() {
    var title = $('music-track-title');
    var subtitle = $('music-track-subtitle');
    var cover = $('music-cover');
    var placeholder = $('music-player-placeholder');
    var track = musicPlaylist[musicIndex];

    if (title) title.textContent = track ? track.title : 'Belum ada lagu';
    if (subtitle) subtitle.textContent = track ? 'YouTube • Playing' : 'Online Playback';
    if (cover) {
      if (track) {
        cover.src = youtubeThumbnail(track.id);
        cover.classList.add('show');
        cover.onerror = function () { cover.classList.remove('show'); };
      } else {
        cover.removeAttribute('src');
        cover.classList.remove('show');
      }
    }
    if (placeholder) placeholder.classList.toggle('hide', !!track);
    renderMusicPlaylist();
    updateMiniPill();
  }

  function updateMusicPlayButton() {
    var btn = $('btn-music-play');
    if (!btn) return;
    var state = musicPlayer && typeof musicPlayer.getPlayerState === 'function' ? musicPlayer.getPlayerState() : -1;
    btn.textContent = state === 1 ? '❚❚' : '▶';
    syncAudioVisualPulse();
  }

  function startMusicProgressLoop() {
    if (musicProgressTimer) return;
    musicProgressTimer = setInterval(function () {
      if (!musicPlayer || !musicReady) return;
      var current = 0, duration = 0;
      try {
        current = Number(musicPlayer.getCurrentTime()) || 0;
        duration = Number(musicPlayer.getDuration()) || 0;
      } catch (_) { return; }
      var progress = $('music-progress');
      var now = $('music-current-time');
      var end = $('music-duration');
      if (now) now.textContent = formatMusicTime(current);
      if (end) end.textContent = formatMusicTime(duration);
      if (progress) progress.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
    }, 250);
  }

  function ensureYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      musicApiReady = true;
      initializeYouTubePlayer();
      return;
    }
    if (window.__samcYouTubeApiLoading) return;
    window.__samcYouTubeApiLoading = true;
    window.onYouTubeIframeAPIReady = function () {
      musicApiReady = true;
      initializeYouTubePlayer();
    };
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = function () {
      var subtitle = $('music-track-subtitle');
      if (subtitle) subtitle.textContent = 'API gagal dimuat. Cek koneksi internet.';
    };
    document.head.appendChild(tag);
  }

  function initializeYouTubePlayer() {
    if (!musicApiReady || musicPlayer || !$('youtube-player')) return;
    musicPlayer = new YT.Player('youtube-player', {
      width: '90',
      height: '52',
      videoId: musicPlaylist[0] ? musicPlaylist[0].id : '',
      playerVars: {
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        controls: 0,
        fs: 0,
        disablekb: 1,
        origin: window.location.origin
      },
      events: {
        onReady: function (event) {
          musicReady = true;
          event.target.setVolume(Number($('music-volume')?.value || 80));
          $('music-player-placeholder')?.classList.toggle('hide', !!musicPlaylist.length);
          updateMusicPlayButton();
          startMusicProgressLoop();
          if (musicPendingLoad !== null) {
            var pending = musicPendingLoad;
            musicPendingLoad = null;
            playMusicIndex(pending);
          }
        },
        onStateChange: function (event) {
          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
            activeAudioSource = 'youtube';
            hasAudioActivated = true;
            miniPillDismissed = false;
            pauseRadioIfNeeded();
          }
          updateMusicPlayButton();
          if (event.data === YT.PlayerState.ENDED) {
            playNextMusic(true);
          }
          var placeholder = $('music-player-placeholder');
          if (placeholder) placeholder.classList.toggle('hide', event.data !== YT.PlayerState.UNSTARTED || !musicPlaylist.length);
        },
        onError: function () {
          var subtitle = $('music-track-subtitle');
          if (subtitle) subtitle.textContent = 'Lagu diblokir / tidak dapat diputar.';
        }
      }
    });
  }

  function addMusicTrack(input, titleOverride) {
    var source = extractYouTubeSource(input);
    if (!source || source.type !== 'video') {
      showHudNotice('Link YouTube tidak valid');
      return false;
    }
    var title = String(titleOverride || '').trim() || ('YouTube • ' + source.id);
    var existing = musicPlaylist.findIndex(function (item) { return item.id === source.id; });
    if (existing === -1) {
      musicPlaylist.push({ id: source.id, title: title });
      musicIndex = musicPlaylist.length - 1;
    } else {
      musicIndex = existing;
    }
    saveMusicPlaylist();
    renderMusicPlaylist();
    updateMusicMeta();
    playMusicIndex(musicIndex);
    return true;
  }

  function playMusicIndex(index) {
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= musicPlaylist.length) return;
    activeAudioSource = 'youtube';
    hasAudioActivated = true;
    miniPillDismissed = false;
    pauseRadioIfNeeded();
    musicIndex = index;
    updateMusicMeta();

    if (!musicReady) {
      musicPendingLoad = index;
      ensureYouTubeAPI();
      return;
    }
    var track = musicPlaylist[index];
    try {
      musicPlayer.loadVideoById(track.id);
      musicPlayer.playVideo();
    } catch (_) {}

    $('music-player-placeholder')?.classList.add('hide');
  }

  function toggleMusicPlayback() {
    activeAudioSource = 'youtube';
    hasAudioActivated = true;
    miniPillDismissed = false;

    if (!musicReady) {
      if (!musicPlaylist.length) {
        menu.classList.add('open');
        $('tabBtnYoutube')?.click();
        $('music-add-row')?.classList.remove('hide');
        $('music-url-input')?.focus();
        return;
      }
      pauseRadioIfNeeded();
      ensureYouTubeAPI();
      if (musicIndex < 0) musicIndex = 0;
      musicPendingLoad = musicIndex;
      updateMiniPill();
      return;
    }
    var state = musicPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      musicPlayer.pauseVideo();
    } else {
      pauseRadioIfNeeded();
      musicPlayer.playVideo();
    }
  }

  function playNextMusic(auto) {
    if (!musicPlaylist.length) return;
    if (musicRepeat && musicIndex >= 0) {
      playMusicIndex(musicIndex);
      return;
    }
    var next;
    if (musicShuffle && musicPlaylist.length > 1) {
      do { next = Math.floor(Math.random() * musicPlaylist.length); } while (next === musicIndex);
    } else {
      next = musicIndex + 1;
      if (next >= musicPlaylist.length) {
        if (auto) next = 0;
        else return;
      }
    }
    playMusicIndex(next);
  }

  function playPrevMusic() {
    if (!musicPlaylist.length) return;
    var prev = musicIndex - 1;
    if (prev < 0) prev = musicPlaylist.length - 1;
    playMusicIndex(prev);
  }

  function setupAudioTabs() {
    var tabRadio = $('tabBtnRadio');
    var tabYoutube = $('tabBtnYoutube');
    var paneRadio = $('tabContentRadio');
    var paneYoutube = $('tabContentYoutube');

    function switchTab(target) {
      var isRadio = target === 'radio';
      tabRadio?.classList.toggle('active', isRadio);
      tabYoutube?.classList.toggle('active', !isRadio);
      tabRadio?.setAttribute('aria-selected', String(isRadio));
      tabYoutube?.setAttribute('aria-selected', String(!isRadio));
      paneRadio?.classList.toggle('active', isRadio);
      paneYoutube?.classList.toggle('active', !isRadio);
    }

    tabRadio?.addEventListener('click', function (e) {
      e.stopPropagation();
      switchTab('radio');
    });

    tabYoutube?.addEventListener('click', function (e) {
      e.stopPropagation();
      switchTab('youtube');
    });
  }

  function setupMiniAudioPill() {
    var prevBtn = $('btn-mini-prev');
    var playBtn = $('btn-mini-play');
    var nextBtn = $('btn-mini-next');
    var openBtn = $('btn-mini-open');
    var closeBtn = $('btn-mini-close');

    if (prevBtn) {
      prevBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (activeAudioSource === 'youtube') {
          playPrevMusic();
        } else {
          loadAndPlayRadio(currentStationIndex - 1);
        }
      });
    }

    if (playBtn) {
      playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (activeAudioSource === 'youtube') {
          toggleMusicPlayback();
        } else {
          toggleRadioPlayback();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (activeAudioSource === 'youtube') {
          playNextMusic(true);
        } else {
          loadAndPlayRadio(currentStationIndex + 1);
        }
      });
    }

    if (openBtn) {
      openBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        menu.classList.add('open');
        if (activeAudioSource === 'youtube') {
          $('tabBtnYoutube')?.click();
        } else {
          $('tabBtnRadio')?.click();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        miniPillDismissed = true;
        updateMiniPill();
      });
    }
  }

  function setupMusicPlayer() {
    setupAudioTabs();
    setupRadioPlayer();
    setupMiniAudioPill();

    var play = $('btn-music-play');
    var next = $('btn-music-next');
    var prev = $('btn-music-prev');
    var mute = $('btn-music-mute');
    var volume = $('music-volume');
    var progress = $('music-progress');
    var addToggle = $('btn-music-add-toggle');
    var addRow = $('music-add-row');
    var addBtn = $('btn-music-add');
    var urlInput = $('music-url-input');
    var titleInput = $('music-title-input');
    var clear = $('btn-music-clear');
    var repeat = $('btn-music-repeat');
    var shuffle = $('btn-music-shuffle');

    loadMusicPlaylist();
    musicIndex = musicPlaylist.length ? 0 : -1;
    renderMusicPlaylist();
    updateMusicMeta();
    startMusicProgressLoop();

    if (play) play.addEventListener('click', function (e) { e.stopPropagation(); toggleMusicPlayback(); });
    if (next) next.addEventListener('click', function (e) { e.stopPropagation(); playNextMusic(false); });
    if (prev) prev.addEventListener('click', function (e) { e.stopPropagation(); playPrevMusic(); });

    if (volume) volume.addEventListener('input', function () {
      if (musicPlayer && musicReady) musicPlayer.setVolume(Number(volume.value));
    });

    if (mute) mute.addEventListener('click', function () {
      if (!musicPlayer || !musicReady) return;
      if (musicPlayer.isMuted()) {
        musicPlayer.unMute();
        mute.textContent = '🔊';
      } else {
        musicPlayer.mute();
        mute.textContent = '🔇';
      }
    });

    if (progress) progress.addEventListener('input', function () {
      if (!musicPlayer || !musicReady) return;
      var duration = Number(musicPlayer.getDuration()) || 0;
      if (duration > 0) musicPlayer.seekTo((Number(progress.value) / 1000) * duration, true);
    });

    if (addToggle) addToggle.addEventListener('click', function () {
      addRow?.classList.toggle('hide');
      urlInput?.focus();
    });

    var addFromInputs = function () {
      if (addMusicTrack(urlInput?.value || '', titleInput?.value || '')) {
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
        addRow?.classList.add('hide');
      }
    };

    if (addBtn) addBtn.addEventListener('click', addFromInputs);
    [urlInput, titleInput].forEach(function (el) {
      el?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addFromInputs();
      });
    });

    if (clear) clear.addEventListener('click', function () {
      musicPlaylist = [];
      musicIndex = -1;
      saveMusicPlaylist();
      renderMusicPlaylist();
      updateMusicMeta();
      if (musicPlayer && musicReady) musicPlayer.stopVideo();
      syncAudioVisualPulse();
    });

    if (repeat) repeat.addEventListener('click', function () {
      musicRepeat = !musicRepeat;
      repeat.classList.toggle('active', musicRepeat);
    });

    if (shuffle) shuffle.addEventListener('click', function () {
      musicShuffle = !musicShuffle;
      shuffle.classList.toggle('active', musicShuffle);
    });

    if (musicPlaylist.length) ensureYouTubeAPI();
  }

  /* ================= HELPER SEGMEN BAR SAMPING (RPM, FUEL, HEALTH) ================= */
  function updateSideSegments(containerId, ratio, isTempBar) {
    var box = $(containerId);
    if (!box) return;
    var segs = box.querySelectorAll('.seg');
    var activeCount = Math.round(clamp(ratio, 0, 1) * segs.length);
    for (var i = 0; i < segs.length; i++) {
      var idx = Number(segs[i].getAttribute('data-idx')) || (segs.length - i);
      var isOn = idx <= activeCount;
      segs[i].classList.toggle('active', isOn);
      if (isTempBar) {
        segs[i].classList.toggle('hot', isOn && idx >= 4);
        segs[i].classList.toggle('cool', isOn && idx === 1);
      }
    }
  }

  /* ================= RENDER HUD ================= */
  function renderRPM() {
    var rpmClamped = clamp(S.rpm, 0, 8000);
    var progress = rpmClamped / 8000;

    // Kompatibilitas bar lama
    var fill = $('rpmFill');
    if (fill) fill.style.width = (progress * 100) + '%';

    // Dial Bulat RPM Kiri Bawah (Keliling busur 220)
    var ringFill = $('rpmRingFill');
    if (ringFill) {
      ringFill.setAttribute('stroke-dasharray', (progress * 220).toFixed(1) + ' 300');
    }

    // Angka Digital RPM (contoh: 850)
    setText('rpmTextValue', Math.round(rpmClamped));

    // Segmen Bar Samping Kiri Bawah
    updateSideSegments('rpmSideSegments', S.engine ? Math.max(0.2, progress) : 0, true);

    cockpit.classList.toggle('redline', progress > 0.85);
  }

  function renderSpeed() {
    var displaySpeed = Math.round(S.speed);
    setText('speedValue', String(displaySpeed).padStart(3, '0'));
    setText('speedUnit', S.speedMode === 1 ? 'MPH' : (S.speedMode === 2 ? 'KNOTS' : 'KM/H'));

    // Rotasi Jarum Speedometer Tengah (-120deg s/d +120deg untuk skala 0 - 280)
    var speedRatio = clamp(S.speed / MAX_DIAL_SPEED, 0, 1);
    var needleDeg = -120 + (speedRatio * 240);
    var needle = $('speedNeedleGroup');
    if (needle) {
      needle.setAttribute('transform', 'rotate(' + needleDeg.toFixed(2) + ' 140 140)');
    }

    // Busur Progress Neon Speedometer Tengah (Panjang penuh 240deg = 477.5)
    var arcFill = $('speedArcFill');
    if (arcFill) {
      arcFill.setAttribute('stroke-dasharray', (speedRatio * 477.5).toFixed(1) + ' 800');
    }

    var speedMPH = S.speedMode === 1 ? S.speed : (S.speedMS * 2.236936);
    var over60 = speedMPH >= SPEED_LIMIT_MPH;
    var over85 = speedMPH >= EXTREME_SPEED_MPH;

    cockpit.classList.toggle('overspeed', over60);
    cockpit.classList.toggle('extreme-speed', over85);
  }

  function renderGear() {
    setText('gearValue', S.gear);
  }

  function renderHeadlights() {
    var el = $('headlightIndicator');
    if (el) {
      el.classList.remove('active', 'low-beam', 'high-beam');
      if (S.lights === 1) {
        el.classList.add('active', 'low-beam');
        el.title = 'Headlights: Low Beam';
      } else if (S.lights === 2) {
        el.classList.add('active', 'high-beam');
        el.title = 'Headlights: High Beam';
      } else {
        el.title = 'Headlights: Off';
      }
    }
    cockpit.classList.toggle('lights-on', S.lights === 1 || S.lights === 2);
    cockpit.classList.toggle('high-beam', S.lights === 2);
    cockpit.classList.toggle('night-mode', S.lights === 1 || S.lights === 2);
  }

  function renderIndicators() {
    var leftEl = $('leftIndicator');
    var rightEl = $('rightIndicator');
    if (leftEl) leftEl.classList.toggle('active', S.left);
    if (rightEl) rightEl.classList.toggle('active', S.right);

    var hazard = S.left && S.right;
    cockpit.classList.toggle('hazard-active', hazard);
    cockpit.classList.toggle('look-left', S.left && !S.right);
    cockpit.classList.toggle('look-right', S.right && !S.left);
  }

  function renderOdometer() {
    var odoInt = Math.floor(Math.max(0, S.odo));
    setText('odometerValue', String(odoInt).padStart(6, '0'));
    setText('odoUnit', S.speedMode === 0 ? 'km' : 'mi');
  }

  function renderDoorLock() {
    var icon = $('doorLockIcon');
    var shackle = $('lockShackle');
    if (!icon || !shackle) return;

    if (S.locked) {
      icon.classList.remove('unlocked');
      icon.classList.add('locked');
      icon.title = 'Doors: Locked';
      shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
    } else {
      icon.classList.remove('locked');
      icon.classList.add('unlocked');
      icon.title = 'Doors: Unlocked';
      shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 9.9-1');
    }

    if (prevLockedState !== null && prevLockedState !== S.locked) {
      icon.classList.remove('lock-snap');
      void icon.offsetWidth;
      icon.classList.add('lock-snap');
      if (lockSnapTimer) clearTimeout(lockSnapTimer);
      lockSnapTimer = setTimeout(function () {
        icon.classList.remove('lock-snap');
      }, 340);
    }
    prevLockedState = S.locked;
  }

  function renderEngine() {
    if (!prevEngineState && S.engine) {
      cockpit.classList.add('engine-pop');
      if (popTimer) clearTimeout(popTimer);
      popTimer = setTimeout(function () {
        cockpit.classList.remove('engine-pop');
      }, 650);
      triggerAlonicaGreeting();
    }
    prevEngineState = S.engine;

    cockpit.classList.toggle('engine-off', !S.engine);
    var icon = $('engineCheck');
    if (icon) {
      icon.className = 'vehicle-indicator engine-dial-icon' + (S.engine ? ' active' : '');
      if (S.engine && S.health <= 20) {
        icon.classList.add('danger');
      }
    }
    renderRPM();
    updateBeltBeep();
  }

  function renderSeatbelt() {
    var icon = $('seatbeltIndicator');
    if (icon) icon.className = 'vehicle-indicator belt-pill' + (!S.belt ? ' active danger' : '');
    cockpit.classList.toggle('belt-unfastened', !S.belt);
    updateBeltBeep();
  }

  function renderFuel() {
    var f = clamp(S.fuel, 0, 100);
    var ratio = f / 100;
    setText('fuelValue', Math.round(f) + '%');

    var ringFill = $('fuelRingFill');
    if (ringFill) {
      ringFill.setAttribute('stroke-dasharray', (ratio * 220).toFixed(1) + ' 300');
    }
    updateSideSegments('fuelSideSegments', ratio, false);

    cockpit.classList.toggle('fuel-critical', f <= 15);
  }

  function renderHealth() {
    var h = clamp(S.health, 0, 100);
    var ratio = h / 100;
    setText('healthValue', Math.round(h) + '%');

    var ringFill = $('healthRingFill');
    if (ringFill) {
      ringFill.setAttribute('stroke-dasharray', (ratio * 220).toFixed(1) + ' 300');
    }
    updateSideSegments('healthSideSegments', ratio, false);

    cockpit.classList.toggle('hp-high', h >= 80);
    cockpit.classList.toggle('hp-hurt', h < 80 && h >= 20);
    cockpit.classList.toggle('hp-weak', h < 20);
    cockpit.classList.toggle('health-critical', h <= 15);
    renderEngine();
  }

  /* ================= HOOKS SERVER FIVEM / NUI ================= */
  window.setEngine = function (engineState) {
    S.engine = Boolean(engineState);
    if (elements.engine) elements.engine.innerText = onOrOff(engineState);
    renderEngine();
  };

  window.setSpeed = function (speedMS) {
    var s = Number(speedMS);
    if (isNaN(s)) s = 0;
    S.speedMS = s;
    switch (S.speedMode) {
      case 1: S.speed = Math.round(s * 2.236936); break;
      case 2: S.speed = Math.round(s * 1.943844); break;
      default: S.speed = Math.round(s * 3.6); break;
    }
    if (elements.speed) {
      elements.speed.innerText = S.speed + ' ' + (S.speedMode === 1 ? 'MPH' : 'KMH');
    }
    renderSpeed();
  };

  window.setRPM = function (rpmVal) {
    var v = num(rpmVal);
    S.rpm = v <= 1.5 ? v * 8000 : v;
    if (elements.rpm) elements.rpm.innerText = (S.rpm / 8000).toFixed(4) + ' RPM';
    renderRPM();
  };

  window.setFuel = function (fuelVal) {
    var v = num(fuelVal);
    S.fuel = v <= 1 ? v * 100 : v;
    if (elements.fuel) elements.fuel.innerText = S.fuel.toFixed(1) + '%';
    renderFuel();
  };

  window.setHealth = function (healthVal) {
    var v = num(healthVal);
    S.health = v <= 1 ? v * 100 : (v > 100 ? v / 10 : v);
    if (elements.health) elements.health.innerText = S.health.toFixed(1) + '%';
    renderHealth();
  };

  window.setGear = function (gearVal) {
    S.gear = (gearVal === 0 || gearVal === '0') ? 'N' : String(gearVal).toUpperCase();
    if (elements.gear) elements.gear.innerText = String(gearVal);
    renderGear();
  };

  window.setHeadlights = function (lightState) {
    S.lights = num(lightState);
    if (elements.headlights) {
      elements.headlights.innerText = S.lights === 1 ? 'On' : (S.lights === 2 ? 'High Beam' : 'Off');
    }
    renderHeadlights();
  };

  window.setLeftIndicator = function (indicatorState) {
    S.left = Boolean(indicatorState);
    if (elements.indicators) {
      elements.indicators.innerText = (S.left ? 'On' : 'Off') + ' / ' + (S.right ? 'On' : 'Off');
    }
    renderIndicators();
  };

  window.setRightIndicator = function (indicatorState) {
    S.right = Boolean(indicatorState);
    if (elements.indicators) {
      elements.indicators.innerText = (S.left ? 'On' : 'Off') + ' / ' + (S.right ? 'On' : 'Off');
    }
    renderIndicators();
  };

  window.setSeatbelts = function (seatbeltState) {
    S.belt = Boolean(seatbeltState);
    if (elements.seatbelts) elements.seatbelts.innerText = onOrOff(seatbeltState);
    renderSeatbelt();
  };

  function setDoorLock(state) {
    if (typeof state === 'string') {
      var norm = state.trim().toLowerCase();
      S.locked = norm === 'true' || norm === '1' || norm === 'locked' || norm === 'lock';
    } else if (typeof state === 'number') {
      S.locked = state >= 1;
    } else {
      S.locked = Boolean(state);
    }
    renderDoorLock();
  }

  window.setDoorLock = setDoorLock;
  window.setLocked = setDoorLock;
  window.setVehicleLock = setDoorLock;
  window.setDoorsLocked = setDoorLock;

  window.setSpeedMode = function (modeVal) {
    var m = String(modeVal).toLowerCase();
    if (m === 'mph' || m === '1') S.speedMode = 1;
    else if (m === 'knots' || m === 'knot' || m === '2') S.speedMode = 2;
    else if (m === 'kmh' || m === 'km/h' || m === '0') S.speedMode = 0;
    else S.speedMode = 1;
    window.setSpeed(S.speedMS);
    renderOdometer();
  };

  window.setOdometer = function (dist) {
    S.odo = num(dist);
    if (elements.odometer) elements.odometer.innerText = S.odo.toFixed(1) + ' Miles';
    renderOdometer();
  };

  /* ================= PENGATURAN HUD & LAYOUT ================= */
  function applyLayout() {
    cockpit.style.setProperty('--tx', L.tx + 'px');
    cockpit.style.setProperty('--ty', L.ty + 'px');
    cockpit.style.setProperty('--scale', L.scale);
    THEMES.forEach(function (t) { cockpit.classList.remove(t); });
    cockpit.classList.add(THEMES[L.theme] || THEMES[0]);
  }

  function clampLayout() {
    L.scale = clamp(L.scale, 0.5, 2);
    applyLayout();
    var r = cockpit.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    if (r.left < 0) L.tx += -r.left;
    if (r.right > vw) L.tx -= (r.right - vw);
    if (r.top < 0) L.ty += -r.top;
    if (r.bottom > vh) L.ty -= (r.bottom - vh);
    applyLayout();
  }

  function saveLayout() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(L)); } catch (e) {}
  }

  function loadLayout() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      L.tx = num(o.tx);
      L.ty = num(o.ty);
      L.scale = clamp(num(o.scale, 1), 0.5, 2);
      L.theme = clamp(parseInt(o.theme, 10) || 0, 0, THEMES.length - 1);
    } catch (e) {}
  }

  var THEME_LABELS = ['Cyber Neon Violet', 'Hyper Magenta Rose', 'Electric Cyan Gold'];
  var HINTS = {
    none: 'Pilih mode · klik kanan untuk menutup menu',
    move: 'Mode PINDAH: tahan & geser mouse untuk memindahkan HUD',
    resize: 'Mode RESIZE: geser mouse atau scroll untuk ubah ukuran',
    reset: 'Posisi & ukuran dikembalikan ke default',
    theme: 'Tema warna Cyber Cluster diganti'
  };

  function setMode(m, hintKey) {
    mode = m;
    cockpit.classList.toggle('mode-move', m === 'move');
    cockpit.classList.toggle('mode-resize', m === 'resize');
    var btns = menu.querySelectorAll('.menu-btns button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-act') === m);
    }
    if (hint) hint.textContent = HINTS[hintKey || m || 'none'];
  }

  menu.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || e.button !== 0) return;
    var act = b.getAttribute('data-act');
    if (act === 'move' || act === 'resize') {
      setMode(mode === act ? null : act);
    } else if (act === 'reset') {
      L.tx = 0; L.ty = 0; L.scale = 1;
      setMode(null, 'reset');
      clampLayout();
      saveLayout();
    } else if (act === 'theme') {
      L.theme = (L.theme + 1) % THEMES.length;
      applyLayout();
      saveLayout();
      if (hint) hint.textContent = 'Tema: ' + (THEME_LABELS[L.theme] || HINTS.theme);
    }
  });

  if (closeSettings) {
    closeSettings.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.remove('open');
      setMode(null);
      updateMiniPill();
    });
  }

  cockpit.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    if (!open) setMode(null);
    else setMode(mode);
    updateMiniPill();
  });

  var drag = null;

  cockpit.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !mode) return;
    if (e.target.closest('#settingsMenu') || e.target.closest('#mini-music-pill') || e.target.closest('#kittyBow')) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, tx: L.tx, ty: L.ty, scale: L.scale };
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (mode === 'move') {
      L.tx = drag.tx + dx;
      L.ty = drag.ty + dy;
    } else if (mode === 'resize') {
      L.scale = drag.scale - dy / 220;
    }
    clampLayout();
  });

  window.addEventListener('mouseup', function () {
    if (!drag) return;
    drag = null;
    saveLayout();
  });

  window.addEventListener('wheel', function (e) {
    if (mode !== 'resize' || !menu.classList.contains('open')) return;
    e.preventDefault();
    L.scale += (e.deltaY < 0 ? 0.05 : -0.05);
    clampLayout();
    saveLayout();
  }, { passive: false });

  window.addEventListener('resize', function () { clampLayout(); });

  /* ================= INIT ================= */
  buildSpeedometerScale();
  updateClusterClock();
  setInterval(updateClusterClock, 10000);

  loadLayout();
  clampLayout();
  setMode(null);
  setupKittyBowGreeting();
  setupMusicPlayer();

  window.setEngine(false);
  window.setSpeed(0);
  window.setRPM(0);
  window.setFuel(100);
  window.setHealth(100);
  window.setGear('N');
  window.setHeadlights(0);
  window.setLeftIndicator(false);
  window.setRightIndicator(false);
  window.setSeatbelts(false);
  window.setDoorLock(false);
  window.setOdometer(0);

  // Sambutan otomatis saat HUD pertama kali boot
  setTimeout(function () {
    triggerAlonicaGreeting();
  }, 350);

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    var payload = d.data && typeof d.data === 'object' ? d.data : d;

    var aliases = {
      engine: 'setEngine',
      speed: 'setSpeed',
      rpm: 'setRPM',
      fuel: 'setFuel',
      health: 'setHealth',
      gear: 'setGear',
      headlights: 'setHeadlights',
      leftIndicator: 'setLeftIndicator',
      rightIndicator: 'setRightIndicator',
      seatbelts: 'setSeatbelts',
      seatbelt: 'setSeatbelts',
      locked: 'setDoorLock',
      doorLock: 'setDoorLock',
      doorsLocked: 'setDoorLock',
      vehicleLock: 'setDoorLock',
      speedMode: 'setSpeedMode',
      odometer: 'setOdometer'
    };

    for (var key in aliases) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        var fn = window[aliases[key]];
        if (typeof fn === 'function') fn(payload[key]);
      }
    }
  });
})();
