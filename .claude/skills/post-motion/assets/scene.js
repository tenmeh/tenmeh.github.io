// Helpers that both scenes share. A scene is a function of time: it defines
// window.renderAt(ms), and record.mjs calls it once for each frame.

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// A value that goes from a to b between t0 and t1, with easing.
const tween = (ms, t0, t1, a, b) => lerp(a, b, ease(clamp((ms - t0) / (t1 - t0))));

// The value of a list of [time, value] keys at a time: eased between keys.
function track(ms, keys) {
  if (ms <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (ms <= keys[i][0]) return tween(ms, keys[i - 1][0], keys[i][0], keys[i - 1][1], keys[i][1]);
  }
  return keys[keys.length - 1][1];
}

// 1 between a and b, with a short ramp at each end.
const pulse = (ms, a, b, ramp = 150) => clamp(Math.min((ms - a) / ramp, (b - ms) / ramp));

// The state of a list of steps, [time, value], at a time: the last step
// that has started.
function stepAt(ms, steps) {
  let value = steps[0][1];
  for (const [t, v] of steps) if (ms >= t) value = v;
  return value;
}

// The caption pill: the list is [from, to, text].
function setCaption(ms, list) {
  const el = document.getElementById("caption");
  const hit = list.find(([a, b]) => ms >= a && ms < b);
  if (!hit) {
    el.style.opacity = 0;
    return;
  }
  if (el.textContent !== hit[2]) el.textContent = hit[2];
  el.style.opacity = pulse(ms, hit[0], hit[1], 220);
}

// The pointer. path is [time, x, y] keys, and clicks is a list of times.
// The pointer shows from the first key to the last.
function setCursor(ms, path, clicks) {
  const cur = document.getElementById("cursor");
  const rip = document.getElementById("ripple");
  const t0 = path[0][0];
  const t1 = path[path.length - 1][0];
  const x = track(ms, path.map(([t, px]) => [t, px]));
  const y = track(ms, path.map(([t, , py]) => [t, py]));
  const down = clicks.some((c) => ms >= c && ms < c + 140);
  cur.style.opacity = pulse(ms, t0, t1, 200);
  cur.style.transform = `translate(${x}px, ${y}px) scale(${down ? 0.86 : 1})`;
  const c = clicks.find((k) => ms >= k && ms < k + 420);
  if (c === undefined) {
    rip.style.opacity = 0;
  } else {
    const p = (ms - c) / 420;
    rip.style.opacity = 0.7 * (1 - p);
    rip.style.transform = `translate(${x}px, ${y}px) scale(${0.4 + 0.9 * p})`;
  }
}

// The white sheet: white at the first frame and at the end, clear between.
function setVeil(ms, duration, inMs = 350, outMs = 450) {
  const v = ms < inMs ? 1 - ms / inMs : clamp((ms - (duration - outMs)) / outMs);
  document.getElementById("veil").style.opacity = v;
}

// Set the time of every running animation, and hold it there.
function freezeAnimations(ms) {
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = ms;
  }
}

document.getElementById("cursor").innerHTML =
  '<svg viewBox="0 0 16 22" width="16" height="22"><path d="M1.5 1.2v16.3l4.1-3.9 2.7 6.2 2.9-1.3-2.7-6.1h5.6z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
