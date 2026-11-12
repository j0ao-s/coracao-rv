/* Coração por Dentro: lógica principal (A-Frame 1.7.1 + three.js embutido). Licença MIT. */
(function () {
  'use strict';

  const THREE = AFRAME.THREE;
  const C = window.CONTENT;
  const GROUP = Object.fromEntries(C.GROUPS.map((g) => [g.id, g]));
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_MOBILE = AFRAME.utils.device.isMobile();
  const $ = (s) => document.querySelector(s);

  const VR_DIST = { 1: 0.45, 8: 1.2, 20: 2.0 };
  const ENTER_SCALE = 25;
  const GAZE_MS = 1500;
  const HILITE = new THREE.Color('#ffcf6b');
  const HINT = new THREE.Color('#7ee2a0');
  const BLUE = new THREE.Color('#4f9bff');
  const RED = new THREE.Color('#ff4a3a');
  const LAYER_TITLES = {
    paredes: 'Paredes do coração', cavidades: 'Cavidades', valvas: 'Valvas', vasos: 'Vasos da base',
    coronarias: 'Circulação coronária', contexto: 'Contexto do tórax',
  };

  // ------------------------------------------------------------------ estado
  const S = {
    ready: false, started: false, inVR: false,
    meshes: {}, centers: {},
    selected: null, hint: null,
    walls: false, wallsBefore: false,
    layers: Object.fromEntries(C.LAYERS.map((l) => [l.id, l.inicial])),
    scale: 8, zoom: 1, rot: { x: 0, y: 0 }, baseYaw: 0,
    mode: 'explore', // explore | path | enter | quiz
    path: { i: 0, anim: null }, enter: null, quiz: null,
    audio: loadPref('coracao_audio', true), voice: null,
    controllers: new Set(), gaze: { key: null, t0: 0, lock: null, last: 0 },
    fade: null, hover: null,
  };

  function loadPref(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
  function savePref(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }

  // refs preenchidas em setupDom
  let scene, camEl, pivot, modelo, threeCam;
  const R = { ray: new THREE.Raycaster(), v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion() };
  R.ray.far = 50;

  // ------------------------------------------------------------------ utilidades 3D
  function camWorldPos(out = new THREE.Vector3()) { threeCam.updateMatrixWorld(true); return threeCam.getWorldPosition(out); }
  function camForward(out = new THREE.Vector3()) { threeCam.updateMatrixWorld(true); return threeCam.getWorldDirection(out); }
  function camYaw() { const f = camForward(); return Math.atan2(-f.x, -f.z); }
  function platform() { return S.inVR ? 'vr' : (IS_MOBILE ? 'celular' : 'desktop'); }

  function centerOfIndexed(geo) {
    const pos = geo.attributes.position, idx = geo.index ? geo.index.array : null;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const n = idx ? idx.length : pos.count;
    for (let i = 0; i < n; i++) {
      const k = idx ? idx[i] : i;
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      if (x < min.x) min.x = x; if (y < min.y) min.y = y; if (z < min.z) min.z = z;
      if (x > max.x) max.x = x; if (y > max.y) max.y = y; if (z > max.z) max.z = z;
    }
    return min.add(max).multiplyScalar(0.5);
  }

  // Remove triângulos abaixo de uma altura (a veia cava inferior do atlas desce ~27 cm até o abdome).
  function trimBelow(geo, yMin) {
    const pos = geo.attributes.position, idx = geo.index.array, out = [];
    for (let i = 0; i < idx.length; i += 3) {
      if (pos.getY(idx[i]) >= yMin && pos.getY(idx[i + 1]) >= yMin && pos.getY(idx[i + 2]) >= yMin) out.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(out), 1));
    geo.computeBoundingSphere();
  }

  // ------------------------------------------------------------------ áudio
  const Speech = {
    ok: 'speechSynthesis' in window,
    init() {
      if (!this.ok) return;
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        S.voice = vs.find((v) => /pt[-_]BR/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
        return vs.length;
      };
      pick();
      speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pick);
    },
    speak(text, force) {
      if (!this.ok || !text || (!S.audio && !force)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR'; u.rate = 0.95;
      if (S.voice) u.voice = S.voice;
      speechSynthesis.speak(u);
    },
    stop() { if (this.ok) speechSynthesis.cancel(); },
  };

  // ------------------------------------------------------------------ modelo
  function setupModel(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const id = GROUP[o.name] ? o.name : (o.parent && GROUP[o.parent.name] ? o.parent.name : null);
      if (!id) return;
      const g = GROUP[id];
      if (id === 'veia_cava_inferior') trimBelow(o.geometry, -0.075);
      S.centers[id] = centerOfIndexed(o.geometry);
      o.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(g.cor), roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
        emissive: new THREE.Color(0, 0, 0),
      });
      o.userData.group = id;
      S.meshes[id] = o;
    });
    const missing = C.GROUPS.filter((g) => !S.meshes[g.id]).map((g) => g.id);
    if (missing.length) console.warn('Grupos ausentes no GLB:', missing);
    Path.build();
    applyVisuals();
  }

  function baseOpacity(g) { return g.opacidade != null ? g.opacidade : 1; }

  function applyVisuals() {
    const step = S.mode === 'path' ? C.PATH_STEPS[S.path.i] : null;
    for (const id in S.meshes) {
      const g = GROUP[id], m = S.meshes[id], mat = m.material;
      let vis = g.layer === 'paredes' || g.layer === 'cavidades' ? true : !!S.layers[g.layer];
      let op = baseOpacity(g);
      let emis = 0, emisColor = HILITE;
      if (g.layer === 'paredes' && S.walls) op = 0.15;

      if (step) {
        const hl = step.grupos.includes(id);
        if (g.layer === 'contexto') vis = (step.mostrar || []).includes(id);
        if (hl) {
          vis = true; emis = 0.2;
          op = g.layer === 'cavidades' ? 0.55 : g.layer === 'paredes' ? 0.25 : g.layer === 'contexto' ? 0.3 : 1;
        } else {
          op = g.layer === 'paredes' ? 0.07 : Math.min(op, 0.14);
        }
      }
      if (S.mode === 'enter' && S.enter) {
        if (g.layer === 'cavidades' || g.layer === 'contexto') vis = false;
        if (g.layer === 'paredes') op = 1;
        if (S.enter.cfg.realce.includes(id)) emis = 0.15;
      }
      if (S.selected === id) {
        vis = true; emis = Math.max(emis, 0.22);
        if (op < 0.5) op = 0.55;
      }
      if (S.hint === id) { vis = true; emisColor = HINT; if (op < 0.6) op = 0.8; }

      m.visible = vis;
      const transparent = op < 0.999;
      if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = true; }
      mat.opacity = op;
      mat.depthWrite = !transparent;
      mat.emissive.copy(emisColor);
      mat.emissiveIntensity = emis;
      m.renderOrder = transparent ? (g.layer === 'cavidades' ? 1 : 2) : 0;
    }
    UI.syncList();
  }

  // ------------------------------------------------------------------ enquadramento
  function fitDistance(scale) {
    const vfov = THREE.MathUtils.degToRad(threeCam.fov) / 2;
    const aspect = scene.canvas ? scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight) : 1.6;
    const hfov = Math.atan(Math.tan(vfov) * aspect);
    const half = Math.min(vfov, hfov);
    const r = (s) => (0.09 * s * 1.2) / Math.tan(half);
    if (scale <= 8) return r(8);
    return r(scale) * 0.75;
  }

  function placeModel() {
    if (S.mode === 'enter') return;
    const o = modelo.object3D, p = pivot.object3D;
    o.position.set(0, 0, 0);
    o.scale.setScalar(S.scale);
    o.rotation.set(S.rot.x, S.rot.y, 0);
    if (S.inVR) {
      const c = camWorldPos(), yaw = camYaw(), d = VR_DIST[S.scale] * S.zoom;
      S.baseYaw = yaw;
      p.position.set(c.x - Math.sin(yaw) * d, c.y - 0.1, c.z - Math.cos(yaw) * d);
      p.rotation.set(0, yaw, 0);
      VRUI.place();
    } else {
      p.rotation.set(0, 0, 0);
      p.position.set(0, 1.55, -fitDistance(S.scale) * S.zoom);
    }
  }

  function resetLook() {
    const lc = camEl.components['look-controls'];
    if (lc && lc.pitchObject && lc.yawObject) { lc.pitchObject.rotation.x = 0; lc.yawObject.rotation.y = 0; }
    camEl.object3D.rotation.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ seleção / picking
  function pickWithRay(ray) {
    if (S.inVR && VRUI.group && VRUI.el.object3D.visible) {
      const hb = ray.intersectObjects(VRUI.buttons, false)[0];
      if (hb) return { type: 'button', id: hb.object.userData.btn };
      if (ray.intersectObject(VRUI.panel, false)[0]) return { type: 'panel' };
    }
    const list = Object.values(S.meshes).filter((m) => m.visible);
    const hits = ray.intersectObjects(list, false);
    let fallback = null;
    for (const h of hits) {
      const id = h.object.userData.group, op = h.object.material.opacity;
      if (op < 0.3) continue; // paredes transparentes e estruturas esmaecidas: o clique atravessa
      if (GROUP[id].layer === 'cavidades' || op < 0.5) { if (!fallback) fallback = id; continue; }
      return { type: 'group', id };
    }
    return fallback ? { type: 'group', id: fallback } : null;
  }

  function pickScreen(clientX, clientY) {
    const r = scene.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    threeCam.updateMatrixWorld(true);
    R.ray.setFromCamera(ndc, threeCam);
    handlePick(pickWithRay(R.ray));
  }

  function rayFromController(el) {
    const rc = el.components.raycaster;
    if (rc && rc.updateOriginDirection && rc.raycaster) {
      rc.updateOriginDirection();
      R.ray.set(rc.raycaster.ray.origin, rc.raycaster.ray.direction);
    } else {
      el.object3D.updateMatrixWorld(true);
      el.object3D.getWorldPosition(R.v);
      el.object3D.getWorldQuaternion(R.q);
      R.ray.set(R.v, R.v2.set(0, 0, -1).applyQuaternion(R.q));
    }
    return R.ray;
  }

  function handlePick(res) {
    if (!res) return;
    if (res.type === 'button') return action(res.id);
    if (res.type === 'group') select(res.id, { from3D: true });
  }

  function select(id, opts = {}) {
    if (!GROUP[id]) return;
    if (S.mode === 'quiz') return Quiz.pick(id);
    S.selected = id;
    applyVisuals();
    UI.showInfo(id);
    if (opts.speak !== false) Speech.speak(GROUP[id].nome + '. ' + GROUP[id].texto);
    VRUI.refresh();
  }

  function clearSelection() { S.selected = null; applyVisuals(); UI.hideInfo(); VRUI.refresh(); }

  // ------------------------------------------------------------------ trajeto do sangue
  const Path = {
    curve: null, sphere: null, glow: null, line: null, ts: [],
    build() {
      const pts = C.PATH_POINTS.map((p) => (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : S.centers[p].clone()));
      this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const n = pts.length - 1;
      this.ts = pts.map((_, i) => i / n);

      const mat = new THREE.MeshBasicMaterial({ color: BLUE, depthTest: false, transparent: true });
      this.sphere = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 24, 16), mat);
      this.sphere.renderOrder = 10;
      this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.008, 24, 16),
        new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.35, depthTest: false, blending: THREE.AdditiveBlending }));
      this.glow.renderOrder = 9;
      this.sphere.add(this.glow);

      const N = 240, positions = new Float32Array(N * 3), colors = new Float32Array(N * 3);
      const tRed = this.ts[C.PATH_STEPS[C.PATH_RED_FROM].seg[0]];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1), p = this.curve.getPoint(t), c = t <= tRed ? BLUE : RED;
        positions.set([p.x, p.y, p.z], i * 3); colors.set([c.r, c.g, c.b], i * 3);
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      lg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false }));
      this.line.renderOrder = 8;

      this.sphere.visible = this.line.visible = false;
      modelo.object3D.add(this.sphere, this.line);
    },
    start() {
      if (S.mode === 'quiz') return UI.toast('Encerre o desafio antes de iniciar o trajeto.');
      if (S.mode === 'enter') Enter.exit(true);
      S.mode = 'path'; S.selected = null; S.wallsBefore = S.walls; S.walls = true;
      this.sphere.visible = this.line.visible = true;
      UI.setMode(); this.go(0);
    },
    go(i) {
      if (i >= C.PATH_STEPS.length) return this.exit();
      i = Math.max(0, i);
      S.path.i = i;
      const st = C.PATH_STEPS[i];
      const red = i >= C.PATH_RED_FROM;
      this.sphere.material.color.copy(red ? RED : BLUE);
      this.glow.material.color.copy(red ? RED : BLUE);
      const a = this.ts[st.seg[0]], b = this.ts[st.seg[1]];
      const span = Math.max(1, st.seg[1] - st.seg[0]);
      S.path.anim = { t0: performance.now(), dur: REDUCED ? 0 : 1400 * span, a, b };
      if (REDUCED) this.sphere.position.copy(this.curve.getPoint(b));
      applyVisuals(); UI.showPathStep(); VRUI.refresh();
      this.speakStep();
    },
    speakStep() { const st = C.PATH_STEPS[S.path.i]; Speech.speak(`Passo ${S.path.i + 1}. ${st.titulo}. ${st.texto}`, true && S.audio); },
    tick(now) {
      const an = S.path.anim;
      if (S.mode !== 'path' || !an) return;
      const k = an.dur ? Math.min(1, (now - an.t0) / an.dur) : 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.sphere.position.copy(this.curve.getPoint(an.a + (an.b - an.a) * e));
      const pulse = REDUCED ? 1 : 1 + 0.25 * Math.sin(now * 0.006);
      this.glow.scale.setScalar(pulse);
    },
    finishAnim() { const an = S.path.anim; if (an) an.dur = 0; },
    exit() {
      if (S.mode !== 'path') return;
      S.mode = 'explore'; S.walls = S.wallsBefore; S.path.anim = null;
      this.sphere.visible = this.line.visible = false;
      Speech.stop(); applyVisuals(); UI.setMode(); VRUI.refresh();
    },
  };

  // ------------------------------------------------------------------ entrar no coração
  const Enter = {
    start(key) {
      const cfg = C.ENTER[key];
      if (!cfg || !S.ready) return;
      if (S.mode === 'quiz') return UI.toast('Encerre o desafio antes de entrar no coração.');
      if (S.mode === 'path') Path.exit();
      if (!S.inVR) camEl.setAttribute('look-controls', { mouseEnabled: true, touchEnabled: true, magicWindowTrackingEnabled: IS_MOBILE });
      fade(() => {
        if (!S.inVR) resetLook();
        S.mode = 'enter'; S.selected = null; S.enter = { cfg, key };
        this.position();
        applyVisuals(); UI.setMode(); VRUI.refresh();
        Speech.speak(S.enter.desc, true && S.audio);
      });
    },
    position() {
      const { cfg } = S.enter;
      const c = S.centers[cfg.cavidade].clone();
      const target = S.centers[cfg.olhar];
      c.y += 0.4 * (target.y - c.y); // aproxima o olhar da altura do alvo
      const back = new THREE.Vector3(c.x - target.x, 0, c.z - target.z);
      if (back.lengthSq() > 1e-10) c.add(back.normalize().multiplyScalar(0.007)); // recua 7 mm (~18 cm na escala 25×) para enquadrar o alvo
      const o = modelo.object3D, p = pivot.object3D;
      document.querySelector('#chao').object3D.visible = false;
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(ENTER_SCALE);
      o.position.copy(c).multiplyScalar(-ENTER_SCALE);
      const eye = camWorldPos();
      const f = camForward(); f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
      const t = target.clone().sub(c);
      const yaw = Math.atan2(f.x, f.z) - Math.atan2(t.x, t.z);
      p.position.copy(eye);
      p.rotation.set(0, yaw, 0);
      headlamp.intensity = 0.6;
      // descrição espacial calculada a partir da geometria
      const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      const parts = cfg.pois.map((poi) => {
        const v = S.centers[poi.id].clone().sub(c).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).normalize();
        return cap(describeDir(v, f, right)) + ', ' + poi.nome + '.';
      });
      S.enter.desc = `Você está dentro do ${cfg.nome}. ${parts.join(' ')} Gire a cabeça para olhar ao redor.`;
    },
    exit(noFade) {
      if (S.mode !== 'enter') return;
      const done = () => {
        S.mode = 'explore'; S.enter = null; headlamp.intensity = 0;
        document.querySelector('#chao').object3D.visible = true;
        if (!S.inVR) { camEl.setAttribute('look-controls', { mouseEnabled: false, touchEnabled: false, magicWindowTrackingEnabled: false }); resetLook(); }
        placeModel(); applyVisuals(); UI.setMode(); VRUI.refresh(); Speech.stop();
      };
      noFade ? done() : fade(done);
    },
  };

  function describeDir(v, f, right) {
    const fwd = v.dot(f), rt = v.dot(right), up = v.y, parts = [];
    if (fwd > 0.5) parts.push('à sua frente'); else if (fwd < -0.5) parts.push('atrás de você');
    if (up > 0.45) parts.push('acima'); else if (up < -0.45) parts.push('abaixo');
    if (rt > 0.45) parts.push('à sua direita'); else if (rt < -0.45) parts.push('à sua esquerda');
    if (!parts.length) parts.push('perto de você');
    return parts.join(' e ');
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------------ fade (300 ms)
  let fader, headlamp;
  function fade(mid) {
    if (REDUCED || !fader) { mid(); return; }
    S.fade = { t0: performance.now(), phase: 'out', mid };
  }
  function tickFade(now) {
    const f = S.fade;
    if (!f) { fader.visible = false; return; }
    const k = Math.min(1, (now - f.t0) / 300);
    fader.visible = true;
    camWorldPos(fader.position);
    fader.material.opacity = f.phase === 'out' ? k : 1 - k;
    if (k >= 1) {
      if (f.phase === 'out') { try { f.mid(); } finally { f.phase = 'in'; f.t0 = performance.now(); } }
      else S.fade = null;
    }
  }

  // ------------------------------------------------------------------ desafio
  const Quiz = {
    start(code) {
      if (S.mode === 'path') Path.exit();
      if (S.mode === 'enter') Enter.exit(true);
      S.selected = null; S.walls = false;
      ['vasos', 'coronarias', 'valvas'].forEach((l) => (S.layers[l] = true)); S.layers.contexto = false;
      const order = C.QUIZ.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      S.quiz = { code, order, i: 0, items: [], inicio: new Date(), plataforma_inicio: platform(), locked: false };
      S.mode = 'quiz';
      UI.hideInfo(); UI.syncControls(); applyVisuals(); UI.setMode();
      this.show();
    },
    current() { return S.quiz.order[S.quiz.i]; },
    show() {
      const q = S.quiz;
      Object.assign(q, { t0: performance.now(), erros: 0, dica: false, locked: false });
      S.hint = null; applyVisuals();
      UI.showQuestion(`Pergunta ${q.i + 1} de ${q.order.length}`, this.current().pergunta, '', '');
      VRUI.refresh();
      Speech.speak(this.current().pergunta);
    },
    pick(id) {
      const q = S.quiz;
      if (!q || q.locked) return;
      const alvo = this.current().alvo;
      if (id === alvo) {
        this.record(false);
        q.locked = true; S.selected = id; S.hint = null; applyVisuals();
        this.feedback('Correto! ' + GROUP[id].nome + '.', 'ok');
        Speech.speak('Correto!');
        setTimeout(() => { S.selected = null; this.next(); }, 1400);
      } else {
        q.erros++;
        let msg = `Não é essa: você selecionou ${GROUP[id].nome}. Tente de novo.`;
        if (q.erros >= 2) {
          if (!q.dica) {
            q.dica = true; S.hint = alvo;
            const lay = GROUP[alvo].layer;
            if (lay === 'valvas' || lay === 'cavidades') S.walls = true;
            if (S.layers[lay] === false) S.layers[lay] = true;
            UI.syncControls(); applyVisuals();
          }
          msg += ' Dica: a estrutura certa está piscando em verde.';
        }
        this.feedback(msg, 'err');
        Speech.speak('Não é essa. Tente de novo.');
      }
    },
    feedback(msg, cls) { UI.quizFeedback(msg, cls); VRUI.refresh(msg); },
    record(pulou) {
      const q = S.quiz, cur = this.current();
      q.items.push({
        ordem: q.i + 1, alvo: cur.alvo, estrutura: GROUP[cur.alvo].nome,
        tempo_ms: Math.round(performance.now() - q.t0), erros: q.erros, dica: q.dica, pulou, plataforma: platform(),
      });
    },
    skip() { if (!S.quiz || S.quiz.locked) return; this.record(true); this.next(); },
    next() {
      const q = S.quiz;
      q.i++;
      if (q.i >= q.order.length) return this.finish();
      this.show();
    },
    abort() {
      if (S.mode !== 'quiz') return;
      if (S.quiz.items.length && !confirm('Encerrar o desafio agora? As respostas até aqui serão mostradas.')) return;
      this.finish();
    },
    finish() {
      const q = S.quiz;
      S.mode = 'explore'; S.hint = null; S.selected = null;
      const fim = new Date();
      const result = {
        participante: q.code, plataforma_inicio: q.plataforma_inicio,
        inicio: q.inicio.toISOString(), fim: fim.toISOString(),
        tempo_total_s: +((fim - q.inicio) / 1000).toFixed(1),
        total: q.order.length, respondidas: q.items.length,
        acertos: q.items.filter((it) => !it.pulou).length,
        acertos_primeira: q.items.filter((it) => !it.pulou && it.erros === 0).length,
        itens: q.items,
      };
      S.quiz = null;
      saveResult(result);
      applyVisuals(); UI.setMode(); VRUI.refresh();
      UI.showResults(result);
      Speech.speak(`Desafio concluído. ${result.acertos} de ${result.total} estruturas encontradas.`);
    },
  };

  const CSV_HEAD = 'participante,plataforma_inicio,inicio,ordem,alvo,estrutura,tempo_s,erros,dica,pulou,plataforma_resposta';
  function toCSVRows(r) {
    return r.itens.map((it) => [r.participante, r.plataforma_inicio, r.inicio, it.ordem, it.alvo, `"${it.estrutura}"`,
      (it.tempo_ms / 1000).toFixed(1), it.erros, it.dica ? 1 : 0, it.pulou ? 1 : 0, it.plataforma].join(','));
  }
  function toCSV(results) { return [CSV_HEAD].concat(...results.map(toCSVRows)).join('\n'); }
  function savedResults() { return loadPref('coracao_resultados', []); }
  function saveResult(r) { const all = savedResults(); all.push(r); savePref('coracao_resultados', all); }

  // ------------------------------------------------------------------ ações (HTML e botões 3D)
  function action(id) {
    switch (id) {
      case 'path': return Path.start();
      case 'enter-ad': return Enter.start('atrio_direito');
      case 'enter-ve': return Enter.start('ventriculo_esquerdo');
      case 'quiz': return S.inVR ? UI.toast('Inicie o desafio fora do VR para digitar o código.') : UI.openQuizStart();
      case 'walls': S.walls = !S.walls; if (S.mode === 'path') S.wallsBefore = S.walls; UI.syncControls(); applyVisuals(); return VRUI.refresh();
      case 'next': return Path.go(S.path.i + 1);
      case 'prev': return Path.go(S.path.i - 1);
      case 'repeat': return Speech.speak(pathSpeech(), true);
      case 'exit': return exitMode();
      case 'speak': return speakCurrent();
      case 'scale': return setScale(S.scale === 1 ? 8 : S.scale === 8 ? 20 : 1);
      case 'recenter': return recenter();
      case 'skip': return Quiz.skip();
      case 'quiz-exit': return Quiz.abort();
    }
  }
  function pathSpeech() { const st = C.PATH_STEPS[S.path.i]; return `Passo ${S.path.i + 1}. ${st.titulo}. ${st.texto}`; }
  function exitMode() {
    if (S.mode === 'path') Path.exit();
    else if (S.mode === 'enter') Enter.exit();
    else if (S.mode === 'quiz') Quiz.abort();
    else clearSelection();
  }
  function speakCurrent() {
    if (S.mode === 'path') return Speech.speak(pathSpeech(), true);
    if (S.mode === 'enter') return Speech.speak(S.enter.desc, true);
    if (S.mode === 'quiz') return Speech.speak(Quiz.current().pergunta, true);
    if (S.selected) return Speech.speak(GROUP[S.selected].nome + '. ' + GROUP[S.selected].texto, true);
    Speech.speak('Toque, clique ou olhe para uma estrutura para ouvir o nome dela.', true);
  }
  function setScale(s) {
    S.scale = s; S.zoom = 1; UI.syncControls();
    if (S.mode !== 'enter') placeModel();
    VRUI.refresh();
  }
  function recenter() {
    Speech.stop(); Path.finishAnim();
    S.rot = { x: 0, y: 0 }; S.zoom = 1;
    if (S.mode === 'enter') { Enter.position(); VRUI.place(); }
    else { if (!S.inVR) resetLook(); placeModel(); }
    UI.toast('Pausado e recentralizado.');
  }

  // ------------------------------------------------------------------ painel e botões 3D (VR)
  const VRUI = {
    el: null, group: null, panel: null, buttons: [], sig: '', canvas: null, ctx: null, tex: null, hovered: null,
    init(el) {
      this.el = el;
      this.group = new THREE.Group();
      el.setObject3D('ui', this.group);
      this.canvas = document.createElement('canvas'); this.canvas.width = 1024; this.canvas.height = 512;
      this.ctx = this.canvas.getContext('2d');
      this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
      this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4),
        new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
      this.panel.renderOrder = 1000;
      this.group.add(this.panel);
    },
    place() {
      if (!this.el || !S.inVR) return;
      const c = camWorldPos(), yaw = camYaw();
      const off = S.mode === 'enter' ? 0.75 : 0.6, d = S.mode === 'enter' ? 0.7 : 0.85;
      const a = yaw + off; // à esquerda do usuário
      this.el.object3D.position.set(c.x - Math.sin(a) * d, c.y - 0.15, c.z - Math.cos(a) * d);
      this.el.object3D.lookAt(c.x, c.y - 0.15, c.z);
    },
    drawPanel(title, body, foot) {
      const ctx = this.ctx, W = 1024, H = 512;
      ctx.clearRect(0, 0, W, H);
      roundRect(ctx, 4, 4, W - 8, H - 8, 36); ctx.fillStyle = 'rgba(16,20,26,0.95)'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffcf6b'; ctx.stroke();
      ctx.fillStyle = '#ffcf6b'; ctx.font = 'bold 58px system-ui, sans-serif'; ctx.textBaseline = 'top';
      let y = 36;
      for (const line of wrap(ctx, title, W - 96).slice(0, 2)) { ctx.fillText(line, 48, y); y += 66; }
      ctx.fillStyle = '#f4f6f8'; ctx.font = '40px system-ui, sans-serif'; y += 10;
      for (const line of wrap(ctx, body, W - 96).slice(0, 7)) { ctx.fillText(line, 48, y); y += 50; }
      if (foot) { ctx.fillStyle = '#c3cad3'; ctx.font = 'italic 32px system-ui, sans-serif'; ctx.fillText(wrap(ctx, foot, W - 96)[0], 48, H - 64); }
      this.tex.needsUpdate = true;
    },
    setButtons(list) {
      const sig = list.map((b) => b.id + ':' + b.label).join('|');
      if (sig === this.sig) return;
      this.sig = sig;
      this.buttons.forEach((b) => { this.group.remove(b); b.material.map.dispose(); b.material.dispose(); b.geometry.dispose(); });
      this.buttons = [];
      const perRow = 4, w = 0.185, h = 0.07, gap = 0.012;
      list.forEach((b, i) => {
        const row = Math.floor(i / perRow), col = i % perRow;
        const nRow = Math.min(perRow, list.length - row * perRow);
        const cv = document.createElement('canvas'); cv.width = 384; cv.height = 144;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
        mesh.renderOrder = 1001;
        mesh.position.set((col - (nRow - 1) / 2) * (w + gap), -0.2 - gap - h / 2 - row * (h + gap), 0.001);
        mesh.userData = { btn: b.id, label: b.label, primary: b.primary, cv };
        this.drawButton(mesh, false);
        this.group.add(mesh); this.buttons.push(mesh);
      });
    },
    drawButton(mesh, hover) {
      const { cv, label, primary } = mesh.userData, ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      roundRect(ctx, 6, 6, cv.width - 12, cv.height - 12, 26);
      ctx.fillStyle = primary ? '#ffcf6b' : hover ? '#36404c' : '#1f262f'; ctx.fill();
      ctx.lineWidth = hover ? 10 : 5; ctx.strokeStyle = hover ? '#ffffff' : primary ? '#ffcf6b' : '#5a6575'; ctx.stroke();
      ctx.fillStyle = primary ? '#1a1400' : '#f4f6f8'; ctx.font = 'bold 44px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let fs = 44; while (ctx.measureText(label).width > cv.width - 36 && fs > 26) { fs -= 2; ctx.font = `bold ${fs}px system-ui, sans-serif`; }
      ctx.fillText(label, cv.width / 2, cv.height / 2 + 2);
      mesh.material.map.needsUpdate = true;
    },
    setHover(id) {
      if (id === this.hovered) return;
      this.hovered = id;
      this.buttons.forEach((b) => this.drawButton(b, b.userData.btn === id));
    },
    refresh(extra) {
      if (!this.el) return;
      let title, body, foot = '', btns;
      const wallsLbl = S.walls ? 'Paredes: opacas' : 'Paredes: transp.';
      if (S.mode === 'path') {
        const st = C.PATH_STEPS[S.path.i];
        title = `Passo ${S.path.i + 1} de ${C.PATH_STEPS.length}: ${st.titulo}`; body = st.texto;
        btns = [{ id: 'prev', label: '◀ Anterior' }, { id: 'next', label: S.path.i === C.PATH_STEPS.length - 1 ? 'Concluir' : 'Próximo ▶', primary: true },
          { id: 'repeat', label: 'Repetir' }, { id: 'walls', label: wallsLbl }, { id: 'exit', label: 'Sair' }];
      } else if (S.mode === 'enter') {
        title = 'Dentro do ' + S.enter.cfg.nome; body = S.enter.desc;
        btns = [{ id: 'speak', label: 'Ouvir' }, { id: 'exit', label: 'Sair', primary: true }];
      } else if (S.mode === 'quiz') {
        title = `Pergunta ${S.quiz.i + 1} de ${S.quiz.order.length}`; body = Quiz.current().pergunta + (extra ? '\n' + extra : '');
        btns = [{ id: 'walls', label: wallsLbl }, { id: 'speak', label: 'Ouvir' }, { id: 'skip', label: 'Pular' }, { id: 'quiz-exit', label: 'Encerrar' }];
      } else {
        if (S.selected) { title = GROUP[S.selected].nome; body = GROUP[S.selected].texto; }
        else { title = 'Coração por Dentro'; body = 'Aponte o controle (ou olhe por 1,5 s) para uma estrutura para ver o nome e ouvir a explicação.'; }
        btns = [{ id: 'walls', label: wallsLbl }, { id: 'path', label: 'Trajeto' }, { id: 'enter-ad', label: 'Entrar AD' }, { id: 'enter-ve', label: 'Entrar VE' },
          { id: 'speak', label: 'Ouvir' }, { id: 'scale', label: `Escala ${S.scale}×` }, { id: 'recenter', label: 'Recentrar' }];
      }
      foot = S.controllers.size ? 'Gatilho do controle seleciona.' : 'Olhe fixamente 1,5 s para selecionar.';
      this.drawPanel(title, body, foot);
      this.setButtons(btns);
    },
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrap(ctx, text, maxW) {
    const out = [];
    String(text).split('\n').forEach((para) => {
      let line = '';
      para.split(/\s+/).forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }

  // ------------------------------------------------------------------ cursor de olhar (Cardboard)
  const Gaze = {
    group: null, ring: null, prog: null,
    init(sceneObj) {
      this.group = new THREE.Group();
      const m = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false });
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.014, 32), m('#ffffff', 0.9));
      this.prog = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.022, 32, 1, 0, 0.001), m('#ffcf6b', 1));
      this.ring.renderOrder = this.prog.renderOrder = 2000;
      this.group.add(this.ring, this.prog);
      this.group.visible = false;
      sceneObj.add(this.group);
    },
    setProgress(k) {
      this.prog.geometry.dispose();
      this.prog.geometry = new THREE.RingGeometry(0.016, 0.022, 32, 1, Math.PI / 2, -Math.max(0.001, k * Math.PI * 2));
    },
    tick(now) {
      const active = S.inVR && S.controllers.size === 0;
      this.group.visible = active;
      if (!active) return;
      const p = camWorldPos(), d = camForward();
      this.group.position.copy(p).addScaledVector(d, 0.8);
      threeCam.getWorldQuaternion(this.group.quaternion);
      if (now - S.gaze.last < 90) return;
      S.gaze.last = now;
      R.ray.set(p, d);
      const res = pickWithRay(R.ray);
      const key = res ? (res.type === 'button' ? 'b:' + res.id : res.type === 'group' ? 'g:' + res.id : null) : null;
      VRUI.setHover(res && res.type === 'button' ? res.id : null);
      if (key !== S.gaze.key) { S.gaze.key = key; S.gaze.t0 = now; if (key !== S.gaze.lock) S.gaze.lock = null; }
      if (!key || key === S.gaze.lock) { this.setProgress(0); return; }
      const k = (now - S.gaze.t0) / GAZE_MS;
      this.setProgress(Math.min(1, k));
      if (k >= 1) { S.gaze.lock = key; this.setProgress(0); handlePick(res); }
    },
  };

  // ------------------------------------------------------------------ interface HTML
  const UI = {
    init() {
      // camadas
      const lt = $('#layerToggles');
      C.LAYERS.forEach((l) => {
        const lab = document.createElement('label'); lab.className = 'switch';
        lab.innerHTML = `<input type="checkbox" data-layer="${l.id}"> <span>${l.nome}</span>`;
        lt.appendChild(lab);
      });
      lt.addEventListener('change', (e) => { const l = e.target.dataset.layer; if (l) { S.layers[l] = e.target.checked; applyVisuals(); } });
      $('#tglWalls').addEventListener('change', (e) => { S.walls = e.target.checked; if (S.mode === 'path') S.wallsBefore = S.walls; applyVisuals(); VRUI.refresh(); });

      // escala
      document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => setScale(+b.dataset.scale)));

      // lista de estruturas
      const ul = $('#structList');
      let lastLayer = null;
      C.GROUPS.forEach((g) => {
        if (g.layer !== lastLayer) {
          lastLayer = g.layer;
          const h = document.createElement('li'); h.className = 'group-label'; h.textContent = LAYER_TITLES[g.layer]; h.setAttribute('aria-hidden', 'true');
          ul.appendChild(h);
        }
        const li = document.createElement('li');
        li.innerHTML = `<button data-id="${g.id}"><span class="swatch" style="background:${g.cor}"></span>${g.nome}</button>`;
        ul.appendChild(li);
      });
      ul.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]'); if (!b) return;
        select(b.dataset.id);
        if (IS_MOBILE || innerWidth <= 820) this.closeMenu();
      });

      // atividades
      document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => { this.closeMenu(); action(b.dataset.action); }));

      // topo
      $('#btnMenu').addEventListener('click', () => this.toggleMenu());
      $('#btnMenuClose').addEventListener('click', () => { this.closeMenu(); $('#btnMenu').focus(); });
      document.addEventListener('pointerdown', (e) => {
        const sb = $('#sidebar');
        if (sb.classList.contains('open') && !sb.contains(e.target) && e.target.id !== 'btnMenu') this.closeMenu();
      });
      $('#btnAudio').addEventListener('click', () => { S.audio = !S.audio; savePref('coracao_audio', S.audio); if (!S.audio) Speech.stop(); this.syncControls(); });
      $('#btnRecenter').addEventListener('click', recenter);
      $('#btnAbout').addEventListener('click', () => this.modal('Sobre e créditos', $('#tplAbout').content.cloneNode(true)));
      $('#btnVR').addEventListener('click', () => scene.enterVR());

      // painel de informação
      $('#infoClose').addEventListener('click', clearSelection);
      $('#btnSpeak').addEventListener('click', () => S.selected && Speech.speak(GROUP[S.selected].nome + '. ' + GROUP[S.selected].texto, true));
      $('#btnLibras').addEventListener('click', () => this.libras(S.selected ? GROUP[S.selected].nome : ''));

      // modos
      $('#pathPrev').addEventListener('click', () => action('prev'));
      $('#pathNext').addEventListener('click', () => action('next'));
      $('#pathRepeat').addEventListener('click', () => action('repeat'));
      $('#pathExit').addEventListener('click', () => Path.exit());
      $('#enterSpeak').addEventListener('click', () => action('speak'));
      $('#enterExit').addEventListener('click', () => Enter.exit());
      $('#quizSkip').addEventListener('click', () => Quiz.skip());
      $('#quizExit').addEventListener('click', () => Quiz.abort());

      // modal
      $('#modalClose').addEventListener('click', () => this.closeModal());
      $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') this.closeModal(); });

      // início
      $('#btnStart').addEventListener('click', () => {
        $('#splash').hidden = true; S.started = true;
        Speech.speak('Bem-vindo ao Coração por Dentro. Toque ou clique em uma estrutura para ouvir o nome dela.');
        setTimeout(() => this.checkVoice(), 800);
      });

      document.addEventListener('keydown', (e) => this.onKey(e));
      this.syncControls();
    },

    checkVoice() {
      if (!Speech.ok) return this.toast('Áudio indisponível neste navegador. Use o texto na tela.', 5000);
      if (!S.voice && speechSynthesis.getVoices().length) this.toast('Não há voz em português neste aparelho; o áudio usará a voz padrão.', 5000);
    },

    toggleMenu(force) {
      const sb = $('#sidebar'), open = force != null ? force : !sb.classList.contains('open');
      sb.classList.toggle('open', open);
      $('#btnMenu').setAttribute('aria-expanded', String(open));
    },
    closeMenu() { this.toggleMenu(false); },

    syncControls() {
      $('#tglWalls').checked = S.walls;
      document.querySelectorAll('[data-layer]').forEach((i) => (i.checked = !!S.layers[i.dataset.layer]));
      document.querySelectorAll('[data-scale]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.scale === S.scale)));
      const a = $('#btnAudio'); a.setAttribute('aria-pressed', String(S.audio)); a.textContent = S.audio ? '🔊 Áudio ligado' : '🔇 Áudio desligado';
    },

    syncList() {
      document.querySelectorAll('#structList button[data-id]').forEach((b) => {
        const id = b.dataset.id, m = S.meshes[id];
        b.setAttribute('aria-current', String(S.selected === id));
        b.classList.toggle('off', !!m && !m.visible);
      });
      $('#tglWalls').checked = S.walls;
    },

    showInfo(id) {
      if (S.mode !== 'explore') return;
      const g = GROUP[id];
      $('#infoTitle').textContent = g.nome; $('#infoText').textContent = g.texto;
      $('#info').hidden = false;
    },
    hideInfo() { $('#info').hidden = true; },

    setMode() {
      const m = S.mode;
      $('#pathBar').hidden = m !== 'path';
      $('#enterBar').hidden = m !== 'enter';
      $('#quizBar').hidden = m !== 'quiz';
      $('#listSection').hidden = m === 'quiz';
      if (m !== 'explore') this.hideInfo(); else if (S.selected) this.showInfo(S.selected);
      if (m === 'enter') {
        $('#enterTitle').textContent = 'Dentro do ' + S.enter.cfg.nome;
        $('#enterText').textContent = S.enter.desc + (S.inVR ? '' : IS_MOBILE ? ' (Mova o celular ou arraste para olhar.)' : ' (Arraste para olhar.)');
      }
      this.syncControls();
    },

    showPathStep() {
      const i = S.path.i, st = C.PATH_STEPS[i];
      $('#pathStep').textContent = `Passo ${i + 1} de ${C.PATH_STEPS.length}: ${st.titulo}`;
      $('#pathText').textContent = st.texto;
      $('#pathPrev').disabled = i === 0;
      $('#pathNext').textContent = i === C.PATH_STEPS.length - 1 ? 'Concluir ✓' : 'Próximo ▶';
    },

    showQuestion(count, q) {
      $('#quizCount').textContent = count; $('#quizQuestion').textContent = q;
      this.quizFeedback('', '');
    },
    quizFeedback(msg, cls) { const f = $('#quizFeedback'); f.textContent = msg; f.className = 'feedback ' + (cls || ''); },

    toast(msg, ms = 2600) {
      const t = $('#toast'); t.textContent = msg; t.hidden = false;
      clearTimeout(this._tt); this._tt = setTimeout(() => (t.hidden = true), ms);
      if (S.inVR) VRUI.refresh(msg);
    },

    modal(title, content) {
      $('#modalTitle').textContent = title;
      const body = $('#modalBody'); body.innerHTML = '';
      if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);
      $('#modal').hidden = false;
      this._lastFocus = document.activeElement;
      setTimeout(() => { const f = body.querySelector('input, button, textarea, a') || $('#modalClose'); f.focus(); }, 30);
    },
    closeModal() { $('#modal').hidden = true; if (this._lastFocus && this._lastFocus.focus) this._lastFocus.focus(); },

    libras(nome) {
      this.modal('Libras', `<div class="libras-box"><div><div style="font-size:3rem">🤟</div>
        <p><strong>Vídeo em Libras</strong>${nome ? ': ' + nome : ''}</p>
        <p>Conteúdo será gravado com intérprete.<br><em>(Simulado neste MVP.)</em></p></div></div>`);
    },

    openQuizStart() {
      const n = savedResults().length;
      this.modal('Desafio: encontre as estruturas', `
        <p>Seis perguntas do tipo “Encontre…”, em ordem aleatória. Selecione a estrutura no modelo 3D (a lista lateral fica oculta durante o desafio). Depois de 2 erros, a estrutura certa pisca.</p>
        <form id="quizForm">
          <div class="field">
            <label for="pcode"><strong>Código do participante</strong> (ex.: P07). Não use seu nome.</label>
            <input id="pcode" required maxlength="12" pattern="[A-Za-z0-9_\\-]{1,12}" autocomplete="off" placeholder="P07">
          </div>
          <div class="row"><button class="btn primary big" type="submit">Começar o desafio</button></div>
        </form>
        <h3>Resultados salvos neste aparelho: ${n}</h3>
        <div class="row">
          <button class="btn" id="dlAll" ${n ? '' : 'disabled'}>Baixar todos (CSV)</button>
          <button class="btn" id="clrAll" ${n ? '' : 'disabled'}>Apagar resultados salvos</button>
        </div>`);
      $('#quizForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = $('#pcode').value.trim().toUpperCase();
        if (!code) return;
        this.closeModal(); Quiz.start(code);
      });
      $('#dlAll').addEventListener('click', () => download(`desafio_todos_${today()}.csv`, toCSV(savedResults())));
      $('#clrAll').addEventListener('click', () => {
        if (confirm(`Apagar os ${n} resultados salvos neste aparelho? Isso não pode ser desfeito.`)) { savePref('coracao_resultados', []); this.openQuizStart(); }
      });
    },

    showResults(r) {
      const json = JSON.stringify(r, null, 2), csv = toCSV([r]);
      const rows = r.itens.map((it) => `<tr><td>${it.ordem}</td><td>${it.estrutura}</td><td>${(it.tempo_ms / 1000).toFixed(1)} s</td>
        <td>${it.erros}</td><td>${it.dica ? 'sim' : 'não'}</td><td>${it.pulou ? 'pulou' : '✓'}</td></tr>`).join('');
      this.modal('Desafio concluído', `
        <p><strong>Participante:</strong> ${r.participante} · <strong>Plataforma:</strong> ${r.plataforma_inicio}</p>
        <p style="font-size:1.25rem"><strong>${r.acertos} de ${r.total}</strong> encontradas (${r.acertos_primeira} de primeira) · tempo total <strong>${r.tempo_total_s} s</strong></p>
        <table class="results"><thead><tr><th>#</th><th>Estrutura</th><th>Tempo</th><th>Erros</th><th>Dica</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="row" style="margin:14px 0">
          <button class="btn primary" id="copyRes">📋 Copiar resultados</button>
          <button class="btn" id="dlRes">Baixar CSV</button>
        </div>
        <label for="exportTxt" class="hint">JSON e CSV (se a cópia falhar, selecione o texto abaixo):</label>
        <textarea id="exportTxt" class="export" readonly></textarea>`);
      const ta = $('#exportTxt'); ta.value = json + '\n\n' + csv;
      $('#copyRes').addEventListener('click', () => copyText(ta));
      $('#dlRes').addEventListener('click', () => download(`desafio_${r.participante}_${today()}.csv`, csv));
    },

    onKey(e) {
      if (!$('#modal').hidden) { if (e.key === 'Escape') this.closeModal(); return; }
      if (!$('#splash').hidden) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Escape') { if (S.mode !== 'explore') exitMode(); else { clearSelection(); this.closeMenu(); } return; }
      if (S.mode === 'path' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault(); return action(e.key === 'ArrowRight' ? 'next' : 'prev');
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const btns = Array.from(document.querySelectorAll('#structList button[data-id]'));
      const idx = btns.indexOf(document.activeElement);
      if (idx >= 0) { e.preventDefault(); btns[(idx + dir + btns.length) % btns.length].focus(); return; }
      if (S.mode !== 'explore') return;
      if (tag === 'button' || tag === 'a') return;
      e.preventDefault();
      const ids = C.GROUPS.map((g) => g.id);
      const cur = S.selected ? ids.indexOf(S.selected) : (dir > 0 ? -1 : 0);
      select(ids[(cur + dir + ids.length) % ids.length]);
    },
  };

  function today() { return new Date().toISOString().slice(0, 10); }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  function copyText(ta) {
    const fallback = () => {
      ta.focus(); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* sem suporte */ }
      UI.toast(ok ? 'Resultados copiados.' : 'Selecione o texto e copie manualmente.');
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(ta.value).then(() => UI.toast('Resultados copiados.'), fallback);
    else fallback();
  }

  // ------------------------------------------------------------------ arrastar, pinça e roda do mouse
  function setupPointer() {
    const cv = scene.canvas, ptrs = new Map();
    let pinch = null, multi = false;
    cv.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom }; multi = true; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (S.inVR || S.mode === 'enter') return;
      if (ptrs.size === 1 && !multi) {
        S.rot.y += dx * 0.008; S.rot.x = THREE.MathUtils.clamp(S.rot.x + dy * 0.008, -1.4, 1.4);
        modelo.object3D.rotation.set(S.rot.x, S.rot.y, 0);
      } else if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        S.zoom = THREE.MathUtils.clamp(pinch.z * (pinch.d / Math.max(1, d)), 0.35, 2.5); placeModel();
      }
    });
    const up = (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      ptrs.delete(e.pointerId);
      if (!multi && e.type === 'pointerup' && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6 && S.started) pickScreen(e.clientX, e.clientY);
      if (ptrs.size === 0) { multi = false; pinch = null; }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (S.inVR || S.mode === 'enter') return;
      e.preventDefault();
      S.zoom = THREE.MathUtils.clamp(S.zoom * Math.exp(e.deltaY * 0.001), 0.35, 2.5); placeModel();
    }, { passive: false });
    window.addEventListener('resize', () => setTimeout(placeModel, 50));
  }

  // ------------------------------------------------------------------ componentes A-Frame
  AFRAME.registerComponent('app-root', {
    init() {
      const sc = this.el;
      const boot = () => {
        threeCam = camEl.getObject3D('camera');
        fader = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12),
          new THREE.MeshBasicMaterial({ color: '#000', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
        fader.renderOrder = 3000; fader.visible = false; sc.object3D.add(fader);
        headlamp = new THREE.PointLight(0xfff1dd, 0, 0, 0); sc.object3D.add(headlamp);
        Gaze.init(sc.object3D);
        setupPointer();
        placeModel();
      };
      if (sc.hasLoaded) boot(); else sc.addEventListener('loaded', boot);

      sc.addEventListener('enter-vr', () => {
        if (!sc.is('vr-mode')) return;
        S.inVR = true; VRUI.el.object3D.visible = true;
        setTimeout(() => { if (S.mode === 'enter') { Enter.position(); VRUI.place(); } else placeModel(); VRUI.refresh(); }, 400);
      });
      sc.addEventListener('exit-vr', () => {
        S.inVR = false; VRUI.el.object3D.visible = false; Gaze.group.visible = false;
        if (S.mode === 'enter') Enter.exit(true);
        resetLook(); placeModel();
      });
    },
    tick(t) {
      if (!threeCam) return;
      const now = performance.now();
      tickFade(now);
      if (!S.ready) return;
      Path.tick(now);
      if (S.mode === 'enter' && headlamp) camWorldPos(headlamp.position);
      if (S.hint && S.meshes[S.hint]) S.meshes[S.hint].material.emissiveIntensity = REDUCED ? 0.8 : 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.008));
      if (S.inVR) {
        Gaze.tick(now);
        if (S.controllers.size && now - (this._hv || 0) > 60) {
          this._hv = now; let hov = null;
          S.controllers.forEach((id) => {
            const el = document.getElementById(id);
            const res = el && pickWithRay(rayFromController(el));
            if (res && res.type === 'button') hov = res.id;
          });
          VRUI.setHover(hov);
        }
      }
    },
  });

  AFRAME.registerComponent('controller-pick', {
    init() {
      const el = this.el;
      el.addEventListener('controllerconnected', () => { S.controllers.add(el.id); VRUI.refresh(); });
      el.addEventListener('controllerdisconnected', () => { S.controllers.delete(el.id); VRUI.refresh(); });
      el.addEventListener('triggerdown', () => { if (S.inVR && S.ready) handlePick(pickWithRay(rayFromController(el))); });
    },
  });

  AFRAME.registerComponent('vr-ui', { init() { VRUI.init(this.el); } });

  // ------------------------------------------------------------------ inicialização do DOM
  document.addEventListener('DOMContentLoaded', () => {
    scene = $('#scene'); camEl = $('#camera'); pivot = $('#pivot'); modelo = $('#modelo');
    window.__app = { S, action, select, Quiz, Path, Enter }; // usado pelos testes automatizados

    Speech.init();
    UI.init();

    const asset = $('#coracao'), fill = $('#progressFill'), txt = $('#progressText'), bar = document.querySelector('.progress');
    asset.addEventListener('progress', (e) => {
      const d = e.detail || {};
      if (d.totalBytes) {
        const pct = Math.round((100 * d.loadedBytes) / d.totalBytes);
        fill.style.width = pct + '%'; bar.setAttribute('aria-valuenow', pct);
        txt.textContent = `Carregando o modelo… ${pct}% (${(d.loadedBytes / 1048576).toFixed(1)} de ${(d.totalBytes / 1048576).toFixed(1)} MB)`;
      }
    });
    asset.addEventListener('error', () => { txt.textContent = 'Não foi possível baixar o modelo. Verifique a conexão e recarregue a página.'; });

    modelo.addEventListener('model-loaded', (e) => {
      setupModel(e.detail.model);
      S.ready = true;
      fill.style.width = '100%'; bar.setAttribute('aria-valuenow', 100);
      txt.textContent = 'Modelo carregado.';
      const b = $('#btnStart'); b.disabled = false; b.focus();
      VRUI.refresh();
      scene.emit('app-ready');
    });
    modelo.addEventListener('model-error', () => { txt.textContent = 'Erro ao abrir o modelo 3D.'; });

    if (navigator.xr && navigator.xr.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-vr').then((ok) => { $('#btnVR').hidden = !ok; }).catch(() => {});
    }
  });
})();
