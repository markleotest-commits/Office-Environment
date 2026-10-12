import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { POIS, WORLD_RADIUS } from './config';
import type { AgentState, Vec2 } from './types';
import { AgentMotion } from './motion';
const material = (color: string | number) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });
export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private meshes = new Map<string, THREE.Group>();
  private limbs = new Map<
    string,
    { legs: THREE.Group[]; arms: THREE.Group[] }
  >();
  private motions = new Map<string, AgentMotion>();
  private labels = new Map<string, HTMLElement>();
  private placeLabels: { element: HTMLElement; position: THREE.Vector3 }[] = [];
  private projection = new THREE.Vector3();
  private width = 0;
  private height = 0;
  private zoomDistance: number | null = null;
  private routePath: Vec2[] | null = null;
  private routeLength = -1;
  private pickTargets: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private selection: THREE.Mesh;
  private route: THREE.Line;
  private selected = 'nova';
  private resizeObserver: ResizeObserver;
  private low = true;
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  onSelect: (id: string) => void = () => {};
  onGround: (point: Vec2) => void = () => {};
  constructor(
    private host: HTMLElement,
    agents: AgentState[],
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor('#e1e9df');
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D island. Drag to orbit, pinch to zoom, two fingers to pan.',
    );
    host.prepend(this.renderer.domElement);
    this.scene.fog = new THREE.Fog('#e1e9df', 68, 115);
    this.scene.add(new THREE.HemisphereLight('#fff7df', '#5b786c', 1.8));
    const sun = new THREE.DirectionalLight('#fff6df', 2.1);
    sun.position.set(-20, 40, 15);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
      near: 1,
      far: 100,
    });
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.002;
    this.scene.add(sun);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.2;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('start', () => {
      this.zoomDistance = null;
    });
    this.controls.minDistance = 10;
    this.controls.maxDistance = 65;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minPolarAngle = 0.15;
    this.controls.screenSpacePanning = false;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.addEventListener('change', () => {
      this.controls.target.x = THREE.MathUtils.clamp(
        this.controls.target.x,
        -22,
        22,
      );
      this.controls.target.z = THREE.MathUtils.clamp(
        this.controls.target.z,
        -22,
        22,
      );
      this.controls.target.y = 0;
    });
    this.resetCamera();
    this.buildIsland();
    this.mergeStaticGeometry();
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((object) => {
      object.matrixAutoUpdate = false;
    });
    this.scene.matrixAutoUpdate = true;
    agents.forEach((a) => this.addAgent(a));
    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.66, 0.81, 32),
      new THREE.MeshBasicMaterial({ color: '#fff6dd', side: THREE.DoubleSide }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.position.y = 0.07;
    this.scene.add(this.selection);
    this.route = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: '#fff5d8',
        dashSize: 0.35,
        gapSize: 0.25,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.scene.add(this.route);
    this.setupPicking();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }
  private mat(color: string) {
    if (!this.materials.has(color)) this.materials.set(color, material(color));
    return this.materials.get(color)!;
  }
  private mesh(
    geometry: THREE.BufferGeometry,
    color: string,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.scene,
  ) {
    const mesh = new THREE.Mesh(geometry, this.mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private box(
    w: number,
    h: number,
    d: number,
    color: string,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = this.scene,
  ) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z, parent);
  }
  private buildIsland() {
    // Everything is local procedural geometry; no texture or model downloads.
    this.mesh(
      new THREE.CylinderGeometry(23.4, 22.2, 1.8, 48),
      '#acb5a3',
      0,
      -1,
      0,
    );
    this.mesh(
      new THREE.CylinderGeometry(23.7, 23.4, 0.24, 48),
      '#d2d2ad',
      0,
      -0.13,
      0,
    );
    this.mesh(
      new THREE.CylinderGeometry(23.2, 23.5, 0.12, 48),
      '#a6bc87',
      0,
      0.01,
      0,
    );
    const sea = this.mesh(
      new THREE.PlaneGeometry(250, 250),
      '#b8ceca',
      0,
      -2.0,
      0,
    );
    sea.rotation.x = -Math.PI / 2;
    sea.receiveShadow = false;
    // Soft ground contact shadows work in economy mode without shadow maps.
    const circle = new THREE.CircleGeometry(1, 24);
    const soft = new THREE.MeshBasicMaterial({
      color: '#5c795a',
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const shadow = (x: number, z: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(circle, soft);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x + 0.4, 0.085, z + 0.3);
      m.scale.set(sx, sz, 1);
      this.scene.add(m);
    };
    const path = (x: number, z: number, w: number, d: number, angle = 0) => {
      const m = this.box(w, 0.04, d, '#d7d3b3', x, 0.1, z);
      m.rotation.y = angle;
      m.castShadow = false;
    };
    path(0, -3, 3.2, 16);
    path(-5, -4.8, 12, 2.5);
    path(5, -3.8, 12, 2.5);
    path(-5, 4.2, 13, 2.1, 0.48);
    path(5, 5.2, 13, 2.1, -0.63);
    this.mesh(
      new THREE.CylinderGeometry(4.1, 4.1, 0.1, 32),
      '#ded9bd',
      0,
      0.14,
      1,
    );
    this.mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 0.1, 24),
      '#c3ccb0',
      0,
      0.2,
      1,
    );
    // Meeting circle: three benches around a small communal table.
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const group = new THREE.Group();
      group.position.set(Math.sin(a) * 3, 0, 1 + Math.cos(a) * 3);
      group.rotation.y = a;
      this.box(1.8, 0.2, 0.55, '#9d785a', 0, 0.65, 0, group);
      this.box(1.8, 0.45, 0.14, '#b5906c', 0, 1, 0.3, group);
      [-0.65, 0.65].forEach((x) =>
        this.box(0.12, 0.5, 0.4, '#5e7160', x, 0.3, 0, group),
      );
      this.scene.add(group);
    }
    this.mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.14, 12),
      '#e8dbb8',
      0,
      0.9,
      1,
    );
    this.mesh(
      new THREE.CylinderGeometry(0.15, 0.2, 0.8, 8),
      '#8a7960',
      0,
      0.5,
      1,
    );
    this.building(-10, -9, 7, 4.6, '#eadcc2', '#517467', false);
    this.building(10, -8, 6, 4.4, '#e3e4d7', '#727b7e', true);
    // Lake and boardwalk.
    const lake = this.mesh(
      new THREE.CylinderGeometry(1, 1, 0.035, 16),
      '#73aaa6',
      -12,
      0.09,
      12,
    );
    lake.scale.set(4, 1, 3);
    const rim = this.mesh(
      new THREE.CylinderGeometry(1, 1, 0.03, 16),
      '#c4caa3',
      -12,
      0.065,
      12,
    );
    rim.scale.set(4.4, 1, 3.4);
    this.box(5, 0.12, 1.6, '#bd956e', -10, 0.22, 8.2);
    for (let i = 0; i < 11; i++)
      this.box(0.04, 0.02, 1.6, '#8f775d', -12.3 + i * 0.45, 0.29, 8.2);
    this.box(0.12, 1, 0.12, '#8f775d', -12.4, 0.7, 8.7);
    this.box(0.12, 1, 0.12, '#8f775d', -7.6, 0.7, 8.7);
    this.box(5, 0.12, 0.12, '#8f775d', -10, 1.1, 8.7);
    // Garden boxes and greenhouse.
    for (let row = 0; row < 3; row++) {
      this.box(3.5, 0.35, 0.85, '#a78866', 9, 0.22, 11 + row * 1.6);
      this.box(3.25, 0.04, 0.65, '#715a44', 9, 0.42, 11 + row * 1.6);
      for (let col = 0; col < 6; col++)
        this.mesh(
          new THREE.IcosahedronGeometry(0.26, 0),
          row === 1 ? '#c4a366' : '#648e57',
          7.65 + col * 0.53,
          0.64,
          11 + row * 1.6,
        );
    }
    this.box(2.7, 1.8, 4.5, '#c8dbbf', 13, 1, 11);
    const greenhouseRoof = this.mesh(
      new THREE.CylinderGeometry(1, 1, 4.5, 3),
      '#81a59b',
      13,
      2.5,
      11,
    );
    greenhouseRoof.rotation.x = Math.PI / 2;
    greenhouseRoof.rotation.z = Math.PI / 2;
    greenhouseRoof.scale.set(1.6, 1, 0.8);
    for (let i = -1; i <= 1; i++)
      this.box(0.08, 1.8, 4.6, '#e5dec7', 13 + i * 1.25, 1, 11);
    // Trees are instanced: 126 pieces in three draw calls.
    const positions: { x: number; z: number; s: number }[] = [];
    let seed = 17;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 42; i++) {
      const a = i * 2.39996;
      const radius = 17.4 + rand() * 4.3;
      const x = Math.sin(a) * radius,
        z = Math.cos(a) * radius;
      positions.push({ x, z, s: 0.7 + rand() * 0.5 });
      shadow(x, z, 1.5, 1.15);
    }
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.25, 1.6, 5),
      this.mat('#89785a'),
      positions.length,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.3, 2.7, 5),
      this.mat('#648763'),
      positions.length,
    );
    const upper = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.95, 2.2, 5),
      this.mat('#7c9a6a'),
      positions.length,
    );
    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
      for (const [mesh, y] of [
        [trunks, 0.8],
        [crown, 2.25],
        [upper, 3.35],
      ] as const) {
        dummy.position.set(p.x, y * p.s, p.z);
        dummy.scale.setScalar(p.s);
        dummy.rotation.y = i;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    });
    [trunks, crown, upper].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    });
    // A few faceted boulders and meadow tufts.
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2,
        r = 15 + rand() * 6;
      const x = Math.sin(a) * r,
        z = Math.cos(a) * r;
      const rock = this.mesh(
        new THREE.IcosahedronGeometry(0.3 + rand() * 0.5, 0),
        '#a0aa94',
        x,
        0.2,
        z,
      );
      rock.scale.set(1, 0.7, 0.85);
    }
    for (const poi of POIS) {
      const label = document.createElement('span');
      label.className = 'place-label';
      label.textContent = poi.name;
      label.dataset.x = String(poi.position.x);
      label.dataset.z = String(poi.position.z);
      this.host.append(label);
      this.placeLabels.push({
        element: label,
        position: new THREE.Vector3(poi.position.x, 0.4, poi.position.z - 0.8),
      });
    }
    shadow(-10, -9, 5, 3);
    shadow(10, -8, 4.5, 3);
    shadow(13, 11, 2, 3);
  }
  private mergeStaticGeometry() {
    // Vertex colours let differently coloured scenery share draw calls, including nested benches.
    const painted = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
    });
    const buckets = new Map<
      string,
      { material: THREE.Material; meshes: THREE.Mesh[]; painted: boolean }
    >();
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object instanceof THREE.InstancedMesh ||
        Array.isArray(object.material)
      )
        return;
      const useColors =
        object.material instanceof THREE.MeshStandardMaterial &&
        !object.material.transparent;
      const key = `${useColors ? 'painted' : object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
      const bucket = buckets.get(key) ?? {
        material: useColors ? painted : object.material,
        meshes: [] as THREE.Mesh[],
        painted: useColors,
      };
      bucket.meshes.push(object);
      buckets.set(key, bucket);
    });
    const originals = new Set<THREE.BufferGeometry>();
    for (const {
      material: mat,
      meshes,
      painted: useColors,
    } of buckets.values()) {
      const geometries = meshes.map((mesh) => {
        const geometry = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        geometry.deleteAttribute('uv');
        if (useColors) {
          const color = (mesh.material as THREE.MeshStandardMaterial).color;
          const colors = new Float32Array(
            geometry.getAttribute('position').count * 3,
          );
          for (let i = 0; i < colors.length; i += 3) {
            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
          }
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
        return geometry.applyMatrix4(mesh.matrixWorld);
      });
      const merged = mergeGeometries(geometries, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = meshes.some((m) => m.castShadow);
        mesh.receiveShadow = meshes[0].receiveShadow;
        this.scene.add(mesh);
        meshes.forEach((m) => {
          originals.add(m.geometry);
          m.removeFromParent();
        });
      }
      geometries.forEach((g) => g.dispose());
    }
    // Do not dispose geometry still referenced by an unmerged mesh.
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) originals.delete(object.geometry);
    });
    originals.forEach((g) => g.dispose());
  }
  private building(
    x: number,
    z: number,
    w: number,
    d: number,
    wall: string,
    roof: string,
    flat: boolean,
  ) {
    this.box(w + 0.3, 0.25, d + 0.3, '#b9b8a0', x, 0.2, z);
    this.box(w, 2.8, d, wall, x, 1.7, z);
    if (flat) {
      this.box(w + 0.5, 0.35, d + 0.5, roof, x, 3.25, z);
      for (let i = 0; i < 3; i++) {
        const panel = this.box(
          1.3,
          0.12,
          2.5,
          '#456a75',
          x - 1.8 + i * 1.7,
          3.6,
          z,
        );
        panel.rotation.x = -0.18;
        this.box(1.2, 0.3, 0.7, '#9da9a2', x - 1.8 + i * 1.7, 3.45, z - 1.2);
      }
    } else {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 - 0.3, 0);
      shape.lineTo(0, 1.6);
      shape.lineTo(w / 2 + 0.3, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: d + 0.6,
        bevelEnabled: false,
      });
      this.mesh(geo, roof, x, 3.1, z - d / 2 - 0.3);
      this.box(0.6, 1.3, 0.6, '#8f9d8d', x - 2, 4.1, z);
    }
    this.box(1, 1.9, 0.1, '#6f897e', x, 1.25, z + d / 2 + 0.06);
    this.box(0.12, 0.12, 0.12, '#e9cf8d', x + 0.3, 1.3, z + d / 2 + 0.15);
    for (const side of [-1, 1]) {
      this.box(
        1.45,
        1.1,
        0.12,
        '#fcf5de',
        x + side * 2.1,
        1.9,
        z + d / 2 + 0.08,
      );
      this.box(
        1.2,
        0.85,
        0.14,
        '#86b1b3',
        x + side * 2.1,
        1.9,
        z + d / 2 + 0.1,
      );
      this.box(
        0.06,
        0.9,
        0.18,
        '#ded9c6',
        x + side * 2.1,
        1.9,
        z + d / 2 + 0.14,
      );
      this.box(1.7, 0.28, 0.4, '#a38767', x + side * 2.1, 0.7, z + d / 2 + 0.3);
      for (let i = 0; i < 3; i++)
        this.mesh(
          new THREE.IcosahedronGeometry(0.3, 0),
          '#71966a',
          x + side * 2.1 + (i - 1) * 0.45,
          0.95,
          z + d / 2 + 0.3,
        );
    }
    this.box(1.8, 0.2, 0.7, '#cfccb5', x, 0.2, z + d / 2 + 0.5);
  }
  private addAgent(agent: AgentState) {
    const group = new THREE.Group();
    group.userData.agentId = agent.id;
    this.box(0.65, 0.72, 0.4, agent.color, 0, 1.0, 0, group);
    this.mesh(
      new THREE.IcosahedronGeometry(0.32, 1),
      '#edcba6',
      0,
      1.68,
      0,
      group,
    );
    this.mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.14, 8),
      agent.color,
      0,
      1.95,
      0,
      group,
    );
    this.box(0.32, 0.06, 0.3, agent.color, 0, 1.88, 0.22, group);
    this.box(0.06, 0.07, 0.03, '#394c42', -0.11, 1.72, 0.29, group);
    this.box(0.06, 0.07, 0.03, '#394c42', 0.11, 1.72, 0.29, group);
    this.box(0.42, 0.48, 0.18, '#6d7565', 0, 1.05, -0.27, group);
    const legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.18, 0.66, 0);
      this.box(0.22, 0.52, 0.24, '#526157', 0, -0.26, 0, hip);
      this.box(0.24, 0.13, 0.35, '#3c4d43', 0, -0.52, 0.07, hip);
      group.add(hip);
      return hip;
    });
    const arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.45, 1.33, 0);
      this.box(0.2, 0.62, 0.25, agent.color, 0, -0.31, 0, shoulder);
      group.add(shoulder);
      return shoulder;
    });
    // Invisible hit area makes small characters easy to tap on a phone.
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 2.8, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = 1.2;
    hit.userData.agentId = agent.id;
    group.add(hit);
    this.pickTargets.push(hit);
    this.scene.add(group);
    this.meshes.set(agent.id, group);
    this.limbs.set(agent.id, { legs, arms });
    this.motions.set(agent.id, new AgentMotion(agent));
    const label = document.createElement('button');
    label.className = 'agent-label';
    label.textContent = agent.name;
    label.style.setProperty('--agent-color', agent.color);
    label.setAttribute('aria-label', `Select ${agent.name}`);
    label.addEventListener('click', () => this.onSelect(agent.id));
    this.labels.set(agent.id, label);
    this.host.append(label);
  }
  private setupPicking() {
    const canvas = this.renderer.domElement;
    let start: { x: number; y: number; time: number } | null = null;
    let pointers = 0;
    let dragged = false;
    canvas.addEventListener('pointerdown', (e) => {
      pointers++;
      if (pointers > 1) dragged = true;
      if (pointers === 1) {
        start = { x: e.clientX, y: e.clientY, time: performance.now() };
        dragged = false;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8)
        dragged = true;
    });
    const release = (e: PointerEvent) => {
      pointers = Math.max(0, pointers - 1);
      if (
        !start ||
        dragged ||
        pointers ||
        performance.now() - start.time > 500 ||
        e.type === 'pointercancel'
      ) {
        if (!pointers) start = null;
        return;
      }
      start = null;
      const rect = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = this.raycaster.intersectObjects(this.pickTargets)[0];
      if (hit) this.onSelect(hit.object.userData.agentId);
      else {
        const point = new THREE.Vector3();
        if (
          this.raycaster.ray.intersectPlane(
            new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
            point,
          )
        )
          this.onGround({ x: point.x, z: point.z });
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  private resize() {
    const w = (this.width = this.host.clientWidth),
      h = (this.height = this.host.clientHeight);
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.low ? 1 : 1.5),
    );
    this.renderer.setSize(w, h);
  }
  setQuality(low: boolean) {
    this.low = low;
    this.renderer.shadowMap.enabled = !low;
    this.resize();
  }
  select(id: string) {
    this.selected = id;
  }
  focus(id: string, agents: AgentState[]) {
    const a = agents.find((a) => a.id === id);
    if (!a) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(a.position.x, 0, a.position.z);
    this.camera.position.copy(this.controls.target).add(offset);
  }
  resetCamera() {
    this.zoomDistance = null;
    // Consume residual gesture damping before restoring a predictable view.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(33, 35, 43);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  zoom(factor: number) {
    this.zoomDistance = THREE.MathUtils.clamp(
      (this.zoomDistance ??
        this.camera.position.distanceTo(this.controls.target)) * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
  }
  capture(agents: AgentState[]) {
    for (const a of agents) this.motions.get(a.id)!.capture(a);
  }
  get visible() {
    return this.width > 0 && this.height > 0;
  }
  render(
    agents: AgentState[],
    elapsed: number,
    alpha: number,
    seconds: number,
    paused: boolean,
  ) {
    this.controls.dampingFactor = 1 - Math.exp(-14 * seconds);
    if (this.zoomDistance !== null) {
      const offset = this.projection
        .copy(this.camera.position)
        .sub(this.controls.target);
      const distance = THREE.MathUtils.lerp(
        offset.length(),
        this.zoomDistance,
        1 - Math.exp(-16 * seconds),
      );
      offset.setLength(distance);
      this.camera.position.copy(this.controls.target).add(offset);
      if (Math.abs(distance - this.zoomDistance) < 0.01)
        this.zoomDistance = null;
    }
    this.controls.update();
    this.camera.updateMatrixWorld();
    for (const a of agents) {
      const mesh = this.meshes.get(a.id)!;
      const motion = this.motions
        .get(a.id)!
        .sample(a, alpha, paused ? 0 : seconds);
      const bob = Math.abs(Math.sin(motion.phase)) * 0.035 * motion.gait;
      const breath =
        Math.sin(elapsed * 2 + a.name.charCodeAt(0)) *
        0.008 *
        (1 - motion.gait);
      mesh.position.set(motion.x, bob + breath, motion.z);
      mesh.rotation.y = motion.heading;
      const swing = Math.sin(motion.phase) * motion.gait;
      const limbs = this.limbs.get(a.id)!;
      limbs.legs.forEach((leg, i) => {
        leg.rotation.x = (i ? -1 : 1) * swing * 0.5;
      });
      limbs.arms.forEach((arm, i) => {
        arm.rotation.x = (i ? 1 : -1) * swing * 0.35;
      });
      const label = this.labels.get(a.id)!;
      label.classList.toggle('selected', a.id === this.selected);
      label.classList.toggle('speaking', a.state === 'talking');
      this.project(label, motion.x, 2.7, motion.z);
    }
    const selected = agents.find((a) => a.id === this.selected)!;
    const pose = this.motions.get(selected.id)!;
    this.selection.position.x = pose.x;
    this.selection.position.z = pose.z;
    if (
      this.routePath !== selected.path ||
      this.routeLength !== selected.path.length
    ) {
      const routePoints = [
        new THREE.Vector3(pose.x, 0.2, pose.z),
        ...selected.path.map((p) => new THREE.Vector3(p.x, 0.2, p.z)),
      ];
      this.route.geometry.dispose();
      this.route.geometry = new THREE.BufferGeometry().setFromPoints(
        routePoints,
      );
      (
        this.route.geometry.getAttribute('position') as THREE.BufferAttribute
      ).setUsage(THREE.DynamicDrawUsage);
      this.route.computeLineDistances();
      (
        this.route.geometry.getAttribute(
          'lineDistance',
        ) as THREE.BufferAttribute
      ).setUsage(THREE.DynamicDrawUsage);
      this.routePath = selected.path;
      this.routeLength = selected.path.length;
      // Only the first vertex moves; bounds must not lag behind it.
      this.route.frustumCulled = false;
    } else {
      const positions = this.route.geometry.getAttribute('position');
      if (positions) {
        positions.setXYZ(0, pose.x, 0.2, pose.z);
        positions.needsUpdate = true;
      }
    }
    this.route.visible = selected.path.length > 0;
    if (this.route.visible) {
      const positions = this.route.geometry.getAttribute('position');
      const distances = this.route.geometry.getAttribute('lineDistance');
      distances.setX(0, 0);
      for (let i = 1; i < positions.count; i++) {
        distances.setX(
          i,
          distances.getX(i - 1) +
            Math.hypot(
              positions.getX(i) - positions.getX(i - 1),
              positions.getZ(i) - positions.getZ(i - 1),
            ),
        );
      }
      distances.needsUpdate = true;
    }
    for (const { element, position } of this.placeLabels)
      this.project(element, position.x, position.y, position.z);
    this.renderer.render(this.scene, this.camera);
  }
  private project(label: HTMLElement, x: number, y: number, z: number) {
    const p = this.projection.set(x, y, z).project(this.camera);
    const visible =
      p.z > -1 && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
    if (label.hidden === visible) label.hidden = !visible;
    if (visible)
      label.style.transform = `translate3d(${((p.x * 0.5 + 0.5) * this.width).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * this.height).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
  get stats() {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((m) => materials.add(m));
      }
    });
    geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => materials.add(m));
    materials.forEach((m) => m.dispose());
  }
}
