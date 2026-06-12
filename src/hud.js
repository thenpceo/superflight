/** Thin DOM wrapper for all combat UI. */
export class HUD {
  constructor() {
    this.el = (id) => document.getElementById(id);
    this.playerHp = this.el('hp-fill');
    this.lexHp = this.el('lex-fill');
    this.heatFill = this.el('heat-fill');
    this.punchHint = this.el('punch-hint');
    this.dmg = this.el('dmg-vignette');
    this.bannerEl = this.el('banner');
    this.endEl = this.el('end');
    this.endTitle = this.el('end-title');
    this.endSub = this.el('end-sub');
    this.restartBtn = this.el('restart');
    this.cross = this.el('crosshair');
    this.lexDist = this.el('lex-dist');
    this._bannerT = null;
    this._hitT = null;
  }

  setHealth(p, l) {
    this.playerHp.style.width = `${Math.max(0, p) * 100}%`;
    this.playerHp.classList.toggle('low', p < 0.3);
    this.lexHp.style.width = `${Math.max(0, l) * 100}%`;
  }

  setHeat(h, overheated) {
    this.heatFill.style.width = `${h * 100}%`;
    this.heatFill.classList.toggle('over', overheated);
  }

  setPunchReady(ready) {
    this.punchHint.classList.toggle('ready', ready);
  }

  setLexDistance(d) {
    this.lexDist.textContent = `${Math.round(d)}m`;
  }

  damageFlash() {
    this.dmg.classList.remove('show');
    void this.dmg.offsetWidth; // restart animation
    this.dmg.classList.add('show');
  }

  hitmark() {
    this.cross.classList.add('hit');
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.cross.classList.remove('hit'), 90);
  }

  banner(text) {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
  }

  showEnd(won) {
    this.endTitle.textContent = won ? 'VICTORY' : 'DEFEATED';
    this.endTitle.classList.toggle('won', won);
    this.endSub.textContent = won
      ? 'Lex Luthor falls from the sky. Metropolis is safe.'
      : 'The last thing you hear is Lex laughing.';
    this.endEl.classList.add('visible');
  }

  hideEnd() { this.endEl.classList.remove('visible'); }
}
