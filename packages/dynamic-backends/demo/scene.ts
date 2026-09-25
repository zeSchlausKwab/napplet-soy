import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Cell, Chunk } from './world-client';
export const materials = [
  { name: 'Stone', color: '#7a91ab' },
  { name: 'Dirt', color: '#b77e51' },
  { name: 'Grass', color: '#7ebe4a' },
  { name: 'Wood', color: '#d18b42' },
  { name: 'Glass', color: '#b6f2ed' },
  { name: 'Sand', color: '#f9d98b' },
  { name: 'Water', color: '#329ac4' },
];
export function createScene(
  element: HTMLElement,
  select: (cell: Cell | null) => void,
  activate: () => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor('#c7eef0');
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  element.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c7eef0', 42, 80);
  const camera = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 120);
  camera.position.set(31, 27, 33);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(7.5, 1.5, 7.5);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minZoom = 0.6;
  controls.maxZoom = 2.4;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.update();
  scene.add(new THREE.HemisphereLight('#f7ffff', '#6c7472', 2.6));
  const sun = new THREE.DirectionalLight('#fff2dc', 3);
  sun.position.set(-10, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(16.2, 0.45, 16.2),
    new THREE.MeshLambertMaterial({ color: '#2c6873' }),
  );
  platform.position.set(7.5, -0.75, 7.5);
  platform.receiveShadow = true;
  scene.add(platform);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: '#b1dfe2' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.1;
  ground.receiveShadow = true;
  scene.add(ground);
  const group = new THREE.Group();
  scene.add(group);
  const geometry = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  const paints = materials.map((m) => new THREE.MeshLambertMaterial({ color: m.color }));
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)),
    new THREE.LineBasicMaterial({ color: '#ef583d' }),
  );
  scene.add(outline);
  outline.visible = false;
  const pointer = new THREE.Vector2(),
    ray = new THREE.Raycaster();
  let mode: 'build' | 'remove' = 'build',
    selected: Cell | null = null;
  let start: { x: number; y: number } | null = null,
    alive = true;
  const valid = (p: Cell) => Object.values(p).every((n) => n >= 0 && n < 16);
  function aim(event: PointerEvent) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(group.children)[0];
    selected = null;
    if (hit && hit.instanceId !== undefined) {
      const base = hit.object.userData.cells[hit.instanceId] as Cell;
      const normal = mode === 'build' ? hit.face!.normal : new THREE.Vector3();
      selected = {
        x: base.x + Math.round(normal.x),
        y: base.y + Math.round(normal.y),
        z: base.z + Math.round(normal.z),
      };
    } else if (mode === 'build') {
      const p = ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5),
        new THREE.Vector3(),
      );
      if (p) selected = { x: Math.round(p.x), y: 0, z: Math.round(p.z) };
    }
    if (selected && !valid(selected)) selected = null;
    outline.visible = !!selected;
    if (selected) outline.position.set(selected.x, selected.y, selected.z);
    select(selected);
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!e.buttons) aim(e);
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      start = null;
      return;
    }
    start = null;
    aim(e);
    if (e.pointerType !== 'touch' && !matchMedia('(pointer:coarse)').matches && e.button === 0)
      activate();
  });
  renderer.domElement.addEventListener('pointercancel', () => {
    start = null;
  });
  function render(chunks: Chunk[]) {
    for (const mesh of [...group.children]) {
      group.remove(mesh);
      (mesh as THREE.InstancedMesh).dispose();
    }
    const cells: Cell[][] = Array.from({ length: 7 }, () => []);
    for (const chunk of chunks)
      chunk.blocks.forEach((block, offset) => {
        if (!block) return;
        cells[block - 1].push({
          x: chunk.position.x * 8 + (offset % 8),
          y: chunk.position.y * 8 + Math.floor(offset / 64),
          z: chunk.position.z * 8 + (Math.floor(offset / 8) % 8),
        });
      });
    const matrix = new THREE.Matrix4();
    cells.forEach((list, i) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geometry, paints[i], list.length);
      list.forEach((p, index) => mesh.setMatrixAt(index, matrix.makeTranslation(p.x, p.y, p.z)));
      mesh.userData.cells = list;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
  }
  const observer = new ResizeObserver(() => {
    const w = element.clientWidth,
      h = element.clientHeight,
      aspect = w / h;
    // Keep the complete island visible on a narrow phone, with room for tools.
    const size = aspect < 1 ? Math.max(16, 11 / aspect) : 12;
    camera.left = -size * aspect;
    camera.right = size * aspect;
    camera.top = size;
    camera.bottom = -size;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  observer.observe(element);
  function draw() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(draw);
  }
  draw();
  return {
    render,
    mode(value: 'build' | 'remove') {
      mode = value;
      outline.visible = false;
      selected = null;
      select(null);
    },
    close() {
      alive = false;
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      paints.forEach((m) => m.dispose());
      renderer.dispose();
    },
  };
}
