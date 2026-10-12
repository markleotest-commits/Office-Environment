import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { POIS } from './config';
import { buildOffice } from './office';
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
  private initialResize = true;
  private sky!: THREE.MeshBasicMaterial;
  private ambient = new THREE.HemisphereLight('#fff0d0', '#253c50', 2);
  private sun = new THREE.DirectionalLight('#fff1cc', 2);
  private rain?: THREE.Points;
  private lastAtmosphere = '';
  private inactive = new Set<string>();
  setInactive(ids: Iterable<string>) {
    this.inactive = new Set(ids);
  }
  setAtmosphere(hour: number, weather: string) {
    const key = `${Math.floor(hour * 60)}:${weather}`;
    if (key === this.lastAtmosphere) return;
    this.lastAtmosphere = key;
    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const cloudy = ['Rain', 'Snow', 'Overcast'].includes(weather);
    this.sky.color.set(
      daylight > 0.1 ? (cloudy ? '#526778' : '#8aaabe') : '#111d37',
    );
    this.ambient.intensity = 1.35 + daylight * 0.9;
    this.sun.intensity = 0.7 + daylight * (cloudy ? 0.6 : 1.6);
    this.sun.color.set(daylight > 0.3 ? '#fff0d1' : '#f3b56e');
    if (this.rain) this.rain.visible = weather === 'Rain' || weather === 'Snow';
  }
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
    this.renderer.setClearColor('#101d29');
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D trading office. Drag to orbit, pinch to zoom, two fingers to pan.',
    );
    host.prepend(this.renderer.domElement);
    this.scene.fog = new THREE.Fog('#101d29', 68, 115);
    this.scene.add(this.ambient);
    const sun = this.sun;
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
    this.controls.maxDistance = 110;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minPolarAngle = 0.15;
    this.controls.screenSpacePanning = false;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.addEventListener('change', () => {
      this.controls.target.x = THREE.MathUtils.clamp(
        this.controls.target.x,
        -16,
        16,
      );
      this.controls.target.z = THREE.MathUtils.clamp(
        this.controls.target.z,
        -16,
        16,
      );
      this.controls.target.y = 0;
    });
    this.resetCamera();
    this.buildOffice();
    this.mergeStaticGeometry();
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((object) => {
      object.matrixAutoUpdate = false;
    });
    this.scene.matrixAutoUpdate = true;
    agents.forEach((a) => this.addAgent(a));
    const drops = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) {
      drops[i * 3] = ((i * 7.31) % 35) - 17.5;
      drops[i * 3 + 1] = ((i * 0.731) % 5) + 0.6;
      drops[i * 3 + 2] = -12.7;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(drops, 3));
    this.rain = new THREE.Points(
      rainGeometry,
      new THREE.PointsMaterial({
        color: '#b9d8e8',
        size: 0.06,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.rain.visible = false;
    this.scene.add(this.rain);
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
  private buildOffice() {
    this.sky = buildOffice(this.scene);
    for (const poi of POIS) {
      const label = document.createElement('span');
      label.className = 'place-label';
      label.textContent = poi.name;
      this.host.append(label);
      this.placeLabels.push({
        element: label,
        position: new THREE.Vector3(poi.position.x, 0.4, poi.position.z),
      });
    }
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
  private addAgent(agent: AgentState) {
    const group = new THREE.Group();
    group.userData.agentId = agent.id;
    this.box(0.65, 0.72, 0.4, '#24313f', 0, 1.0, 0, group);
    this.box(0.24, 0.32, 0.035, '#efe4cf', 0, 1.3, 0.22, group);
    this.mesh(
      new THREE.IcosahedronGeometry(0.32, 1),
      '#edcba6',
      0,
      1.68,
      0,
      group,
    );
    this.mesh(
      new THREE.CylinderGeometry(0.3, 0.32, 0.16, 8),
      '#362b28',
      0,
      1.95,
      0,
      group,
    );

    this.box(0.06, 0.07, 0.03, '#394c42', -0.11, 1.72, 0.29, group);
    this.box(0.06, 0.07, 0.03, '#394c42', 0.11, 1.72, 0.29, group);
    this.box(0.1, 0.39, 0.035, agent.color, 0, 1.25, 0.29, group);
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
      this.box(0.2, 0.62, 0.25, '#24313f', 0, -0.31, 0, shoulder);
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
    if (this.initialResize) {
      this.initialResize = false;
      this.resetCamera();
    }
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
    this.camera.position.set(30, 31, 37);
    if (this.camera.aspect < 0.85)
      this.camera.position.multiplyScalar(0.85 / this.camera.aspect);
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
      mesh.visible = !this.inactive.has(a.id);
      if (!mesh.visible) {
        this.labels.get(a.id)!.hidden = true;
        continue;
      }
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
    this.selection.visible = !this.inactive.has(selected.id);
    this.route.visible = selected.path.length > 0 && this.selection.visible;
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
    if (this.rain?.visible) {
      const drops = this.rain.geometry.getAttribute('position');
      for (let i = 0; i < drops.count; i++)
        drops.setY(i, 0.6 + ((drops.getY(i) - 0.6 - seconds * 2 + 5) % 5));
      drops.needsUpdate = true;
    }
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
