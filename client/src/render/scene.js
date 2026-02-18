import * as THREE from "https://unpkg.com/three@0.162.0/build/three.module.js";

export function createScene(appEl, arenaRadius) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 28, 74);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setSize(appEl.clientWidth, appEl.clientHeight);
  renderer.shadowMap.enabled = false;
  appEl.appendChild(renderer.domElement);

  const cameraHeight = 34;
  const frustumSize = 48;
  const aspect = appEl.clientWidth / appEl.clientHeight;
  const camera = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    200
  );
  const cameraTarget = new THREE.Vector3(0, 0, 0);
  const cameraPosition = new THREE.Vector3(0, cameraHeight, 14);
  camera.position.copy(cameraPosition);
  camera.lookAt(cameraTarget);

  const ambient = new THREE.AmbientLight(0x88a0ff, 0.7);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(14, 26, 10);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x64d9ff, 0.7, 120);
  fillLight.position.set(-18, 18, -12);
  scene.add(fillLight);

  const hemi = new THREE.HemisphereLight(0x9cc8ff, 0x192438, 0.65);
  scene.add(hemi);

  const arenaGeo = new THREE.CylinderGeometry(arenaRadius, arenaRadius, 0.8, 64);
  const arenaMat = new THREE.MeshStandardMaterial({
    color: 0x24334d,
    roughness: 0.72,
    metalness: 0.18
  });
  const arena = new THREE.Mesh(arenaGeo, arenaMat);
  arena.position.y = -0.4;
  scene.add(arena);

  const arenaInner = new THREE.Mesh(
    new THREE.CylinderGeometry(arenaRadius - 1.2, arenaRadius - 1.2, 0.06, 64),
    new THREE.MeshStandardMaterial({
      color: 0x304669,
      roughness: 0.55,
      metalness: 0.22
    })
  );
  arenaInner.position.y = 0.02;
  scene.add(arenaInner);

  const edgeGeo = new THREE.TorusGeometry(arenaRadius + 0.15, 0.35, 16, 100);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x7ea7ff,
    emissive: 0x18335f,
    emissiveIntensity: 0.9
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.06;
  scene.add(edge);

  const dangerRing = new THREE.Mesh(
    new THREE.RingGeometry(arenaRadius - 1.2, arenaRadius - 0.45, 80),
    new THREE.MeshBasicMaterial({
      color: 0xff7b57,
      opacity: 0.16,
      transparent: true,
      side: THREE.DoubleSide
    })
  );
  dangerRing.rotation.x = -Math.PI / 2;
  dangerRing.position.y = 0.09;
  scene.add(dangerRing);

  const grid = new THREE.GridHelper(arenaRadius * 2, 22, 0x5e7cb5, 0x2a3953);
  grid.position.y = 0.05;
  grid.material.opacity = 0.32;
  grid.material.transparent = true;
  scene.add(grid);

  const outerLava = new THREE.Mesh(
    new THREE.CylinderGeometry(arenaRadius * 2.6, arenaRadius * 2.6, 0.2, 80),
    new THREE.MeshStandardMaterial({
      color: 0xff6b2d,
      emissive: 0x662515,
      emissiveIntensity: 0.8,
      roughness: 0.85
    })
  );
  outerLava.position.y = -0.85;
  scene.add(outerLava);

  const pulseState = { timer: 0, strength: 0 };

  function triggerPulse(strength = 0.45) {
    pulseState.timer = 0.45;
    pulseState.strength = Math.max(pulseState.strength, strength);
  }

  function updateCamera(focusX, focusY, dtSeconds) {
    const smooth = 1 - Math.exp(-8 * dtSeconds);
    cameraTarget.x += (focusX - cameraTarget.x) * smooth;
    cameraTarget.z += (focusY - cameraTarget.z) * smooth;

    if (pulseState.timer > 0) {
      pulseState.timer = Math.max(0, pulseState.timer - dtSeconds);
    }
    const shakeAmount = pulseState.timer > 0 ? pulseState.strength * (pulseState.timer / 0.45) : 0;
    const shakeX = (Math.random() - 0.5) * shakeAmount;
    const shakeZ = (Math.random() - 0.5) * shakeAmount;

    cameraPosition.x += (cameraTarget.x - cameraPosition.x) * smooth;
    cameraPosition.z += (cameraTarget.z + 14 - cameraPosition.z) * smooth;
    camera.position.set(cameraPosition.x + shakeX, cameraHeight, cameraPosition.z + shakeZ);
    camera.lookAt(cameraTarget.x, 0, cameraTarget.z);

    edge.material.emissiveIntensity = 0.6 + Math.sin(performance.now() * 0.0035) * 0.2;
  }

  function resize() {
    const width = appEl.clientWidth;
    const height = appEl.clientHeight;
    const nextAspect = width / height;
    camera.left = (-frustumSize * nextAspect) / 2;
    camera.right = (frustumSize * nextAspect) / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  window.addEventListener("resize", resize);

  return { THREE, scene, camera, renderer, updateCamera, triggerPulse };
}
