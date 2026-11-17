/*
 * Visão Computacional do CheckFit: Pose Estimation com MediaPipe Pose Landmarker.
 *
 * O modelo roda dentro de uma WebView (funciona no Expo Go, sem módulo nativo):
 *  1. a página abre a câmera (getUserMedia) e detecta 33 pontos do corpo a cada quadro;
 *  2. calcula o ângulo da articulação principal do exercício (joelho ou cotovelo);
 *  3. conta uma repetição quando o ângulo vai da posição inicial até a posição
 *     profunda e volta (máquina de estados);
 *  4. dá uma nota de 0 a 100 para cada repetição (amplitude + alinhamento) e
 *     gera um feedback em texto;
 *  5. envia os resultados ao React Native via postMessage. O app grava em
 *     cv_reps / cv_score / cv_feedback no SQLite e a sincronização leva ao Supabase.
 */

export const MODES = {
  squat: { label: 'Agachamento', joint: 'joelho' },
  pushup: { label: 'Flexão', joint: 'cotovelo' },
  curl: { label: 'Rosca', joint: 'cotovelo' },
};

// Escolhe o tipo de análise pelo nome do exercício cadastrado
export function guessMode(name = '') {
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/flex|push|apoio|supino|bench/.test(n)) return 'pushup'; // mesmo movimento de cotovelo
  if (/rosca|biceps|curl/.test(n)) return 'curl';
  return 'squat'; // agachamento, leg press, afundo etc.
}

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export function buildPoseHtml(initialMode = 'squat') {
  return PAGE.replace('__MP_BASE__', MP_BASE)
    .replace('__MODEL_URL__', MODEL_URL)
    .replace('__MODE__', MODES[initialMode] ? initialMode : 'squat');
}

