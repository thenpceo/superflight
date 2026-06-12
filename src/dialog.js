/**
 * Lex Luthor's voice: ElevenLabs one-liners played periodically and on
 * key moments, with a portrait + subtitle box that slides in while he speaks.
 * Ducks the music while a line plays.
 */
const LINES = [
  { file: '/assets/vo/lex_0.mp3', text: 'This city was mine long before you learned to fly.' },
  { file: '/assets/vo/lex_1.mp3', text: 'You cannot stop me, Kryptonian.' },
  { file: '/assets/vo/lex_2.mp3', text: 'Every stone I hurl buries your precious hope a little deeper.' },
  { file: '/assets/vo/lex_3.mp3', text: 'Pathetic. Is that the best the last son of Krypton can offer?' },
  { file: '/assets/vo/lex_4.mp3', text: 'I have waited years to watch you fall from the sky.' },
  { file: '/assets/vo/lex_5.mp3', text: 'Metropolis will remember this as the day Superman died.' },
  { file: '/assets/vo/lex_6.mp3', text: 'Fly all you like. You will still lose.' },
];
const INTRO = 0, TAUNT_DEFEAT = 5, TAUNT_HURT = 3, DESPERATE = 6;

export class LexDialog {
  constructor(music) {
    this.music = music;
    this.box = document.getElementById('dialog');
    this.textEl = document.getElementById('dialog-text');
    this._timer = 14 + Math.random() * 8; // first periodic line comes fairly soon
    this._cool = 0;
    this._spokenIntro = false;
    this._audio = null;
    this._hideT = null;
    this._recent = [];
  }

  _play(idx) {
    if (this._audio && !this._audio.ended) return false;
    const line = LINES[idx];
    this._audio = new Audio(line.file);
    this._audio.volume = 0.95;
    this._audio.play().catch(() => {});
    this.music?.setDucked(true);
    this._audio.addEventListener('ended', () => this.music?.setDucked(false), { once: true });

    this.textEl.textContent = line.text;
    this.box.classList.add('visible');
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => this.box.classList.remove('visible'), 5200);
    this._cool = 9;
    return true;
  }

  _randomLine() {
    let idx;
    do { idx = Math.floor(Math.random() * LINES.length); } while (this._recent.includes(idx));
    this._recent.push(idx);
    if (this._recent.length > 3) this._recent.shift();
    return idx;
  }

  /** event hooks */
  onGameStart() { if (!this._spokenIntro) { this._spokenIntro = true; this._play(INTRO); } }
  onPlayerDeath() { this._play(TAUNT_DEFEAT); }
  onPlayerHit() { if (this._cool <= 0 && Math.random() < 0.45) this._play(TAUNT_HURT); }
  onLexLowHp() { if (this._cool <= 0) this._play(DESPERATE); }

  update(dt, gameActive) {
    this._cool = Math.max(0, this._cool - dt);
    if (!gameActive) return;
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = 26 + Math.random() * 14;
      if (this._cool <= 0) this._play(this._randomLine());
    }
  }
}
