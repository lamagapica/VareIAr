/* ==========================================================
   VareiAR · app.js
   WebAR basada en GPS con A-Frame 1.3.0 + AR.js 3.4.5

   Qué hace este fichero:
   1. Guarda la configuración de los modelos (CONFIG) → AQUÍ EDITAS TUS DATOS.
   2. Comprueba compatibilidad y pide permisos (cámara, GPS, sensores).
   3. Construye la escena AR con tus .glb reales y los ancla con gps-entity-place.
   4. Controla la interfaz: estado GPS, slider de opacidad, recalibrado.
   ========================================================== */

(() => {
  'use strict';

  /* ========================================================
     1. CONFIGURACIÓN  ← EDITA AQUÍ
     ======================================================== */
  const CONFIG = {

    // --- Parámetros de gps-camera (AR.js) ---
    gps: {
      minDistance: 5,       // m. Ignora movimientos GPS menores a esto (reduce tirones/jitter).
      maxDistance: 0,       // m. 0 = sin límite: los modelos se ven desde cualquier distancia.
      minAccuracy: 150      // m. Si la precisión GPS es peor que esto, AR.js no coloca los modelos.
    },

    // Distancia (m) a la que se considera que el usuario está "en" un edificio
    nearRadius: 150,

    // Opacidad inicial del slider (0 = solo entorno real, 100 = modelo opaco)
    defaultOpacity: 100,

    // --- Tus modelos 3D ---
    // src       → ruta del .glb. Empieza por "/" (raíz del servidor).
    //             Si publicas en una subcarpeta, usa "./assets/xxx.glb".
    // lat / lon → coordenadas GPS donde se ancla el modelo.
    // scale     → [x, y, z].
    // yOffset   → altura (m) respecto al móvil. El móvil va a ~1,5 m del suelo, así que
    //             -1.5 apoya en el suelo un modelo cuyo origen está en su base.
    //             Pon 0 si el origen de tu modelo está en el centro.
    // rotationY → giro (grados) alrededor del eje vertical, si el modelo sale de lado.
    models: [
      {
        id: 'almazara',
        name: 'Almazara',
        src: './assets/almazara.glb',
        lat: 42.462521,
        lon: -2.407462,
        scale: [1, 1, 1],
        yOffset: -1.5,
        rotationY: 0
      },
      {
        id: 'ceramica',
        name: 'Cerámica',
        src: 'Ceramica.glb',
        lat: 42.4615518,
        lon: -2.41001226,
        scale: [1, 1, 1],
        yOffset: -1.5,
        rotationY: 0
      },
      {
        id: 'termas',
        name: 'Termas',
        src: 'Termas.glb',
        lat: 42.4619531,
        lon: -2.4077693,
        scale: [1, 1, 1],
        yOffset: -1.5,
        rotationY: 0
      }
    ]
  };

  /* ========================================================
     Modo prueba (opcional): simula tu posición sin moverte.
     Ej.: https://tu-web/index.html?lat=42.4625&lon=-2.4075
     ======================================================== */
  const params = new URLSearchParams(window.location.search);
  const SIM = (params.has('lat') && params.has('lon'))
    ? { lat: parseFloat(params.get('lat')), lon: parseFloat(params.get('lon')) }
    : null;

  /* ========================================================
     Referencias DOM y estado
     ======================================================== */
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('ar-root'),
    template: $('ar-scene-template'),
    welcome: $('welcome'),
    startBtn: $('start-btn'),
    error: $('error'),
    errorText: $('error-text'),
    errorHint: $('error-hint'),
    retryBtn: $('retry-btn'),
    header: $('hud-header'),
    footer: $('hud-footer'),
    status: $('gps-status'),
    statusText: $('gps-status-text'),
    loading: $('loading-chip'),
    toast: $('toast'),
    slider: $('opacity-slider'),
    sliderValue: $('opacity-value'),
    recalBtn: $('recalibrate-btn')
  };

  const state = {
    opacity: CONFIG.defaultOpacity / 100,
    watchId: null,
    sceneBuilt: false,
    loaded: 0,
    toastTimer: null
  };

  /* ========================================================
     Mensajes de error (texto + ayuda para el usuario)
     ======================================================== */
  const ERRORS = {
    insecure: {
      text: 'La cámara y el GPS solo funcionan en páginas seguras (HTTPS).',
      hint: 'Abre la web con una dirección que empiece por https:// (no vale file:// ni http://).'
    },
    'no-camera-api': {
      text: 'Este navegador no permite acceder a la cámara.',
      hint: 'Prueba con Safari (iPhone) o Chrome (Android) actualizados.'
    },
    'no-gps-api': {
      text: 'Este dispositivo o navegador no ofrece geolocalización.',
      hint: 'Prueba con Safari (iPhone) o Chrome (Android) actualizados.'
    },
    'no-sensors': {
      text: 'Este dispositivo no tiene sensores de orientación (brújula/giroscopio).',
      hint: 'La experiencia necesita un móvil o tablet. En un ordenador no es posible.'
    },
    'no-webgl': {
      text: 'Tu navegador no soporta gráficos 3D (WebGL).',
      hint: 'Actualiza el navegador o desactiva el ahorro de batería extremo.'
    },
    'camera-denied': {
      text: 'No has concedido permiso para usar la cámara.',
      hint: 'Actívalo en los ajustes del navegador para esta web y pulsa Reintentar. En iPhone: Ajustes › Safari › Cámara.'
    },
    'no-camera': {
      text: 'No se ha encontrado ninguna cámara en el dispositivo.',
      hint: 'Comprueba que ninguna otra aplicación la esté usando.'
    },
    'camera-error': {
      text: 'No se pudo iniciar la cámara.',
      hint: 'Cierra otras apps que la usen y pulsa Reintentar.'
    },
    'gps-denied': {
      text: 'No has concedido permiso de ubicación.',
      hint: 'Actívalo en los ajustes del navegador para esta web y pulsa Reintentar. En iPhone: Ajustes › Privacidad › Localización.'
    },
    'orientation-denied': {
      text: 'No has concedido permiso a los sensores de movimiento.',
      hint: 'En iPhone: Ajustes › Safari › Movimiento y orientación. Después pulsa Reintentar.'
    },
    generic: {
      text: 'Ha ocurrido un error inesperado al iniciar la experiencia.',
      hint: 'Recarga la página e inténtalo de nuevo.'
    }
  };

  function fail(code) {
    const err = new Error(code);
    err.appCode = code;
    throw err;
  }

  function showError(code) {
    const e = ERRORS[code] || ERRORS.generic;
    el.errorText.textContent = e.text;
    el.errorHint.textContent = e.hint;
    el.welcome.classList.add('hidden');
    el.error.classList.remove('hidden');
    el.header.classList.add('hidden');
    el.footer.classList.add('hidden');
    el.loading.classList.add('hidden');
  }

  function showToast(message, ms = 4500) {
    el.toast.textContent = message;
    el.toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
  }

  /* ========================================================
     2. COMPATIBILIDAD Y PERMISOS
     ======================================================== */
  function checkSupport() {
    if (!window.isSecureContext) fail('insecure');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) fail('no-camera-api');
    if (!('geolocation' in navigator)) fail('no-gps-api');
    if (!('DeviceOrientationEvent' in window)) fail('no-sensors');
    try {
      const c = document.createElement('canvas');
      if (!(c.getContext('webgl') || c.getContext('experimental-webgl'))) fail('no-webgl');
    } catch (e) {
      if (e.appCode) throw e;
      fail('no-webgl');
    }
  }

  async function requestPermissions() {
    // 1) Sensores de orientación. En iOS 13+ hay que pedirlos dentro de un gesto (el toque del botón),
    //    por eso se hace lo primero.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      let res;
      try { res = await DOE.requestPermission(); } catch (e) { res = 'denied'; }
      if (res !== 'granted') fail('orientation-denied');
    }
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === 'function') {
      try { await DME.requestPermission(); } catch (e) { /* no bloquea */ }
    }

    // 2) Cámara trasera (se abre y se cierra: AR.js la abrirá de nuevo ya con permiso concedido).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) fail('camera-denied');
      if (e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError')) fail('no-camera');
      fail('camera-error');
    }

    // 3) Ubicación (en modo simulación no hace falta).
    if (!SIM) {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          (err) => {
            // Solo bloquea si el usuario deniega el permiso; un timeout se resuelve más tarde con el watch.
            if (err.code === 1) {
              const e = new Error('gps-denied');
              e.appCode = 'gps-denied';
              reject(e);
            } else {
              resolve();
            }
          },
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
        );
      });
    }
  }

  /* ========================================================
     3. ESCENA AR
     ======================================================== */
  function gpsCameraAttr() {
    const g = CONFIG.gps;
    let attr = `gpsMinDistance: ${g.minDistance}; maxDistance: ${g.maxDistance}; positionMinAccuracy: ${g.minAccuracy}; alert: false;`;
    if (SIM) attr += ` simulateLatitude: ${SIM.lat}; simulateLongitude: ${SIM.lon};`;
    return attr;
  }

  function buildScene() {
    // Limpia una escena anterior si existiera (p. ej. tras un error)
    el.root.innerHTML = '';

    const frag = document.importNode(el.template.content, true);
    const scene = frag.querySelector('a-scene');
    const assets = frag.querySelector('a-assets');
    const camera = frag.querySelector('#ar-camera');

    camera.setAttribute('gps-camera', gpsCameraAttr());

    state.loaded = 0;
    updateLoading();

    CONFIG.models.forEach((m) => {
      // --- Precarga del .glb ---
      const item = document.createElement('a-asset-item');
      item.id = `model-${m.id}`;
      item.setAttribute('src', m.src);
      item.setAttribute('response-type', 'arraybuffer');
      item.addEventListener('loaded', () => { state.loaded += 1; updateLoading(); });
      item.addEventListener('error', () => {
        state.loaded += 1;
        updateLoading();
        showToast(`No se pudo cargar ${m.src}. Revisa la ruta del archivo.`, 8000);
        console.error('[VareiAR] Error cargando', m.src);
      });
      assets.appendChild(item);

      // --- Entidad anclada a coordenadas GPS ---
      const ent = document.createElement('a-entity');
      ent.id = `entity-${m.id}`;
      ent.setAttribute('gltf-model', `#model-${m.id}`);
      ent.setAttribute('gps-entity-place', `latitude: ${m.lat}; longitude: ${m.lon};`);
      ent.setAttribute('scale', m.scale.join(' '));
      ent.setAttribute('position', `0 ${m.yOffset} 0`);   // gps-entity-place solo gestiona X y Z
      ent.setAttribute('rotation', `0 ${m.rotationY} 0`);

      // Cuando el modelo está listo: aplicar opacidad actual con un fundido de entrada
      ent.addEventListener('model-loaded', () => fadeIn(ent));
      ent.addEventListener('model-error', () => {
        showToast(`El archivo ${m.src} no es un .glb válido.`, 8000);
      });
      scene.appendChild(ent);
    });

    el.root.appendChild(frag);
    state.sceneBuilt = true;
  }

  function updateLoading() {
    const total = CONFIG.models.length;
    if (state.loaded >= total) {
      el.loading.classList.add('hidden');
    } else {
      el.loading.textContent = `Cargando modelos 3D (${state.loaded}/${total})…`;
      el.loading.classList.remove('hidden');
    }
  }

  /* ========================================================
     4. OPACIDAD (slider Pasado / Presente)
     ======================================================== */
  // Aplica la opacidad v (0–1) a todos los materiales del modelo de una entidad.
  function applyOpacity(entity, v) {
    const mesh = entity.getObject3D('mesh');
    if (!mesh) return;
    mesh.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((mat) => {
        // Guarda los valores originales del .glb la primera vez
        if (mat.userData._vareiOrig === undefined) {
          mat.userData._vareiOrig = { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite };
        }
        const o = mat.userData._vareiOrig;
        const needsTransparency = v < 0.999 || o.transparent;
        if (mat.transparent !== needsTransparency) {
          mat.transparent = needsTransparency;
          mat.needsUpdate = true;
        }
        mat.opacity = o.opacity * v;
        mat.depthWrite = v >= 0.999 ? o.depthWrite : false; // evita artefactos al ver a través del modelo
      });
    });
    node_visibility(entity, v);
  }

  // Oculta el modelo del todo en 0% (ahorra GPU)
  function node_visibility(entity, v) {
    entity.object3D.visible = v > 0.001;
  }

  function applyOpacityToAll(v) {
    CONFIG.models.forEach((m) => {
      const ent = $(`entity-${m.id}`);
      if (ent) applyOpacity(ent, v);
    });
  }

  // Fundido de entrada de 1,2 s cuando el modelo termina de cargar
  function fadeIn(entity) {
    const t0 = performance.now();
    const dur = 1200;
    const step = (now) => {
      const k = Math.min(Math.max((now - t0) / dur, 0), 1);
      applyOpacity(entity, state.opacity * k);
      if (k < 1) requestAnimationFrame(step);
      else applyOpacity(entity, state.opacity);
    };
    requestAnimationFrame(step);
  }

  function onSliderInput() {
    const pct = Number(el.slider.value);
    state.opacity = pct / 100;
    el.slider.style.setProperty('--val', `${pct}%`);
    el.sliderValue.textContent = `${pct}%`;
    applyOpacityToAll(state.opacity);
  }

  /* ========================================================
     5. ESTADO DEL GPS (cabecera)
     ======================================================== */
  function setStatus(stateName, text) {
    el.status.dataset.state = stateName;
    el.statusText.textContent = text;
  }

  // Distancia entre dos coordenadas (fórmula de Haversine), en metros
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fmtDist(m) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  }

  function nearestModel(lat, lon) {
    let best = null;
    CONFIG.models.forEach((m) => {
      const d = haversine(lat, lon, m.lat, m.lon);
      if (!best || d < best.dist) best = { model: m, dist: d };
    });
    return best;
  }

  function onPosition(lat, lon, accuracy) {
    if (typeof accuracy === 'number' && accuracy > CONFIG.gps.minAccuracy) {
      setStatus('weak', `Señal GPS débil (±${Math.round(accuracy)} m)`);
      return;
    }
    const n = nearestModel(lat, lon);
    if (n.dist <= CONFIG.nearRadius) {
      setStatus('located', `Edificio localizado: ${n.model.name} (${fmtDist(n.dist)})`);
    } else {
      setStatus('far', `${n.model.name} a ${fmtDist(n.dist)}. Acércate`);
    }
  }

  function startGpsWatch() {
    stopGpsWatch();
    setStatus('searching', 'Buscando señal GPS…');

    if (SIM) {                       // modo prueba
      onPosition(SIM.lat, SIM.lon);
      return;
    }

    state.watchId = navigator.geolocation.watchPosition(
      (pos) => onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      (err) => {
        if (err.code === 1) showError('gps-denied');
        else if (err.code === 2) setStatus('error', 'Ubicación no disponible');
        else setStatus('searching', 'Buscando señal GPS…');   // timeout: sigue intentándolo
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    );
  }

  function stopGpsWatch() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  /* ========================================================
     6. RECALIBRAR / CENTRAR
     ======================================================== */
  function recalibrate() {
    const cam = $('ar-camera');
    if (!cam) return;

    // Reinicia el giro acumulado de look-controls; gps-camera vuelve a alinear con la brújula
    const lc = cam.components && cam.components['look-controls'];
    if (lc && lc.yawObject && lc.pitchObject) {
      lc.yawObject.rotation.y = 0;
      lc.pitchObject.rotation.x = 0;
    }

    // Vuelve a pedir una posición fresca
    startGpsWatch();

    el.recalBtn.classList.remove('spin');
    void el.recalBtn.offsetWidth;            // reinicia la animación
    el.recalBtn.classList.add('spin');
    showToast('Brújula reiniciada. Mueve el móvil dibujando un 8 en el aire para calibrarla.', 6000);
  }

  /* ========================================================
     7. ARRANQUE
     ======================================================== */
  async function onStart() {
    el.welcome.classList.add('hidden');
    el.error.classList.add('hidden');

    try {
      checkSupport();
      await requestPermissions();   // ← el primer permiso (iOS) debe pedirse dentro del toque
    } catch (e) {
      console.error('[VareiAR]', e);
      showError(e.appCode || 'generic');
      return;
    }

    try {
      buildScene();
      startGpsWatch();
      el.header.classList.remove('hidden');
      el.footer.classList.remove('hidden');
      onSliderInput();
    } catch (e) {
      console.error('[VareiAR]', e);
      showError('generic');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    el.slider.value = CONFIG.defaultOpacity;
    el.slider.style.setProperty('--val', `${CONFIG.defaultOpacity}%`);
    el.sliderValue.textContent = `${CONFIG.defaultOpacity}%`;

    el.startBtn.addEventListener('click', onStart);
    el.retryBtn.addEventListener('click', onStart);
    el.slider.addEventListener('input', onSliderInput);
    el.recalBtn.addEventListener('click', recalibrate);

    // Si la app vuelve a primer plano, reanuda el GPS
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.sceneBuilt) startGpsWatch();
    });
  });
})();
