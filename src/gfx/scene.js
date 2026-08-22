import * as THREE from 'three';

const BG = 0x04060d;

export function createStage(canvas) {
  let dprCap = 1.5;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(BG, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.015);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 0.4, 10);
  camera.rotation.set(0, 0, 0);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function onResize() {
    resize();
  }
  window.addEventListener('resize', onResize);

  function render() {
    renderer.render(scene, camera);
  }

  function setPixelRatioCap(cap) {
    dprCap = cap;
    resize();
  }

  function dispose() {
    window.removeEventListener('resize', onResize);
    scene.clear();
    renderer.dispose();
  }

  resize();

  return { renderer, scene, camera, resize, render, dispose, setPixelRatioCap };
}
