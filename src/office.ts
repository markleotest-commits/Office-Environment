import * as THREE from 'three';
import { OBSTACLES } from './config';

// Cutaway office architecture. Shared materials are batched by World after construction.
export function buildOffice(scene: THREE.Scene) {
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const box = (
    w: number,
    h: number,
    d: number,
    c: string,
    x: number,
    y: number,
    z: number,
  ) => {
    if (!mats.has(c))
      mats.set(
        c,
        new THREE.MeshStandardMaterial({
          color: c,
          roughness: 0.85,
          flatShading: true,
        }),
      );
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.get(c));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const walnut = '#76523a',
    brass = '#c5a56b',
    ink = '#172630',
    stone = '#a8a69b';
  // Continuous building foundation, not a floating terrain disk.
  box(37, 9, 27, '#192832', 0, -4.6, 0);
  box(37.1, 0.3, 27.1, brass, 0, -0.22, 0);
  box(36, 0.15, 26, '#747b7c', 0, -0.04, 0);
  box(35.4, 0.04, 25.4, '#273b46', 0, 0.055, 0);
  // Central marble circulation spine and four carpeted departments.
  box(5.5, 0.05, 25.5, '#bbb6a5', 0, 0.09, 0);
  box(35.5, 0.05, 2.3, '#bbb6a5', 0, 0.09, -3.5);
  for (const x of [-10, 10])
    for (const z of [-8, 4])
      box(13.1, 0.03, 7.8, z < 0 ? '#354c57' : '#30424d', x, 0.1, z);
  for (const x of [-3, 3]) box(0.08, 0.03, 25, brass, x, 0.13, 0);
  // Rear facade and window grid; front/right are cut away to expose the interior.
  box(36, 0.65, 0.35, ink, 0, 0.35, -13);
  box(36, 0.32, 0.45, brass, 0, 5.8, -13);
  box(0.35, 5.8, 26, ink, -18, 2.9, 0);
  const sky = new THREE.MeshBasicMaterial({
    color: '#759bb3',
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(35.5, 5.1), sky);
  glass.position.set(0, 3.1, -13.1);
  scene.add(glass);
  for (let x = -18; x <= 18; x += 3) box(0.13, 5.8, 0.3, brass, x, 2.9, -12.9);
  box(36, 0.12, 0.3, brass, 0, 2.6, -12.85);
  // Stylized city silhouettes visible through the facade, using window-local geometry.
  for (let i = 0; i < 24; i++) {
    const x = -17.2 + i * 1.46,
      h = 0.8 + ((i * 7) % 11) * 0.2;
    box(1.1, h, 0.15, '#364c60', x, 0.7 + h / 2, -12.98);
    for (let y = 1; y < h; y += 0.5)
      box(0.35, 0.11, 0.025, '#dfbe7a', x, y + 0.5, -12.86);
  }
  // Glass department dividers with real walk-through gaps at the main corridor.
  const divider = new THREE.MeshBasicMaterial({
    color: '#82b4bd',
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const x of [-4, 4]) {
    for (const z of [-12.7, -5.3]) box(0.12, 3.2, 0.12, brass, x, 1.65, z);
    box(0.12, 0.1, 7.4, brass, x, 3.2, -9);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(7.1, 2.8), divider);
    pane.rotation.y = Math.PI / 2;
    pane.position.set(x, 1.8, -9);
    scene.add(pane);
  }
  const screen = (x: number, z: number) => {
    box(1.25, 0.8, 0.13, ink, x, 1.65, z);
    box(1.08, 0.62, 0.035, '#285e63', x, 1.67, z + 0.08);
    for (let j = 0; j < 5; j++)
      box(
        0.11,
        0.08 + ((j * 3) % 5) * 0.075,
        0.02,
        j % 3 ? '#71c9b2' : '#d89a62',
        x - 0.4 + j * 0.19,
        1.57,
        z + 0.105,
      );
    box(0.12, 0.25, 0.12, brass, x, 1.17, z);
    box(0.45, 0.05, 0.3, ink, x, 1.06, z);
    box(0.75, 0.025, 0.25, '#bab9a7', x, 1.08, z + 0.6);
  };
  // Every workstation island has a matching navigation obstacle.
  for (const desk of OBSTACLES.filter((o) => o.width > 1)) {
    box(desk.width, 0.14, desk.depth, walnut, desk.x, 1.0, desk.z);
    box(desk.width - 0.7, 0.92, desk.depth - 0.45, ink, desk.x, 0.48, desk.z);
    box(desk.width, 0.045, 0.04, brass, desk.x, 1.1, desk.z + desk.depth / 2);
    if (desk.x === 0) {
      box(3.3, 0.035, 1.4, '#354e55', 0, 1.1, desk.z);
      box(0.5, 0.08, 0.7, '#d4cbb0', -1, 1.17, desk.z);
    } else
      for (
        let x = desk.x - desk.width / 2 + 1.4;
        x < desk.x + desk.width / 2 - 0.6;
        x += 2.6
      )
        screen(x, desk.z - 0.3);
  }
  // Rolling chairs, cabinets, lamps, and a coffee counter sit within the workstation footprints.
  for (const desk of OBSTACLES.filter((o) => o.width > 1))
    for (const side of [-1, 1]) {
      box(0.7, 0.12, 0.7, '#15232b', desk.x + side * 1.2, 0.55, desk.z + 0.9);
      box(0.7, 0.8, 0.12, '#26343b', desk.x + side * 1.2, 0.95, desk.z + 1.2);
      box(0.08, 0.5, 0.08, brass, desk.x + side * 1.2, 0.25, desk.z + 0.9);
    }
  // Ceiling light rails are suspended; the ceiling is removed for the cutaway camera.
  for (const x of [-11, 11])
    for (const z of [-8, 2]) {
      box(7, 0.12, 0.32, brass, x, 5.4, z);
      box(6.8, 0.06, 0.22, '#fff0c3', x, 5.32, z);
    }
  box(0.7, 3.7, 0.7, stone, -17, 1.85, 11.8);
  box(0.7, 3.7, 0.7, stone, 17, 1.85, 11.8);
  box(34, 0.13, 0.13, brass, 0, 0.18, 12.7);
  return sky;
}
