"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Three from "three";
import { createCarAnimator, type LiveState } from "@/lib/live/reducer";
import { projectTrack } from "@/lib/live/project";
import { gridPlacement, trackSampler } from "@/lib/live/track-motion";


export function HelicopterView({ state, selected, onSelect }: { state: LiveState; selected: number | null; onSelect: (number: number) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const current = useRef({ state, selected, onSelect });
  const controlsRef = useRef<{ zoom: (factor: number) => void; reset: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mini = useMemo(() => state.track ? projectTrack(state.track) : null, [state.track]);
  const followed = state.frame?.cars.get(selected ?? state.timing[0]?.number);
  const miniPosition = mini && followed ? mini.project(followed.x, followed.y) : null;
  useEffect(() => { current.current = { state, selected, onSelect }; }, [state, selected, onSelect]);

  useEffect(() => {
    const host = hostRef.current, track = state.track;
    if (!host || !track || track.outline.length < 3) return;
    let disposed = false, cleanup = () => {};
    async function start() {
      const T = await import("three");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      if (disposed || !host || !track) return;
      const renderer = new T.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1.25, 1.5));
      renderer.outputColorSpace = T.SRGBColorSpace; renderer.setClearColor("#263b46");
      renderer.domElement.setAttribute("aria-label", "Interactive 3D circuit and animated cars");
      Object.assign(renderer.domElement.style, { touchAction: "none", width: "100%", height: "100%" }); host.appendChild(renderer.domElement);
      const scene = new T.Scene(); scene.fog = new T.Fog("#263b46", 1200, 4500);
      scene.add(new T.HemisphereLight(0xffffff, 0x33463e, 2));
      const sun = new T.DirectionalLight(0xfff0dc, 2.4); sun.position.set(-100, 200, 80); scene.add(sun);
      const points = track.outline.map(p => new T.Vector3(p[0] * 0.1, 0, -p[1] * 0.1));
      const center = points.reduce((sum, p) => sum.add(p), new T.Vector3()).divideScalar(points.length);
      points.forEach(p => p.sub(center));
      const street = /singapore|monaco|baku|azerbaijan|vegas|jeddah|saudi|miami/i.test(current.current.state.session?.meeting ?? current.current.state.session?.name ?? "");
      const material = (color: string | number) => new T.MeshLambertMaterial({ color });
      const ground = new T.Mesh(new T.PlaneGeometry(16000, 16000), material(street ? "#34464b" : "#4f7350")); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.1; scene.add(ground);
      const sampler = trackSampler(track.outline);
      const textureCanvas = document.createElement("canvas"); textureCanvas.width = 128; textureCanvas.height = 128;
      const asphalt = textureCanvas.getContext("2d")!; asphalt.fillStyle = "#35404a"; asphalt.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 5000; i++) { const shade = i % 3 === 0 ? "#ffffff0b" : "#0000000c"; asphalt.fillStyle = shade; asphalt.fillRect(i * 37 % 128, i * 73 % 127, 1, 1); }
      const asphaltTexture = new T.CanvasTexture(textureCanvas); asphaltTexture.colorSpace = T.SRGBColorSpace; asphaltTexture.wrapS = asphaltTexture.wrapT = T.RepeatWrapping;
      const ribbon = (width: number, color: string, y: number) => {
        const vertices: number[] = [], uvs: number[] = [];
        const vertex = (i: number, offset: number) => {
          const tangent = points[(i + 1) % points.length].clone().sub(points[(i + points.length - 1) % points.length]).normalize(), p = points[i];
          return [p.x - tangent.z * offset, y, p.z + tangent.x * offset];
        };
        let distance = 0;
        for (let i = 0; i < points.length; i++) { const j = (i + 1) % points.length, a = vertex(i, -width), b = vertex(j, -width), c = vertex(j, width), d = vertex(i, width); const next = distance + points[i].distanceTo(points[j]); vertices.push(...a, ...b, ...c, ...a, ...c, ...d); uvs.push(0, distance / 12, 0, next / 12, 1, next / 12, 0, distance / 12, 1, next / 12, 1, distance / 12); distance = next; }
        const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3)); geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals();
        const m = material(color); if (width === 6.6) m.map = asphaltTexture; m.side = T.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = -y * 100; m.polygonOffsetUnits = -y * 100; scene.add(new T.Mesh(geometry, m));
      };
      ribbon(11, street ? "#637b7b" : "#aab3a0", 0); ribbon(7, "#e7efed", 0.02); ribbon(6.6, "#ffffff", 0.04);
      const wallMaterial = material("#9caeb3"), red = material("#e25143");
      const walls = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), wallMaterial, points.length * 2);
      const kerbs = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), red, points.length);
      const segment = new T.Object3D();
      let kerbCount = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], next = points[(i + 1) % points.length], tangent = next.clone().sub(p);
        const normal = new T.Vector3(-tangent.z, 0, tangent.x).normalize();
        for (const side of [-1, 1]) {
          segment.position.copy(p).add(next).multiplyScalar(0.5).addScaledVector(normal, (street ? 8.5 : 15) * side); segment.position.y = street ? 0.55 : 0.325; segment.rotation.y = Math.atan2(tangent.x, tangent.z); segment.scale.set(0.3, street ? 1.1 : 0.65, tangent.length() + 0.1); segment.updateMatrix(); walls.setMatrixAt(i * 2 + (side === 1 ? 1 : 0), segment.matrix);
        }
        const before = points[(i + points.length - 2) % points.length], after = points[(i + 2) % points.length];
        const incoming = p.clone().sub(before).normalize(), outgoing = after.clone().sub(p).normalize();
        if (incoming.dot(outgoing) > 0.998 || i % 2) continue;
        const side = Math.sign(incoming.x * outgoing.z - incoming.z * outgoing.x) || 1;
        segment.position.copy(p).add(next).multiplyScalar(0.5).addScaledVector(normal, 6.8 * side); segment.position.y = 0.04; segment.rotation.y = Math.atan2(tangent.x, tangent.z); segment.scale.set(0.6, 0.05, tangent.length()); segment.updateMatrix(); kerbs.setMatrixAt(kerbCount++, segment.matrix);
      }
      kerbs.count = kerbCount; walls.instanceMatrix.needsUpdate = true; kerbs.instanceMatrix.needsUpdate = true; scene.add(walls, kerbs);
      const gridPaint = new T.InstancedMesh(new T.BoxGeometry(1, 0.025, 1), new T.MeshBasicMaterial({ color: "#edf2eb" }), 66);
      for (let rank = 1; rank <= 22; rank++) {
        const slot = gridPlacement(rank, sampler.length, -1), pose = sampler.sample(1 - slot.offset, slot.lateral);
        const heading = Math.atan2(pose.tangent[0], -pose.tangent[1]);
        for (let edge = 0; edge < 3; edge++) {
          segment.position.set(pose.point[0] * 0.1 - center.x, 0.075, -pose.point[1] * 0.1 - center.z); segment.rotation.y = heading;
          const shift = new T.Vector3(edge === 2 ? 0 : edge === 0 ? -1.25 : 1.25, 0, edge === 2 ? -2.5 : 0).applyAxisAngle(new T.Vector3(0, 1, 0), heading); segment.position.add(shift);
          segment.scale.set(edge === 2 ? 2.5 : 0.08, 1, edge === 2 ? 0.08 : 5); segment.updateMatrix(); gridPaint.setMatrixAt((rank - 1) * 3 + edge, segment.matrix);
        }
      }
      scene.add(gridPaint);
      const camera = new T.PerspectiveCamera(52, 1, 0.2, 12000);
      const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping = true; orbit.dampingFactor = 0.12; orbit.minDistance = 8; orbit.maxDistance = 2500; orbit.maxPolarAngle = Math.PI * 0.48;
      const cars = new Map<number, { group: Three.Group; label: HTMLButtonElement; line: HTMLDivElement; heading: number }>();
      const tyreGeometry = new T.CylinderGeometry(0.34, 0.34, 0.35, 12); tyreGeometry.rotateZ(Math.PI / 2);
      const tyres = material("#101214"), black = material("#17202a");
      const bodyShape = new T.Shape(); bodyShape.moveTo(0.16, 2.4); bodyShape.lineTo(0.3, 0.65); bodyShape.quadraticCurveTo(0.85, 0.3, 0.78, -0.8); bodyShape.lineTo(0.42, -1.8); bodyShape.lineTo(-0.42, -1.8); bodyShape.lineTo(-0.78, -0.8); bodyShape.quadraticCurveTo(-0.85, 0.3, -0.3, 0.65); bodyShape.lineTo(-0.16, 2.4); bodyShape.closePath();
      const bodyGeometry = new T.ExtrudeGeometry(bodyShape, { depth: 0.34, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.07, bevelThickness: 0.07 }); bodyGeometry.rotateX(Math.PI / 2);
      const makeCar = (number: number, color: string, code: string) => {
        const group = new T.Group(), paint = material(color);
        const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: Three.Material) => { const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); group.add(mesh); };
        const body = new T.Mesh(bodyGeometry, paint); body.position.y = 0.67; group.add(body);
        box(1.9, 0.1, 0.45, 0, 0.23, 2.45, paint); box(1.8, 0.13, 0.55, 0, 0.78, -1.9, paint); box(0.46, 0.25, 0.85, 0, 0.75, -0.25, black);
        box(0.08, 0.1, 0.52, -0.88, 0.34, 2.45, black); box(0.08, 0.1, 0.52, 0.88, 0.34, 2.45, black);
        const halo = new T.Mesh(new T.TorusGeometry(0.32, 0.045, 6, 16, Math.PI * 1.5), black); halo.rotation.x = Math.PI / 2; halo.position.set(0, 1, 0.1); group.add(halo);
        const helmet = new T.Mesh(new T.SphereGeometry(0.22, 12, 8), material("#efe9be")); helmet.position.set(0, 1.02, 0.1); group.add(helmet);
        const wheels = new T.InstancedMesh(tyreGeometry, tyres, 4);
        let wheelIndex = 0; const wheelPose = new T.Object3D();
        for (const x of [-0.88, 0.88]) for (const z of [-1.55, 1.55]) { wheelPose.position.set(x, 0.35, z); wheelPose.updateMatrix(); wheels.setMatrixAt(wheelIndex++, wheelPose.matrix); }
        group.add(wheels);
        const label = document.createElement("button"); label.type = "button"; label.textContent = code; label.dataset.carLabel = String(number); label.title = current.current.state.drivers.get(number)?.name ?? code;
        Object.assign(label.style, { position: "absolute", left: "0", top: "0", zIndex: "20", display: "none", font: "650 12px/18px system-ui", letterSpacing: "0.01em", padding: "0 5px", border: "0", borderLeft: `3px solid ${color}`, borderRadius: "2px", color: "#f5f8fa", background: "#0d1925e8", boxShadow: "0 1px 5px #0006", cursor: "pointer", whiteSpace: "nowrap" });
        const line = document.createElement("div"); Object.assign(line.style, { position: "absolute", left: "0", top: "0", height: "1px", transformOrigin: "0 0", background: "#c7d5df66", pointerEvents: "none", zIndex: "15", display: "none" });
        label.onclick = () => current.current.onSelect(number); host.append(line, label); group.userData.number = number; scene.add(group); return { group, label, line, heading: 0 };
      };
      const animator = createCarAnimator();
      let raf = 0, lastNow = performance.now(), lastRevision = -1, lastFollow: number | null = null, ready = false;
      let averageFrameMs = 16, lastQualityChange = performance.now();
      const previousTarget = new T.Vector3(), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const orbitOffset = new T.Vector3(-30, 60, -55);
      const directionAt = (position: Three.Vector3) => { let best = 0, distance = Infinity; for (let i = 0; i < points.length; i++) { const d = points[i].distanceToSquared(position); if (d < distance) { best = i; distance = d; } } return points[(best + 2) % points.length].clone().sub(points[(best + points.length - 2) % points.length]).normalize(); };
      controlsRef.current = { reset: () => { ready = false; orbitOffset.set(-30, 60, -55); }, zoom: factor => { camera.position.sub(orbit.target).multiplyScalar(factor).add(orbit.target); orbit.update(); } };
      const raycaster = new T.Raycaster(); let down = [0, 0];
      const pointerDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
      const pointerUp = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect(); raycaster.setFromCamera(new T.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
        let hit: Three.Object3D | null = raycaster.intersectObjects([...cars.values()].map(c => c.group), true)[0]?.object ?? null;
        while (hit && hit.userData.number === undefined) hit = hit.parent;
        if (hit) current.current.onSelect(hit.userData.number);
      };
      renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp);
      const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(host); resize();
      const loop = (now: number) => {
        if (disposed) return;
        const live = current.current.state, dt = Math.min(64, now - lastNow); lastNow = now;
        averageFrameMs += (dt - averageFrameMs) * 0.04;
        if (now - lastQualityChange > 1800 && averageFrameMs > 28 && renderer.getPixelRatio() > 0.7) { renderer.setPixelRatio(Math.max(0.7, renderer.getPixelRatio() * 0.85)); resize(); lastQualityChange = now; }
        if (ready) orbitOffset.copy(camera.position).sub(orbit.target);
        const resetFrame = lastRevision !== live.seekRevision;
        if (resetFrame) ready = false;
        if (resetFrame) renderer.domElement.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 0 : 180 });
        lastRevision = live.seekRevision;
        const positions = animator(live, now, reduced), followNumber = current.current.selected ?? live.timing[0]?.number ?? positions[0]?.number;
        if (lastFollow !== followNumber) ready = false; lastFollow = followNumber;
        for (const car of cars.values()) { car.group.visible = false; car.label.style.display = "none"; car.line.style.display = "none"; }
        for (const position of positions) {
          const driver = live.drivers.get(position.number); if (!driver) continue;
          let car = cars.get(position.number); if (!car) { car = makeCar(position.number, driver.teamColor, driver.code); cars.set(position.number, car); }
          car.group.position.set(position.x * 0.1 - center.x, 0.06, -position.y * 0.1 - center.z);
          const ahead = position.trackProgress === undefined ? null : sampler.sample(position.trackProgress + 30 / sampler.length).point;
          const behind = position.trackProgress === undefined ? null : sampler.sample(position.trackProgress - 30 / sampler.length).point;
          const direction = ahead && behind ? new T.Vector3(ahead[0] - behind[0], 0, behind[1] - ahead[1]).normalize() : directionAt(car.group.position), desired = Math.atan2(direction.x, direction.z);
          car.heading = !ready || resetFrame ? desired : car.heading + Math.atan2(Math.sin(desired - car.heading), Math.cos(desired - car.heading)) * (1 - Math.exp(-dt / 75));
          car.group.rotation.y = car.heading; car.group.visible = position.status !== "retired";
        }
        const followed = cars.get(followNumber);
        if (followed && positions.length) {
          const target = followed.group.position.clone();
          if (!ready) { orbit.target.copy(target); camera.position.copy(target).add(orbitOffset); } else camera.position.add(target.clone().sub(previousTarget));
          orbit.target.copy(target); orbit.update();
          previousTarget.copy(target); ready = true;
        }
        camera.updateMatrixWorld();
        const viewportWidth = host.clientWidth, viewportHeight = host.clientHeight;
        const occupied: { x: number; y: number }[] = [];
        const ranks = new Map(live.timing.map(row => [row.number, row.pos]));
        for (const [number, car] of [...cars].sort(([a], [b]) => (a === followNumber ? -1 : ranks.get(a) ?? 99) - (b === followNumber ? -1 : ranks.get(b) ?? 99))) {
          if (!car.group.visible) continue;
          const position = car.group.position.clone().add(new T.Vector3(0, 1.4, 0)).project(camera);
          if (position.z < -1 || position.z > 1) continue;
          const anchorX = (position.x + 1) * viewportWidth / 2, anchorY = (1 - position.y) * viewportHeight / 2;
          const x = anchorX + 7;
          let y = anchorY - 22;
          if (x < 0 || x > viewportWidth - 42 || y < 0 || y > viewportHeight - 20) continue;
          for (let attempt = 0; attempt < 5 && occupied.some(p => Math.abs(p.x - x) < 43 && Math.abs(p.y - y) < 21); attempt++) y -= 21;
          if (y < 0 || x < 130 && y < 116) continue;
          occupied.push({ x, y }); car.label.style.display = "block"; car.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; car.label.style.outline = number === followNumber ? "1px solid #ffffff99" : "none";
          const dx = x - anchorX, dy = y + 18 - anchorY; car.line.style.display = "block"; car.line.style.width = `${Math.hypot(dx, dy)}px`; car.line.style.transform = `translate(${anchorX}px,${anchorY}px) rotate(${Math.atan2(dy, dx)}rad)`;
        }
        renderer.render(scene, camera); raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      cleanup = () => {
        cancelAnimationFrame(raf); observer.disconnect(); orbit.dispose(); controlsRef.current = null;
        renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp);
        scene.traverse(object => { const mesh = object as Three.Mesh; mesh.geometry?.dispose(); const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []; for (const m of materials) { (m as Three.SpriteMaterial).map?.dispose(); m.dispose(); } }); for (const car of cars.values()) { car.label.remove(); car.line.remove(); } renderer.dispose(); renderer.domElement.remove();
      };
    }
    start().catch(() => { if (!disposed) setError("3D rendering is unavailable in this browser. Switch to Overview to see car positions."); });
    return () => { disposed = true; cleanup(); };
  }, [state.track]);

  return <div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span className="text-caption text-ink-2">Helicopter view</span>
      <div className="flex gap-1" role="group" aria-label="Camera zoom"><button type="button" aria-label="Zoom in" onClick={() => controlsRef.current?.zoom(0.75)} className="min-h-10 min-w-10 rounded-control border border-rule">+</button><button type="button" aria-label="Zoom out" onClick={() => controlsRef.current?.zoom(1.3)} className="min-h-10 min-w-10 rounded-control border border-rule">−</button><button type="button" onClick={() => controlsRef.current?.reset()} className="min-h-10 rounded-control border border-rule px-2 text-caption">Reset camera</button></div>
    </div>
    <div ref={hostRef} className="relative h-[420px] overflow-hidden rounded-control bg-bg-raised lg:h-[620px]">{error ? <p role="status" className="p-5 text-ui text-ink-2">{error}</p> : mini ? <svg viewBox={mini.viewBox} aria-label="Circuit overview and followed car" className="pointer-events-none absolute left-3 top-3 z-10 h-24 w-28 rounded-control bg-[#101b26dd] p-2"><path d={mini.path} fill="none" stroke="#b9c9d1" strokeWidth={8 * mini.scale} />{miniPosition ? <circle cx={miniPosition[0]} cy={miniPosition[1]} r={18 * mini.scale} fill={state.drivers.get(followed!.number)?.teamColor ?? "white"} /> : null}</svg> : null}</div>
    <p className="mt-2 text-caption text-ink-3">Drag to orbit, scroll or pinch to zoom. Circuit outline from session data; track width and surroundings are schematic.{state.positionsSource === "estimated" ? " Car positions are estimated from timing." : ""}</p>
  </div>;
}
