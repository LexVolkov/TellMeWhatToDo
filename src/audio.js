import { SOUNDS, MUSIC } from './assets.js';
const cache = {};
export const audio = {
  sfx: localStorage.getItem('sfx_on') === '1', music: null, musicOn: false,
  play(name, vol = 0.5) {
    if (!this.sfx || !SOUNDS[name]) return;
    const base = cache[name] || (cache[name] = new Audio(encodeURI(SOUNDS[name])));
    const a = base.cloneNode(); a.volume = vol; a.play().catch(() => { });
  },
  toggleMusic() {
    if (!this.music) { this.music = new Audio(encodeURI(MUSIC)); this.music.loop = true; this.music.volume = 0.25; }
    this.musicOn = !this.musicOn;
    localStorage.setItem('music_on', this.musicOn ? '1' : '0');
    if (this.musicOn) this.music.play().catch(() => { }); else this.music.pause();
    return this.musicOn;
  },
};
