const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../apps/user-web/src/app.js'), 'utf8').replace(/\r\n/g, '\n');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.classList = { add() {} }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, handler) { this.events[type] = handler; }
  removeEventListener(type) { delete this.events[type]; }
  error() { this.events.error?.(); }
}

function setup() {
  const markers = [];
  class Marker {
    constructor(options) { Object.assign(this, options); this.iconChanges = 0; markers.push(this); }
    setPosition(position) { this.position = position; }
    setMap(map) { this.map = map; }
    setIcon(icon) { this.icon = icon; this.iconChanges++; }
  }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class LatLng { constructor(lat, lng) { this.lat = lat; this.lng = lng; } }
  const state = {
    ggumdori: [{id: 'ggumdori_default_1', name: '기본 꿈돌이', unlocked: true, imageRef: '/old.svg'},
      {id: 'science', name: '과학', unlocked: true, imageRef: '/science.png'}],
    selectedGgumdoriId: 'science', location: {lat: 36.3, lng: 127.4, measured: true},
    explorationMode: 'current', naverMapInstance: {}, naverPositionMarker: null, naverPositionMarkerKey: '',
    naverPlanningMarker: null,
  };
  const context = vm.createContext({state, document: {createElement: tag => new Element(tag)},
    window: {naver: {maps: {Marker, Point, Size: Point, LatLng}}},
    hasNaverMaps: () => true, getRecommendationLocation: () => ({lat: 35, lng: 128}),
    createElement: (tag, className, text) => Object.assign(new Element(tag), {className, textContent: text}),
  });
  vm.runInContext('const DEFAULT_GGUMDORI_IMAGE = "/assets/ggumdori/기본_128.png"; const LEGACY_DEFAULT_GGUMDORI_IMAGE = "/assets/ggumdori/default-1.svg";', context);
  for (const name of ['getSelectedGgumdori', 'getGgumdoriImageRef', 'setGgumdoriImageSource', 'createPlayerLocationMarker', 'buildNaverPositionMarkerIcon', 'syncNaverPositionMarker']) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    vm.runInContext(source.slice(start, source.indexOf('\n}\n', start) + 3), context);
  }
  return {context, state, markers};
}

test('default image prefers new Korean filename and stops after legacy fallback', () => {
  const {context, state} = setup();
  const image = new Element('img');
  context.setGgumdoriImageSource(image, context.getGgumdoriImageRef(state.ggumdori[0]));
  assert.ok(image.src.endsWith('기본_128.png'));
  image.error();
  assert.ok(image.src.endsWith('default-1.svg'));
  image.error();
  assert.equal(image.events.error, undefined);
  assert.ok(context.getGgumdoriImageRef(null).endsWith('기본_128.png'));
});

test('wearing changes refresh the character but GPS updates do not reset its animation', () => {
  const {context, state, markers} = setup();
  context.syncNaverPositionMarker();
  const marker = markers[0];
  assert.equal(marker.icon.content.children[2].src, '/science.png');
  assert.equal(marker.icon.anchor.y, 76);
  assert.equal(marker.position.lat, 36.3);
  assert.equal(marker.zIndex, 1000);
  state.location.lat = 36.4;
  context.syncNaverPositionMarker();
  assert.equal(marker.position.lat, 36.4);
  assert.equal(marker.iconChanges, 0);
  state.selectedGgumdoriId = 'ggumdori_default_1';
  context.syncNaverPositionMarker();
  assert.ok(marker.icon.content.children[2].src.endsWith('기본_128.png'));
  assert.equal(marker.iconChanges, 1);
});

test('planned location is separate from actual GPS; unmeasured position is not labeled as me', () => {
  const {context, state} = setup();
  state.explorationMode = 'planned';
  context.syncNaverPositionMarker();
  assert.equal(state.naverPositionMarker.position.lat, 36.3);
  assert.equal(state.naverPlanningMarker.position.lat, 35);
  state.location.measured = false;
  context.syncNaverPositionMarker();
  assert.equal(state.naverPositionMarker.map, null);
  assert.match(context.createPlayerLocationMarker().attrs['aria-label'], /기준 위치/);
  state.explorationMode = 'current';
  context.syncNaverPositionMarker();
  assert.equal(state.naverPlanningMarker.map, null);
  assert.equal(state.naverPositionMarker.map, state.naverMapInstance);
});

test('locked selection never becomes the player avatar', () => {
  const {context, state} = setup();
  state.ggumdori[1].unlocked = false;
  assert.equal(context.getSelectedGgumdori().id, 'ggumdori_default_1');
});
