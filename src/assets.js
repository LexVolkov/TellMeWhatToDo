const X = 'assets/environment/0x72_DungeonTilesetII_v1.7/0x72_DungeonTilesetII_v1.7/frames/';
const P = 'assets/environment/2D Pixel Dungeon Asset Pack v2.0/2D Pixel Dungeon Asset Pack/items and trap_animation/';
const EN = 'assets/environment/Enemy_Animations_Set/enemies-';
const CH = 'assets/characters/Sprites/';
const EM = 'assets/emotes/kenney_emotes-pack/PNG/Pixel/Style 1/emote_';
const S = 'assets/sound/', J = S + 'The Essential Retro Video Game Sound Effects Collection [512 sounds] By Juhani Junkala/';

export const ITEM_ICONS = ['sword_white', 'sword_blue', 'sword_gold', 'sword_red', 'helmet', 'boots', 'gloves', 'armor', 'potion_heal', 'potion_shield', 'ring_str', 'ring_agi', 'ring_sta', 'ring_luck', 'ring_spi', 'key', 'key_white', 'key_yellow', 'key_blue', 'compass', 'slot'];
export const itemIcon = id => 'assets/items/' + id + '.png';
export const IMAGES = {
  ...Object.fromEntries(ITEM_ICONS.map(id => ['item_' + id, itemIcon(id)])),
  wall_mid: X + 'wall_mid.png', wall_top: X + 'wall_top_mid.png', wall_edge_l: X + 'wall_edge_mid_left.png', wall_edge_r: X + 'wall_edge_mid_right.png',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(i => ['floor_' + i, X + `floor_${i}.png`])),
  door_closed: X + 'doors_leaf_closed.png', door_open: X + 'doors_leaf_open.png',
  chest_full: X + 'chest_full_open_anim_f0.png', chest_full_open: X + 'chest_full_open_anim_f2.png',
  chest_empty_open: X + 'chest_empty_open_anim_f2.png', mimic: X + 'chest_mimic_open_anim_f2.png',
  ...Object.fromEntries([0, 1, 2, 3].map(i => ['spikes_' + i, X + `floor_spikes_anim_f${i}.png`])),
  ...Object.fromEntries([0, 1, 2].map(i => ['lava_' + i, `assets/tiles/lava_f${i}.png`])),
  ...Object.fromEntries([0, 1, 2, 3].flatMap(i => [['boss_idle_' + i, X + `big_demon_idle_anim_f${i}.png`], ['boss_run_' + i, X + `big_demon_run_anim_f${i}.png`]])),
  ...Object.fromEntries([0, 1, 2, 3].flatMap(i => [['chomp_idle_' + i, X + `chort_idle_anim_f${i}.png`], ['chomp_run_' + i, X + `chort_run_anim_f${i}.png`]])),
  stairs: X + 'floor_ladder.png', stairs_down: X + 'floor_stairs.png', lever_off: X + 'lever_left.png', lever_on: X + 'lever_right.png', mimic_tell: X + 'chest_mimic_open_anim_f0.png', potion: X + 'flask_big_red.png',
  ...Object.fromEntries([1, 2, 3, 4].map(i => ['key_' + i, P + `keys/keys_1_${i}.png`])),
  ...Object.fromEntries([1, 2, 3, 4].map(i => ['torch_' + i, P + `torch/side_torch_${i}.png`])),
};
export const ENEMY = {
  skeleton: { idle: EN + 'skeleton1_idle.png', walk: EN + 'skeleton1_movement.png', attack: EN + 'skeleton1_attack.png', hurt: EN + 'skeleton1_take_damage.png', death: EN + 'skeleton1_death.png' },
  skeleton2: { idle: EN + 'skeleton2_idle.png', walk: EN + 'skeleton2_movemen.png', attack: EN + 'skeleton2_attack.png', hurt: EN + 'skeleton2_take_damage.png', death: EN + 'skeleton2_death.png' },
  vampire: { idle: EN + 'vampire_idle.png', walk: EN + 'vampire_movement.png', attack: EN + 'vampire_attack.png', hurt: EN + 'vampire_take_damage.png', death: EN + 'vampire_death.png' },
};
const HERO_ANIMS = { idle: 'Idle', walk: 'Walk', attack: 'Chopping', hurt: 'Hurt', death: 'Death' };
const LAYERS = ['Base Body/Hand Back/Hand Back', 'Base Body/Body/Body', 'Accessories/Survival Cloth/Survival Cloth', 'Base Body/Head/Head', 'Accessories/Male Hair/Brown/Male Hair', 'Base Body/Hand Front/Hand Front'];
export const HERO = Object.fromEntries(Object.entries(HERO_ANIMS).map(([k, n]) => [k, LAYERS.map(l => CH + `${l}-${n}.png`)]));
export const EMOTES = Object.fromEntries(['faceHappy', 'faceAngry', 'faceSad', 'drops', 'question', 'exclamation', 'idea', 'sleep', 'cross', 'heart', 'cash', 'anger', 'dots3', 'stars'].map(n => [n, EM + n + '.png']));
export const SOUNDS = {
  step: J + 'Movement/Footsteps/sfx_movement_footsteps1a.wav',
  door: S + 'RPG Sound Pack/world/door.wav',
  unlock: S + 'RPG Sound Pack/inventory/metal-small1.wav',
  swing: S + 'RPG Sound Pack/battle/swing.wav',
  hit: J + 'General Sounds/Simple Damage Sounds/sfx_damage_hit2.wav',
  hurt: J + 'General Sounds/Negative Sounds/sfx_sounds_damage1.wav',
  pickup: J + 'General Sounds/Positive Sounds/sfx_sounds_powerup2.wav',
  coin: S + 'RPG Sound Pack/inventory/coin.wav',
  drink: S + 'RPG Sound Pack/inventory/bottle.wav',
  error: J + 'General Sounds/Negative Sounds/sfx_sounds_error1.wav',
  death: J + 'Death Screams/Human/sfx_deathscream_human1.wav',
  win: J + 'General Sounds/Positive Sounds/sfx_sounds_powerup10.wav',
  ui: S + 'RPG Sound Pack/interface/interface1.wav',
};
export const MUSIC = S + '5 Action Chiptunes By Juhani Junkala/Juhani Junkala [Retro Game Music Pack] Level 1.wav';

export function allAssetUrls() {
  return [...Object.values(IMAGES), ...Object.values(ENEMY).flatMap(o => Object.values(o)), ...Object.values(HERO).flat(), ...Object.values(EMOTES), ...Object.values(SOUNDS), MUSIC];
}
export function loadImages() {
  const urls = [...new Set([...Object.values(IMAGES), ...Object.values(ENEMY).flatMap(o => Object.values(o)), ...Object.values(HERO).flat(), ...Object.values(EMOTES)])];
  const map = {};
  return Promise.all(urls.map(u => new Promise(res => { const i = new Image(); i.onload = () => { map[u] = i; res(); }; i.onerror = () => { console.warn('missing asset', u); res(); }; i.src = encodeURI(u); }))).then(() => map);
}
