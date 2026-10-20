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
  var THEMES = ['theme-violet', 'theme-magenta', 'theme-cyan'];

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

  /* ================= GEOMETRI KLASTER (SVG) ================= */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DIAL = { cx: 500, cy: 240, a0: 225, sweep: 270, max: 8000, redFrom: 6500 };
  var RING_A0 = 225;
  var RING_SWEEP = 270;

  function polar(cx, cy, r, deg) {
    var rad = deg * Math.PI / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  }

  function arcPath(cx, cy, r, a0, a1) {
    if (a1 - a0 < 0.05) return '';
    var s = polar(cx, cy, r, a0);
    var e = polar(cx, cy, r, a1);
    var large = (a1 - a0) > 180 ? 1 : 0;
    return 'M' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) +
      ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e.x.toFixed(2) + ' ' + e.y.toFixed(2);
  }

  function svgEl(name, attrs, cls) {
    var el = document.createElementNS(SVGNS, name);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    }
    if (cls) el.setAttribute('class', cls);
    return el;
  }

  function dialAngle(rpm) {
    return DIAL.a0 + clamp(rpm / DIAL.max, 0, 1) * DIAL.sweep;
  }

  function setD(el, d) {
    if (!el || el.__d === d) return;
    el.setAttribute('d', d);
    el.__d = d;
  }

  var ringVals = {};

  function setRing(el, p) {
    if (!el || !el.__ring) return;
    var r = el.__ring;
    setD(el, arcPath(r[0], r[1], r[2], RING_A0, RING_A0 + RING_SWEEP * clamp(p, 0, 1)));
  }

  function buildDial() {
    var ticks = $('dialTicks');
    var nums = $('dialNums');
    var i, v, a, p1, p2, major;

    if (ticks) {
      for (i = 0; i <= 32; i++) {
        v = i / 4;
        a = DIAL.a0 + (v / 8) * DIAL.sweep;
        major = (i % 4 === 0);
        p1 = polar(DIAL.cx, DIAL.cy, 146, a);
        p2 = polar(DIAL.cx, DIAL.cy, 146 - (major ? 14 : 7), a);
        var cls = 'tick ' + (major ? 'major' : 'minor') + (v * 1000 >= DIAL.redFrom ? ' red' : '');
        ticks.appendChild(svgEl('line', {
          x1: p1.x.toFixed(2), y1: p1.y.toFixed(2),
          x2: p2.x.toFixed(2), y2: p2.y.toFixed(2)
        }, cls));
      }
    }

    if (nums) {
      for (i = 0; i <= 8; i++) {
        a = DIAL.a0 + (i / 8) * DIAL.sweep;
        var pt = polar(DIAL.cx, DIAL.cy, 114, a);
        var t = svgEl('text', { x: pt.x.toFixed(2), y: pt.y.toFixed(2) }, 'dial-num');
        t.textContent = String(i);
        nums.appendChild(t);
      }
    }

    var red = $('redZone');
    if (red) red.setAttribute('d', arcPath(DIAL.cx, DIAL.cy, 152, dialAngle(DIAL.redFrom), dialAngle(DIAL.max)));

    var tracks = document.querySelectorAll('[data-ring]');
    for (i = 0; i < tracks.length; i++) {
      var p = tracks[i].getAttribute('data-ring').split(',').map(Number);
      tracks[i].setAttribute('d', arcPath(p[0], p[1], p[2], RING_A0, RING_A0 + RING_SWEEP));
    }

    var vals = document.querySelectorAll('[data-ring-val]');
    for (i = 0; i < vals.length; i++) {
      vals[i].__ring = vals[i].getAttribute('data-ring-val').split(',').map(Number);
    }
  }

  /* ================= BAR SEGMEN (FUEL / HEALTH / ENGINE LOAD) ================= */
  var bars = {};

  function buildBars() {
    var els = document.querySelectorAll('.seg-bar');
    for (var i = 0; i < els.length; i++) {
      var g = els[i];
      var x = Number(g.getAttribute('data-x'));
      var y = Number(g.getAttribute('data-y'));
      var h = Number(g.getAttribute('data-h'));
      var n = Number(g.getAttribute('data-n'));
      var w = Number(g.getAttribute('data-w'));
      var gap = 2.5;
      var sh = (h - gap * (n - 1)) / n;
      var segs = [];
      for (var k = 0; k < n; k++) {
        var t = n > 1 ? (k - (n - 1) / 2) / ((n - 1) / 2) : 0;
        var cls = 'seg' + (k < n * 0.3 ? ' hi' : (k >= n * 0.7 ? ' lo' : ''));
        var r = svgEl('rect', {
          x: (x + 7 * t * t).toFixed(2),
          y: (y + k * (sh + gap)).toFixed(2),
          width: w,
          height: sh.toFixed(2),
          rx: 1.6
        }, cls);
        g.appendChild(r);
        segs.push(r);
      }
      bars[g.id] = { segs: segs, lit: -1 };
    }
  }

  function setBar(id, ratio) {
    var b = bars[id];
    if (!b) return;
    var n = b.segs.length;
    var lit = Math.round(clamp(ratio, 0, 1) * n);
    if (lit === b.lit) return;
    b.lit = lit;
    for (var k = 0; k < n; k++) {
      b.segs[k].classList.toggle('on', (n - 1 - k) < lit);
    }
  }

  /* ================= ANIMASI BOOT (SWEEP) & LOOP RENDER ================= */
  var boot = { t0: 0, on: false };
  var disp = { rpm: 0, fuel: 100, health: 100, engine: 0 };
  var lastAng = -999;
  var needleEl = null;
  var rpmArcEl = null;
  var fuelArcEl = null;
  var healthArcEl = null;
  var engineArcEl = null;

  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  function startBoot() {
    boot.t0 = performance.now();
    boot.on = true;
  }

  function bootLevel(now) {
    if (!boot.on) return 0;
    var t = (now - boot.t0) / 1000;
    if (t < 0.9) return ease(t / 0.9);
    if (t < 1.05) return 1;
    if (t < 2.15) return 1 - ease((t - 1.05) / 1.1);
    boot.on = false;
    return 0;
  }

  function smooth(cur, target, k) {
    var d = target - cur;
    return Math.abs(d) < 0.05 ? target : cur + d * k;
  }

  function frame(now) {
    var lvl = bootLevel(now);

    disp.rpm = smooth(disp.rpm, S.rpm, 0.14);
    disp.fuel = smooth(disp.fuel, clamp(S.fuel, 0, 100), 0.1);
    disp.health = smooth(disp.health, clamp(S.health, 0, 100), 0.1);
    disp.engine = smooth(disp.engine, S.engine ? 1 : 0, 0.08);

    var rp = Math.max(clamp(disp.rpm / DIAL.max, 0, 1), lvl);
    var fp = Math.max(disp.fuel / 100, lvl);
    var hp = Math.max(disp.health / 100, lvl);
    var ep = Math.max(disp.engine, lvl);

    var base = DIAL.a0 + rp * DIAL.sweep;
    var jitter = (S.engine && lvl === 0) ? Math.sin(now / 53) * 0.22 : 0;
    var ang = base + jitter;

    if (needleEl && Math.abs(ang - lastAng) > 0.02) {
      needleEl.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ' ' + DIAL.cx + ' ' + DIAL.cy + ')');
      lastAng = ang;
    }

    setD(rpmArcEl, arcPath(DIAL.cx, DIAL.cy, 157, DIAL.a0, base));
    setRing(fuelArcEl, fp);
    setRing(healthArcEl, hp);
    setRing(engineArcEl, ep);

    setBar('fuelBar', fp);
    setBar('healthBar', hp);
    setBar('engineBar', rp);

    requestAnimationFrame(frame);
  }

  function updateClock() {
    var d = new Date();
    setText('clockValue', String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }

  /* ================= RENDER HUD ================= */
  function renderRPM() {
    var progress = clamp(S.rpm, 0, 8000) / 8000;
    cockpit.classList.toggle('redline', progress > 0.85);
  }

  function renderSpeed() {
    setText('speedValue', String(Math.round(S.speed)).padStart(3, '0'));
    setText('speedUnit', S.speedMode === 1 ? 'MPH' : (S.speedMode === 2 ? 'KNOTS' : 'KM/H'));

    var speedMPH = S.speedMode === 1 ? S.speed : (S.speedMS * 2.236936);
    cockpit.classList.toggle('overspeed', speedMPH >= SPEED_LIMIT_MPH);
    cockpit.classList.toggle('extreme-speed', speedMPH >= EXTREME_SPEED_MPH);
  }

  function renderGear() {
    setText('gearValue', S.gear);
    setText('gearValue2', S.gear);
  }

  function renderHeadlights() {
    var el = $('headlightIndicator');
    if (el) {
      el.classList.remove('active', 'low-beam', 'high-beam');
      if (S.lights === 1) el.classList.add('active', 'low-beam');
      else if (S.lights === 2) el.classList.add('active', 'high-beam');
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
    cockpit.classList.toggle('hazard-active', S.left && S.right);
  }

  function renderOdometer() {
    setText('odometerValue', String(Math.floor(Math.max(0, S.odo))).padStart(6, '0'));
    setText('odoUnit', S.speedMode === 0 ? 'km' : 'mi');
  }

  function renderDoorLock() {
    var icon = $('doorLockIcon');
    var shackle = $('lockShackle');
    if (!icon || !shackle) return;

    if (S.locked) {
      icon.classList.remove('unlocked');
      icon.classList.add('locked');
      shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
    } else {
      icon.classList.remove('locked');
      icon.classList.add('unlocked');
      shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 9.9-1');
    }

    if (prevLockedState !== null && prevLockedState !== S.locked) {
      icon.classList.remove('lock-snap');
      void icon.getBoundingClientRect();
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
      startBoot();
    }
    prevEngineState = S.engine;

    cockpit.classList.toggle('engine-off', !S.engine);
    setText('engineValue', S.engine ? 'ON' : 'OFF');

    var icon = $('engineCheck');
    if (icon) {
      icon.classList.toggle('active', S.engine);
      icon.classList.toggle('danger', S.engine && S.health <= 20);
    }
    updateBeltBeep();
  }

  function renderSeatbelt() {
    var icon = $('seatbeltIndicator');
    if (icon) {
      icon.classList.toggle('active', !S.belt);
      icon.classList.toggle('danger', !S.belt);
    }
    var dashes = $('beltDashes');
    if (dashes) dashes.classList.toggle('ok', S.belt);
    cockpit.classList.toggle('belt-unfastened', !S.belt);
    updateBeltBeep();
  }

  function renderFuel() {
    var f = clamp(S.fuel, 0, 100);
    setText('fuelValue', Math.round(f) + '%');
    cockpit.classList.toggle('fuel-critical', f <= 15);
  }

  function renderHealth() {
    var h = clamp(S.health, 0, 100);
    setText('healthValue', Math.round(h) + '%');
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

  var THEME_LABELS = ['Violet Neon', 'Magenta Pink', 'Cyan Ice'];
  var HINTS = {
    none: 'Pilih mode · klik kanan untuk menutup menu',
    move: 'Mode PINDAH: tahan & geser mouse untuk memindahkan HUD',
    resize: 'Mode RESIZE: geser mouse atau scroll untuk ubah ukuran',
    reset: 'Posisi & ukuran dikembalikan ke default',
    theme: 'Tema warna klaster diganti'
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
    if (e.target.closest('#settingsMenu') || e.target.closest('#mini-music-pill')) return;
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
  loadLayout();
  clampLayout();
  setMode(null);
  buildDial();
  buildBars();
  needleEl = $('needle');
  rpmArcEl = $('rpmArc');
  fuelArcEl = $('fuelArc');
  healthArcEl = $('healthArc');
  engineArcEl = $('engineArc');
  setupMusicPlayer();
  updateClock();
  setInterval(updateClock, 1000);

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

  // Animasi boot: jarum & gauge menyapu penuh lalu kembali
  startBoot();
  requestAnimationFrame(frame);

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