// Página executada dentro da WebView (HTML + JS puro).
const PAGE = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body{margin:0;height:100%;background:#0B1220;overflow:hidden}
  #wrap{position:relative;width:100%;height:100%}
  video,canvas{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
  .mirror{transform:scaleX(-1)}
</style>
</head><body>
<div id="wrap"><video id="v" playsinline autoplay muted></video><canvas id="c"></canvas></div>
<script>
(function(){
  var MP_BASE = '__MP_BASE__';
  var MODEL_URL = '__MODEL_URL__';
  var video = document.getElementById('v');
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  function post(msg){
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  window.onerror = function(m){ post({ type: 'error', message: String(m) }); };

  // Índices dos pontos do MediaPipe Pose (lado esquerdo / direito)
  var IDX = {
    left:  { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
    right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
  };
  var CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];

  // Regras de cada exercício: ângulo medido, limites para contar e para pontuar
  var RULES = {
    squat:  { a: 'hip',      b: 'knee',  c: 'ankle', start: 155, deep: 110, ideal: 95 },
    pushup: { a: 'shoulder', b: 'elbow', c: 'wrist', start: 150, deep: 100, ideal: 90 },
    curl:   { a: 'shoulder', b: 'elbow', c: 'wrist', start: 140, deep: 65,  ideal: 50 }
  };

  var mode = '__MODE__';
  var facing = 'user';
  var landmarker = null, stream = null, running = false, lastVideoTime = -1;
  var smooth = null, phase = 'start', rep = null, restMax = null;
  var reps = 0, scores = [], issues = {}, lastStatus = '', lastAnglePost = 0;

  function resetCount(){
    smooth = null; phase = 'start'; rep = null; restMax = null; reps = 0; scores = []; issues = {};
    post({ type: 'update', reps: 0, score: 0, lastScore: null, feedback: '' });
  }

  function status(msg){
    if (msg !== lastStatus){ lastStatus = msg; post({ type: 'status', message: msg }); }
  }

  function px(p){ return { x: p.x * canvas.width, y: p.y * canvas.height, v: p.visibility == null ? 1 : p.visibility }; }

  function angle(a, b, c){
    var r = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    var d = Math.abs(r * 180 / Math.PI);
    return d > 180 ? 360 - d : d;
  }
  // Ângulo do segmento p1->p2 em relação à vertical (0 = em pé)
  function fromVertical(p1, p2){
    var d = Math.abs(Math.atan2(p2.x - p1.x, p2.y - p1.y) * 180 / Math.PI);
    return d > 90 ? 180 - d : d;
  }
  function lerpScore(value, good, bad, max){
    // value em 'good' ou melhor = max; em 'bad' ou pior = 0
    if (good < bad){ if (value <= good) return max; if (value >= bad) return 0; return max * (bad - value) / (bad - good); }
    if (value >= good) return max; if (value <= bad) return 0; return max * (value - bad) / (good - bad);
  }

  // Escolhe o lado do corpo mais visível para a câmera
  function pickSide(lm){
    var r = RULES[mode], best = null, bestVis = -1;
    ['left', 'right'].forEach(function(side){
      var s = IDX[side];
      var keys = [r.a, r.b, r.c, 'shoulder', 'hip'];
      var vis = keys.reduce(function(acc, k){ return acc + (lm[s[k]].visibility || 0); }, 0) / keys.length;
      if (vis > bestVis){ bestVis = vis; best = side; }
    });
    return { side: best, vis: bestVis };
  }

  function addIssue(text){ issues[text] = (issues[text] || 0) + 1; }

  // Nota de 0 a 100 da repetição + problemas encontrados
  function scoreRep(r){
    var R = RULES[mode], s = 0;
    if (mode === 'squat'){
      s += lerpScore(r.min, R.ideal, R.deep, 50);           // profundidade
      s += lerpScore(r.maxLean, 35, 65, 50);                 // tronco ereto
      if (r.min > R.ideal + 5) addIssue('Desça mais, até a coxa ficar paralela ao chão');
      if (r.maxLean > 45) addIssue('Mantenha o tronco mais ereto');
    } else if (mode === 'pushup'){
      s += lerpScore(r.min, R.ideal, R.deep, 50);            // descer o peito
      s += lerpScore(r.minBody, 165, 140, 50);               // corpo alinhado
      if (r.min > R.ideal + 5) addIssue('Desça mais o peito');
      if (r.minBody < 155) addIssue('Mantenha o quadril alinhado com o corpo');
    } else {
      s += lerpScore(r.min, R.ideal, R.deep, 25);            // contração completa
      s += lerpScore(r.maxExt, 155, R.start - 5, 25);        // extensão completa
      s += lerpScore(r.maxDrift, 20, 45, 50);                // cotovelo parado
      if (r.min > R.ideal + 5) addIssue('Suba mais o peso (contração completa)');
      if (r.maxExt < 150) addIssue('Estenda o braço por completo na descida');
      if (r.maxDrift > 30) addIssue('Mantenha o cotovelo colado ao corpo');
    }
    return Math.round(s);
  }

  function feedbackText(){
    var avg = scores.length ? scores.reduce(function(a, b){ return a + b; }, 0) / scores.length : 0;
    var top = Object.keys(issues).sort(function(a, b){ return issues[b] - issues[a]; }).slice(0, 2);
    if (!top.length) return avg >= 85 ? 'Boa execução!' : '';
    return top.join('. ') + '.';
  }

  function process(lm){
    var R = RULES[mode];
    var pick = pickSide(lm);
    if (pick.vis < 0.5){ status('Posicione o corpo inteiro na câmera'); return null; }
    var s = IDX[pick.side];
    var A = px(lm[s[R.a]]), B = px(lm[s[R.b]]), C = px(lm[s[R.c]]);
    var raw = angle(A, B, C);
    smooth = smooth == null ? raw : smooth * 0.5 + raw * 0.5;
    var ang = smooth;

    // Medidas de forma usadas na nota
    var sh = px(lm[s.shoulder]), hip = px(lm[s.hip]), ank = px(lm[s.ankle]), elb = px(lm[s.elbow]);
    var lean = fromVertical(hip, sh);
    var body = angle(sh, hip, ank);
    var drift = fromVertical(sh, elb);

    if (phase === 'start'){
      status(ang >= R.start ? 'Pronto! Faça o movimento' : 'Volte à posição inicial');
      // maior abertura na posição inicial (usada para avaliar a extensão completa)
      restMax = restMax == null ? ang : Math.max(restMax, ang);
      if (restMax >= R.start && ang < R.start - 15){
        phase = 'moving';
        rep = { min: ang, maxLean: lean, minBody: body, maxDrift: drift, maxExt: restMax };
      }
    } else {
      rep.min = Math.min(rep.min, ang);
      rep.maxLean = Math.max(rep.maxLean, lean);
      rep.minBody = Math.min(rep.minBody, body);
      rep.maxDrift = Math.max(rep.maxDrift, drift);
      if (ang >= R.start){
        if (rep.min <= R.deep){
          var sc = scoreRep(rep);
          reps += 1; scores.push(sc);
          var avg = Math.round(scores.reduce(function(a, b){ return a + b; }, 0) / scores.length);
          post({ type: 'update', reps: reps, score: avg, lastScore: sc, feedback: feedbackText() });
        } else {
          status('Movimento curto: não contou');
        }
        phase = 'start'; rep = null; restMax = ang;
      }
    }
    return { side: pick.side, angle: Math.round(ang), joint: s[R.b] };
  }

  function draw(lm, info){
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;
    ctx.lineWidth = Math.max(3, canvas.width / 160);
    ctx.strokeStyle = 'rgba(241,245,249,0.85)';
    CONNECTIONS.forEach(function(c){
      var a = lm[c[0]], b = lm[c[1]];
      if ((a.visibility || 0) < 0.4 || (b.visibility || 0) < 0.4) return;
      ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
      ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke();
    });
    for (var i = 11; i <= 28; i++){
      var p = lm[i]; if ((p.visibility || 0) < 0.4) continue;
      var active = info && i === info.joint;
      ctx.fillStyle = active ? '#A3E635' : '#60A5FA';
      ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, active ? ctx.lineWidth * 2.5 : ctx.lineWidth * 1.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function loop(){
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime){
      lastVideoTime = video.currentTime;
      if (canvas.width !== video.videoWidth){ canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      var res = landmarker.detectForVideo(video, performance.now());
      var lm = res && res.landmarks && res.landmarks[0];
      if (lm){
        var info = process(lm);
        draw(lm, info);
        var nowMs = performance.now();
        if (info && nowMs - lastAnglePost > 200){ lastAnglePost = nowMs; post({ type: 'angle', angle: info.angle }); }
      } else {
        draw(null);
        status('Nenhuma pessoa detectada');
      }
    }
    requestAnimationFrame(loop);
  }

  function startCamera(){
    if (stream) stream.getTracks().forEach(function(t){ t.stop(); });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      post({ type: 'error', message: 'Câmera indisponível neste aparelho (getUserMedia).' });
      return Promise.resolve();
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
    }).then(function(s){
      stream = s; video.srcObject = s;
      var m = facing === 'user';
      video.classList.toggle('mirror', m); canvas.classList.toggle('mirror', m);
      return video.play();
    }).catch(function(e){
      post({ type: 'error', message: 'Não foi possível abrir a câmera: ' + (e && e.message ? e.message : e) });
    });
  }

  // Comandos enviados pelo app (React Native)
  window.cmd = function(c){
    if (c.type === 'mode' && RULES[c.mode]){ mode = c.mode; resetCount(); }
    else if (c.type === 'reset'){ resetCount(); }
    else if (c.type === 'flip'){ facing = facing === 'user' ? 'environment' : 'user'; smooth = null; startCamera(); }
  };

  async function main(){
    try {
      status('Carregando modelo de pose...');
      var vision = await import(MP_BASE + '/vision_bundle.mjs');
      var fileset = await vision.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
      var opts = function(delegate){
        return { baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate }, runningMode: 'VIDEO', numPoses: 1 };
      };
      try { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch (e) { landmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
      status('Abrindo a câmera...');
      await startCamera();
      running = true;
      post({ type: 'ready' });
      requestAnimationFrame(loop);
    } catch (e) {
      post({ type: 'error', message: 'Falha ao carregar a visão computacional: ' + (e && e.message ? e.message : e) + '. Verifique a internet.' });
    }
  }
  main();
})();
</script>
</body></html>`;
