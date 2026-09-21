import * as T from 'three';
import { createGame, drawGame, WIDTH, HEIGHT, type Game } from './game';
import { cameraAt, nodes, outroAt, smooth, typingAt, type focusPose } from './story';
import { historyLane, roundedPath } from './paths';
import { screenPosters, StoryScreens } from './screens';

type Pose = ReturnType<typeof focusPose>;
const ink = '#132b28',
  cream = '#f6ecd2';
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function write(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  visible = text.length,
  cursor = false,
) {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ')) {
    if (ctx.measureText(row + word).width > width && row) {
      rows.push(row.trim());
      row = '';
    }
    row += word + ' ';
  }
  rows.push(row.trim());
  let consumed = 0;
  rows.forEach((line, i) => {
    const remaining = visible - consumed;
    const prefix = line.slice(0, Math.max(0, remaining));
    ctx.fillText(prefix, x, y + i * height);
    if (cursor && remaining >= 0 && remaining <= line.length)
      ctx.fillRect(
        x + ctx.measureText(prefix).width + 3,
        y + i * height - height * 0.6,
        3,
        height * 0.68,
      );
    consumed += line.length + 1;
  });
  return rows.length * height;
}
function material(color: string) {
  return new T.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0.05 });
}
function box(group: T.Group, size: number[], p: number[], color: string) {
  const mesh = new T.Mesh(
    new T.BoxGeometry(...(size as [number, number, number])),
    material(color),
  );
  mesh.position.fromArray(p);
  group.add(mesh);
  return mesh;
}
function surface(
  group: T.Group,
  source: HTMLCanvasElement,
  w: number,
  h: number,
  p: number[],
  pixels = false,
) {
  const texture = new T.CanvasTexture(source);
  texture.colorSpace = T.SRGBColorSpace;
  if (pixels) {
    texture.magFilter = T.NearestFilter;
    texture.minFilter = T.NearestFilter;
    texture.generateMipmaps = false;
  } else {
    texture.anisotropy = 4;
  }
  const mesh = new T.Mesh(
    new T.PlaneGeometry(w, h),
    new T.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  );
  mesh.position.fromArray(p);
  group.add(mesh);
  return { mesh, texture };
}
type Stage = {
  group: T.Group;
  gameCanvas: HTMLCanvasElement;
  gameTexture: T.CanvasTexture;
  gameMesh: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  actionCanvas: HTMLCanvasElement;
  actionTexture: T.CanvasTexture;
  tick: number;
  panelKey: string;
  marker: T.Mesh;
};

