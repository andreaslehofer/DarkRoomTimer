import { Timer, formatTime } from './timer.js';
import { DEFAULT_STEPS } from './steps.js';
import { unlockAudio, beep, vibrate, initWakeLock } from './alerts.js';

const steps = DEFAULT_STEPS;
let current = 0;

const el = {
  steps: document.getElementById('steps'),
  label: document.getElementById('step-label'),
  display: document.getElementById('display'),
  timer: document.querySelector('.timer'),
  start: document.getElementById('btn-start'),
  reset: document.getElementById('btn-reset'),
  next: document.getElementById('btn-next'),
  wake: document.getElementById('wake-indicator'),
};

const timer = new Timer();

function renderSteps() {
  el.steps.replaceChildren(
    ...steps.map((step, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'step';
      btn.innerHTML = `${step.name}<small>${formatTime(step.duration * 1000)}</small>`;
      if (i === current) btn.setAttribute('aria-current', 'step');
      btn.addEventListener('click', () => selectStep(i));
      return btn;
    })
  );
}

function selectStep(i) {
  current = i;
  el.label.textContent = steps[i].name;
  el.timer.classList.remove('timer--done');
  timer.set(steps[i].duration);
  renderSteps();
  updateControls();
}

function updateControls() {
  el.start.textContent = timer.running ? 'Pause' : 'Start';
}

timer.addEventListener('tick', (e) => {
  el.display.textContent = formatTime(e.detail.remaining);
});
timer.addEventListener('start', updateControls);
timer.addEventListener('pause', updateControls);
timer.addEventListener('done', () => {
  el.timer.classList.add('timer--done');
  beep();
  vibrate();
  updateControls();
});

el.start.addEventListener('click', () => {
  unlockAudio();
  timer.running ? timer.pause() : timer.start();
});
el.reset.addEventListener('click', () => selectStep(current));
el.next.addEventListener('click', () => selectStep((current + 1) % steps.length));

initWakeLock((active) => {
  el.wake.hidden = !active;
});

selectStep(0);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Service Worker Registrierung fehlgeschlagen:', err);
    });
  });
}
