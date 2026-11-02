// ---------------------------------------------------------------- lightweight HTML label layer
// Replaces three.js CSS2DRenderer, which on every frame touched *all* labels (≈ 5 500 here): wrote their
// style, sorted them by distance and rewrote every z-index. In a planetarium all labels are at the same
// distance from the camera, so this layer
//   • skips invisible subtrees entirely (hidden catalogs, culled objects, star names),
//   • writes to the DOM only when a label's position or visibility actually changes,
//   • never sorts.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _vp = new THREE.Matrix4();

export class LabelObject extends THREE.Object3D {
  constructor(element) {
    super();
    this.isCSS2DObject = true;           // kept for code that checks this flag
    this.element = element;
    this.element.style.position = 'absolute';
    this.element.style.left = '0'; this.element.style.top = '0';
    this.element.style.display = 'none';
    this.center = new THREE.Vector2(0.5, 0.5);   // anchor: (0,0) = bottom-left … (1,1) = top-right
    this._shown = false; this._tf = ''; this._seen = 0;
    this.addEventListener('removed', () => { this.element.remove(); this._shown = false; });
  }
}

export class LabelRenderer {
  constructor() {
    this.domElement = document.createElement('div');
    this.domElement.style.overflow = 'hidden';
    this._w = 1; this._h = 1; this._frame = 0;
    this._shown = new Set();
  }

  setSize(w, h) {
    this._w = w; this._h = h;
    this.domElement.style.width = w + 'px'; this.domElement.style.height = h + 'px';
  }

  render(scene, camera) {
    const f = ++this._frame, hw = this._w / 2, hh = this._h / 2, dom = this.domElement;
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const visit = (o) => {
      if (!o.visible) return;                                   // whole hidden subtree skipped
      if (o.isCSS2DObject) {
        _v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(_vp);
        if (_v.z >= -1 && _v.z <= 1 && Math.abs(_v.x) < 1.25 && Math.abs(_v.y) < 1.25) {
          o._seen = f;
          const tf = `translate(${(-100 * o.center.x).toFixed(0)}%,${(-100 * o.center.y).toFixed(0)}%) translate(${(_v.x * hw + hw).toFixed(1)}px,${(-_v.y * hh + hh).toFixed(1)}px)`;
          if (tf !== o._tf) { o.element.style.transform = tf; o._tf = tf; }
          if (!o._shown) {
            if (o.element.parentNode !== dom) dom.appendChild(o.element);
            o.element.style.display = ''; o._shown = true; this._shown.add(o);
          }
        }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) visit(ch[i]);
    };
    visit(scene);
    // hide labels that were shown last frame but not this one
    for (const o of this._shown) {
      if (o._seen !== f) { o.element.style.display = 'none'; o._shown = false; this._shown.delete(o); }
    }
  }
}