/** The browser and movie exporter call this exact scene at explicit times. */
export class SpatialScene {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(39, 16 / 9, 0.1, 400);
  readonly stages: Stage[] = [];
  private screens = new StoryScreens();
  private pickTargets: T.Object3D[] = [];
  private edges: {
    curve: T.CurvePath<T.Vector3>;
    mesh: T.Mesh;
    glow: T.Mesh;
    dot: T.Mesh;
    start: number;
    end: number;
  }[] = [];
  private stars: T.Points;
  private width = 1920;
  private height = 1080;
  constructor(readonly element: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas: element,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor('#122725', 1);
    this.scene.fog = new T.FogExp2('#122725', 0.006);
    this.scene.add(new T.AmbientLight('#d2e4d1', 2));
    const sun = new T.DirectionalLight('#fff2d5', 3.5);
    sun.position.set(-15, 30, 20);
    this.scene.add(sun);
    const rim = new T.DirectionalLight('#a1e2cc', 2);
    rim.position.set(10, 5, -10);
    this.scene.add(rim);
    const positions = [];
    for (let i = 0; i < 520; i++) {
      positions.push(Math.sin(i * 8.312) * 150, Math.cos(i * 2.531) * 58, -15 - ((i * 13.1) % 95));
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    this.stars = new T.Points(
      geo,
      new T.PointsMaterial({
        color: '#d5dbbb',
        size: 0.13,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true,
      }),
    );
    this.scene.add(this.stars);
    // Distant low-poly islands and lit stones give travel parallax and scale.
    for (let i = 0; i < 32; i++) {
      const rock = new T.Mesh(
        new T.IcosahedronGeometry(1.4 + (i % 4) * 0.55, 0),
        material(i % 3 ? '#25463d' : '#45634e'),
      );
      rock.position.set(Math.sin(i * 6.42) * 85, -13 - (i % 7) * 3, -12 - (i % 8) * 6);
      rock.scale.y = 0.44;
      rock.rotation.set(i * 0.31, i * 0.77, i * 0.11);
      this.scene.add(rock);
    }
    nodes.forEach((node, index) => {
      const group = new T.Group();
      group.position.fromArray(node.position);
      this.scene.add(group);
      const glowCanvas = canvas(256, 256),
        glowContext = glowCanvas.getContext('2d')!;
      const gradient = glowContext.createRadialGradient(128, 128, 5, 128, 128, 128);
      gradient.addColorStop(0, node.color + '29');
      gradient.addColorStop(1, node.color + '00');
      glowContext.fillStyle = gradient;
      glowContext.fillRect(0, 0, 256, 256);
      const aura = surface(group, glowCanvas, 32, 24, [0, -1, -1.8]);
      aura.mesh.material.depthWrite = false;
      box(group, [19.1, 0.3, 5.2], [0, -3.7, 0], '#294b3f');
      box(group, [18.3, 0.22, 4.7], [0, -3.47, 0], '#8c9f77');
      box(group, [17.1, 0.6, 3.9], [0, -4.1, -0.2], '#203f37');
      for (let i = 0; i < 10; i++)
        box(
          group,
          [1.3, 0.3 + (i % 3) * 0.22, 1.5],
          [-7.3 + i * 1.62, -4.5 - (i % 3) * 0.11, -0.3],
          i % 2 ? '#234137' : '#355a44',
        );
      box(group, [18.4, 0.035, 0.05], [0, -3.44, 2.36], node.color);
      // The screen is a plane: all platformer geometry/physics stays 2D.
      box(group, [12.24, 6.99, 0.35], [-3, 0.5, 0], '#0b211e');
      const gameCanvas = canvas(WIDTH, HEIGHT);
      drawGame(gameCanvas.getContext('2d')!, createGame(node.variant));
      const game = surface(group, gameCanvas, 12, 6.75, [-3, 0.5, 0.19], true);
      game.mesh.userData.node = index;
      this.pickTargets.push(game.mesh);
      const actionCanvas = canvas(960, 1350);
      const action = surface(group, actionCanvas, 4.8, 6.75, [6.05, 0.5, 0.25]);
      action.mesh.userData.node = index;
      this.pickTargets.push(action.mesh);
      const heading = canvas(2048, 150),
        ctx = heading.getContext('2d')!;
      ctx.fillStyle = node.color;
      ctx.font = '500 23px "DM Mono"';
      ctx.fillText(node.status, 4, 30);
      ctx.fillStyle = cream;
      ctx.font = '600 62px "Fredoka"';
      ctx.fillText(node.title, 0, 100);
      ctx.fillStyle = '#adc0aa';
      ctx.font = '400 22px "DM Mono"';
      ctx.textAlign = 'right';
      ctx.fillText(index === 3 ? 'MIKA + JULES' : node.owner.toUpperCase(), 2040, 92);
      surface(group, heading, 18, 1.32, [0, 4.87, 0.16]);
      const marker = new T.Mesh(
        new T.TorusGeometry(0.32, 0.06, 8, 32),
        new T.MeshBasicMaterial({ color: node.color }),
      );
      marker.position.set(0, -4.7, 2.25);
      group.add(marker);
      const dot = new T.Mesh(
        new T.SphereGeometry(0.12, 12, 8),
        new T.MeshBasicMaterial({ color: node.color }),
      );
      dot.position.copy(marker.position);
      group.add(dot);
      // Tiny blocky plants on each stage keep the set playful and tangible.
      for (const x of [-8.75, 8.55]) {
        box(group, [0.42, 0.66, 0.42], [x, -3.07, 1.6], '#b09e75');
        box(group, [0.85, 0.42, 0.55], [x, -2.55, 1.6], '#80a174');
        box(group, [0.44, 0.42, 0.5], [x - 0.15, -2.25, 1.6], '#aabe86');
      }
      this.stages.push({
        group,
        gameCanvas,
        gameTexture: game.texture,
        gameMesh: game.mesh,
        actionCanvas,
        actionTexture: action.texture,
        tick: -1,
        panelKey: '',
        marker,
      });
    });
    const anchor = (i: number) =>
      new T.Vector3(...nodes[i].position).add(new T.Vector3(0, -4.7, 2.25));
    const a = anchor(0),
      b = anchor(1),
      c = anchor(2),
      d = anchor(3);
    this.edge(historyLane(a, c), '#94a982', 0, 17.5);
    this.edge(historyLane(a, b), '#fa9b81', 5.2, 7.7);
    this.edge(historyLane(b, c), '#fa9b81', 13, 17.5);
    this.edge(historyLane(c, d), '#9bdec3', 18.1, 21.6);
    this.resize(1920, 1080);
  }
  private edge(points: T.Vector3[], color: string, start: number, end: number) {
    const curve = roundedPath(points);
    const geo = new T.TubeGeometry(curve, 160, 0.075, 5, false);
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ color }));
    this.scene.add(mesh);
    const glow = new T.Mesh(
      new T.TubeGeometry(curve, 160, 0.18, 5, false),
      new T.MeshBasicMaterial({ color, opacity: 0.1, transparent: true, depthWrite: false }),
    );
    this.scene.add(glow);
    const dot = new T.Mesh(
      new T.SphereGeometry(0.18, 12, 8),
      new T.MeshBasicMaterial({ color: cream }),
    );
    this.scene.add(dot);
    this.edges.push({ curve, mesh, glow, dot, start, end });
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  private panel(index: number, time: number, explore: boolean) {
    const stage = this.stages[index],
      n = nodes[index],
      ctx = stage.actionCanvas.getContext('2d')!;
    const done = explore || time >= n.done;
    const typing = typingAt(index, time, explore);
    const prompt = '“' + n.prompt + '”';
    const promptLength = Math.floor(prompt.length * typing.prompt);
    const commandLength = Math.floor(n.command.length * typing.command);
    const key = `${promptLength}:${commandLength}:${done}`;
    if (stage.panelKey === key) return;
    stage.panelKey = key;
    ctx.clearRect(0, 0, 960, 1350);
    ctx.fillStyle = '#f4ebd6';
    ctx.beginPath();
    ctx.roundRect(0, 0, 960, 840, 30);
    ctx.fill();
    ctx.fillStyle = '#315445';
    ctx.font = '500 27px "DM Mono"';
    ctx.fillText(n.role, 55, 77);
    ctx.fillStyle = '#172d27';
    ctx.font = '600 54px "DM Sans"';
    ctx.fillText(n.owner, 55, 150);
    ctx.fillStyle = '#3e564b';
    ctx.font = '400 29px "DM Mono"';
    ctx.fillText('TO THEIR AI', 55, 205);
    ctx.fillStyle = '#172d27';
    ctx.font = '500 66px "DM Sans"';
    write(ctx, prompt, 55, 319, 846, 84, promptLength, typing.prompt < 1 && time >= n.start);
    ctx.fillStyle = n.color;
    ctx.fillRect(55, 770, 140, 7);
    ctx.fillStyle = '#0a1c19';
    ctx.beginPath();
    ctx.roundRect(0, 875, 960, 475, 25);
    ctx.fill();
    ctx.strokeStyle = '#537061';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#abc0aa';
    ctx.font = '400 28px "DM Mono"';
    ctx.fillText('>_  napplet soyLI', 44, 939);
    ctx.fillStyle = '#aac1aa';
    ctx.font = '400 25px "DM Mono"';
    write(ctx, n.before, 44, 1004, 866, 38);
    ctx.fillStyle = cream;
    ctx.font = '400 39px "DM Mono"';
    const command = n.command.slice(0, commandLength);
    command
      .split('\n')
      .forEach((line, i) => ctx.fillText((i ? '  ' : '$ ') + line, 44, 1110 + i * 55));
    if (!done) {
      ctx.fillStyle = n.color;
      ctx.fillRect(44, 1216, 12, 20);
    } else {
      ctx.fillStyle = n.color;
      ctx.font = '400 26px "DM Mono"';
      write(ctx, '✓ ' + n.result, 44, 1250, 865, 38);
    }
    stage.actionTexture.needsUpdate = true;
  }
  render(
    time: number,
    options: {
      pose?: Pose;
      explore?: boolean;
      active?: number;
      live?: Game;
      parallax?: { x: number; y: number };
    } = {},
  ) {
    const pose = options.pose ?? cameraAt(time);
    const target = new T.Vector3().fromArray(pose.target),
      eye = new T.Vector3().fromArray(pose.eye);
    // Portrait keeps the whole node visible. Interactive play has its own full-width 2D view.
    if (this.camera.aspect < 1.3)
      eye
        .sub(target)
        .multiplyScalar(1.45 / this.camera.aspect)
        .add(target);
    const outro = options.explore ? 0 : outroAt(time);
    if (options.parallax) {
      // Shift the eye around the authored focus, revealing depth without moving the story.
      // Settle back onto the exact camera path as the final game fills the screen.
      const distance = eye.distanceTo(target) * (1 - outro);
      const forward = target.clone().sub(eye).normalize();
      const right = forward.clone().cross(this.camera.up).normalize();
      const up = right.clone().cross(forward).normalize();
      eye.addScaledVector(right, options.parallax.x * distance * 0.035);
      eye.addScaledVector(up, options.parallax.y * distance * 0.02);
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    this.stages.forEach((stage, i) => {
      const n = nodes[i];
      stage.group.visible = !!options.explore || time >= n.reveal;
      if (!stage.group.visible) return;
      const focus = this.stages.find(
        (s) =>
          target.distanceTo(s.group.position) < 4 &&
          new T.Vector3().fromArray(pose.eye).distanceTo(s.group.position) < 26,
      );
      const opacity = (focus && focus !== stage ? 0.1 : 1) * (1 - outro);
      stage.group.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of materials) {
          mat.userData.originalTransparent ??= mat.transparent;
          mat.opacity = outro > 0 && i === 3 && object === stage.gameMesh ? 1 : opacity;
          mat.transparent = mat.userData.originalTransparent || opacity < 1;
          // Distant versions remain as context without competing with the focused prompt.
          mat.depthWrite = !mat.transparent;
        }
      });
      this.panel(i, time, !!options.explore);
      const nearby = new T.Vector3().fromArray(pose.eye).distanceTo(stage.group.position) < 30;
      const screenTime = (nearby || i === 3) && !options.explore ? time : screenPosters[i];
      const tick = Math.round(screenTime * 60);
      if (tick !== stage.tick || options.live) {
        const ctx = stage.gameCanvas.getContext('2d')!;
        if (options.live && options.active === i) drawGame(ctx, options.live);
        else this.screens.draw(ctx, i, screenTime);
        stage.gameTexture.needsUpdate = true;
        stage.tick = tick;
      }
      stage.marker.rotation.z = time * 0.4;
    });
    // The published screen leaves its stage and flies toward the stationary viewer.
    // Interpolate camera-space depth logarithmically so its apparent size grows smoothly.
    const release = this.stages[3];
    release.gameMesh.position.set(-3, 0.5, 0.19);
    release.gameMesh.quaternion.identity();
    if (outro > 0) {
      const start = release.gameMesh.position.clone().add(release.group.position);
      const projected = start.clone().project(this.camera);
      const cameraSpace = this.camera.worldToLocal(start.clone());
      const tangent = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
      const endDepth = Math.max(6.75 / 2 / tangent, 12 / 2 / (tangent * this.camera.aspect));
      const depth = Math.exp(Math.log(-cameraSpace.z) * (1 - outro) + Math.log(endDepth) * outro);
      const flight = new T.Vector3(
        projected.x * (1 - outro) * depth * tangent * this.camera.aspect,
        projected.y * (1 - outro) * depth * tangent,
        -depth,
      );
      this.camera.localToWorld(flight);
      release.gameMesh.position.copy(flight.sub(release.group.position));
      release.gameMesh.quaternion.slerp(this.camera.quaternion, outro);
    }
    this.edges.forEach((e) => {
      const progress = options.explore ? 1 : smooth((time - e.start) / (e.end - e.start));
      const count = Math.floor(progress * 160) * 5 * 6;
      e.mesh.geometry.setDrawRange(0, count);
      e.glow.geometry.setDrawRange(0, count);
      (e.mesh.material as T.MeshBasicMaterial).opacity = 1 - outro;
      (e.mesh.material as T.MeshBasicMaterial).transparent = outro > 0;
      (e.glow.material as T.MeshBasicMaterial).opacity = 0.1 * (1 - outro);
      e.dot.visible = progress > 0 && progress < 1 && outro < 1;
      e.dot.position.copy(e.curve.getPointAt(progress));
    });
    this.stars.rotation.y = time * 0.0008;
    this.renderer.render(this.scene, this.camera);
  }
  pick(clientX: number, clientY: number): number | undefined {
    const rect = this.element.getBoundingClientRect(),
      ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return ray.intersectObjects(this.pickTargets).find((hit) => hit.object.parent?.visible)?.object
      .userData.node;
  }
  stats() {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      width: this.width,
      height: this.height,
    };
  }
  dispose() {
    this.scene.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of materials) {
          if ('map' in mat && mat.map instanceof T.Texture) mat.map.dispose();
          mat.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
