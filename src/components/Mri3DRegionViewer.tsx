"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RotateCcw, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { BodyRegion, MriFinding } from "@/lib/types";

interface Props {
  region: BodyRegion;
  regionTitle: string;
  findings: MriFinding[];
  selectedFindingId: string | null;
  onSelectFinding: (id: string) => void;
  filmPreviewUrl: string | null;
  filmFileName: string | null;
  onUploadFilm: (file: File) => void;
  compact?: boolean;
}

interface ProjectedPin {
  id: string;
  index: number;
  label: string;
  x: number;
  y: number;
  visible: boolean;
  color: string;
}

const SUPPORTED_3D_REGIONS = new Set<BodyRegion>(["brain", "spine_lumbar", "knee"]);

function buildDetailedAnatomy(
  region: BodyRegion,
  findings: MriFinding[]
): {
  group: THREE.Group;
  clickables: THREE.Object3D[];
} {
  const group = new THREE.Group();
  const clickables: THREE.Object3D[] = [];

  const cortexMat = new THREE.MeshPhysicalMaterial({
    color: 0xd9eded,
    roughness: 0.34,
    metalness: 0.03,
    transmission: 0.24,
    transparent: true,
    opacity: 0.88,
    clearcoat: 0.3,
    clearcoatRoughness: 0.25,
  });

  const deepMat = new THREE.MeshStandardMaterial({
    color: 0x0e4f4f,
    roughness: 0.4,
    metalness: 0.08,
    transparent: true,
    opacity: 0.65,
  });

  const boneMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf1f1,
    roughness: 0.42,
    metalness: 0.02,
    clearcoat: 0.18,
  });

  const discMat = new THREE.MeshPhysicalMaterial({
    color: 0x3f9b98,
    roughness: 0.26,
    transparent: true,
    opacity: 0.88,
  });

  const highlightMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    emissive: 0x92400e,
    emissiveIntensity: 0.28,
    roughness: 0.28,
  });

  const nerveMat = new THREE.MeshStandardMaterial({
    color: 0x0f766e,
    roughness: 0.35,
  });

  const findIdByKeyword = (rx: RegExp, fallbackIdx = 0) =>
    findings.find((f) => rx.test(f.title + " " + f.pin.anatomicalLabel))?.id ||
    findings[fallbackIdx]?.id ||
    findings[0]?.id ||
    "";

  if (region === "brain") {
    const cortexFindingId = findIdByKeyword(/hemisphere|infarct|pathology|frontal/i, 0);
    const aicaFindingId = findIdByKeyword(/aica|chavda|loop|arterial/i, 1);
    const deepFindingId = findIdByKeyword(/hippocamp|thalami|basal/i, 2);
    const stemFindingId = findIdByKeyword(/cerebell|brainstem|medulla|pons/i, 3);

    // High-resolution sculpted Left & Right Cerebral Hemispheres (Frontal, Temporal, Occipital shaping)
    for (const side of [-1, 1] as const) {
      const geo = new THREE.SphereGeometry(0.68, 56, 44);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let vx = pos.getX(i);
        let vy = pos.getY(i);
        let vz = pos.getZ(i);

        // Flatten medial longitudinal fissure wall
        if (side * vx < 0) vx *= 0.22;
        // Elongate anterior-posterior axis
        vz *= 1.32;
        // Temporal lobe bulge lower-lateral
        if (vy < -0.05 && Math.abs(vz) < 0.45) {
          vx *= 1.08;
        }
        // Subtle sulci/gyri organic surface undulation
        const sulci =
          1 +
          0.038 * Math.sin(vx * 14 + side) * Math.cos(vy * 13) * Math.sin(vz * 11) +
          0.018 * Math.cos((vx + vz) * 20);
        pos.setXYZ(i, vx * sulci, vy * 0.9 * sulci, vz * sulci);
      }
      geo.computeVertexNormals();
      const hemi = new THREE.Mesh(geo, cortexMat);
      hemi.position.set(side * 0.27, 0.24, 0.02);
      hemi.userData.findingId = cortexFindingId;
      group.add(hemi);
      clickables.push(hemi);
    }

    // Internal Deep Structures (Thalami + Hippocampal C-curves visible through translucent cortex)
    for (const side of [-1, 1] as const) {
      const thal = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), deepMat);
      thal.scale.set(0.85, 0.72, 1.35);
      thal.position.set(side * 0.14, 0.1, 0.02);
      thal.userData.findingId = deepFindingId;
      group.add(thal);
      clickables.push(thal);
    }

    // Striated Cerebellum (bilateral posterior fossa lobes)
    for (const side of [-1, 1] as const) {
      const cGeo = new THREE.SphereGeometry(0.32, 32, 24);
      const pos = cGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const folia = 1 + 0.03 * Math.sin(vy * 38);
        pos.setXYZ(i, vx * folia, vy * 0.72 * folia, vz * 0.88 * folia);
      }
      cGeo.computeVertexNormals();
      const cereb = new THREE.Mesh(cGeo, cortexMat);
      cereb.position.set(side * 0.26, -0.34, -0.34);
      cereb.userData.findingId = stemFindingId;
      group.add(cereb);
      clickables.push(cereb);
    }

    // Brainstem (Pons belly + Medulla)
    const pons = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 18), deepMat);
    pons.scale.set(1.05, 0.95, 0.95);
    pons.position.set(0, -0.32, -0.06);
    pons.userData.findingId = stemFindingId;
    group.add(pons);
    clickables.push(pons);

    const medulla = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.42, 20), deepMat);
    medulla.position.set(0, -0.58, -0.1);
    medulla.rotation.x = 0.18;
    medulla.userData.findingId = stemFindingId;
    group.add(medulla);
    clickables.push(medulla);

    // Right Vestibulocochlear Nerve (CN VIII) strand + Right AICA Chavda Type II Arterial Loop
    const nerveCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.12, -0.34, -0.08),
      new THREE.Vector3(0.38, -0.33, -0.14),
      new THREE.Vector3(0.64, -0.32, -0.18),
    ]);
    const nerveTube = new THREE.Mesh(
      new THREE.TubeGeometry(nerveCurve, 20, 0.018, 10, false),
      nerveMat
    );
    nerveTube.userData.findingId = aicaFindingId;
    group.add(nerveTube);
    clickables.push(nerveTube);

    const aicaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.05, -0.44, 0.04),
      new THREE.Vector3(0.28, -0.38, -0.06),
      new THREE.Vector3(0.56, -0.31, -0.16),
      new THREE.Vector3(0.45, -0.22, -0.26),
      new THREE.Vector3(0.22, -0.28, -0.2),
    ]);
    const aicaTube = new THREE.Mesh(
      new THREE.TubeGeometry(aicaCurve, 36, 0.028, 12, false),
      highlightMat
    );
    aicaTube.userData.findingId = aicaFindingId;
    group.add(aicaTube);
    clickables.push(aicaTube);

    return { group, clickables };
  }

  if (region === "knee") {
    const meniscusId = findIdByKeyword(/menisc/i, 0);
    const aclId = findIdByKeyword(/acl|cruciate|ligament/i, 1);

    // Femur shaft + condyles
    const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.84, 32), boneMat);
    femur.position.set(0, 0.7, 0);
    group.add(femur);

    for (const side of [-1, 1]) {
      const condyle = new THREE.Mesh(new THREE.SphereGeometry(0.26, 28, 22), boneMat);
      condyle.scale.set(0.95, 0.9, 1.18);
      condyle.position.set(side * 0.21, 0.28, -0.02);
      group.add(condyle);
    }

    // Translucent Patella (Kneecap) in front
    const patella = new THREE.Mesh(new THREE.SphereGeometry(0.18, 22, 18), cortexMat);
    patella.scale.set(1.05, 1.15, 0.45);
    patella.position.set(0, 0.22, 0.36);
    group.add(patella);

    // Medial Meniscus (highlighted, clickable)
    const medialMeniscus = new THREE.Mesh(
      new THREE.TorusGeometry(0.21, 0.048, 16, 32, Math.PI * 1.45),
      highlightMat
    );
    medialMeniscus.rotation.x = Math.PI / 2;
    medialMeniscus.rotation.z = -Math.PI * 0.2;
    medialMeniscus.position.set(0.22, 0.02, -0.02);
    medialMeniscus.userData.findingId = meniscusId;
    group.add(medialMeniscus);
    clickables.push(medialMeniscus);

    // Lateral Meniscus
    const lateralMeniscus = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.046, 16, 32, Math.PI * 1.45),
      discMat
    );
    lateralMeniscus.rotation.x = Math.PI / 2;
    lateralMeniscus.rotation.z = Math.PI * 0.75;
    lateralMeniscus.position.set(-0.22, 0.02, -0.02);
    group.add(lateralMeniscus);

    // ACL & PCL (clickable)
    const acl = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.44, 16), nerveMat);
    acl.position.set(0, 0.04, 0.02);
    acl.rotation.z = 0.35;
    acl.rotation.x = 0.25;
    acl.userData.findingId = aclId;
    group.add(acl);
    clickables.push(acl);

    const pcl = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.44, 16), deepMat);
    pcl.position.set(0, 0.04, -0.05);
    pcl.rotation.z = -0.35;
    pcl.rotation.x = -0.2;
    pcl.userData.findingId = aclId;
    group.add(pcl);
    clickables.push(pcl);

    // Tibia & Fibula head
    const tibiaTop = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.31, 0.24, 32), boneMat);
    tibiaTop.scale.set(1.06, 1, 0.84);
    tibiaTop.position.set(0, -0.22, 0);
    group.add(tibiaTop);

    const tibiaShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.65, 28), boneMat);
    tibiaShaft.position.set(0, -0.62, 0);
    group.add(tibiaShaft);

    const fibula = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.62, 16), boneMat);
    fibula.position.set(-0.34, -0.52, -0.1);
    group.add(fibula);

    return { group, clickables };
  }

  // Lumbar Spine (L1–L5) with central spinal cord canal & clickable L4–L5 disc
  const discFindingId = findIdByKeyword(/l4-l5|desiccation|bulge|disc/i, 0);
  const canalFindingId = findIdByKeyword(/canal|nerve|alignment/i, 1);

  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.065, 1.9, 20), deepMat);
  cord.position.set(0, 0.02, -0.14);
  cord.userData.findingId = canalFindingId;
  group.add(cord);
  clickables.push(cord);

  const yPositions = [0.76, 0.38, 0.0, -0.38, -0.76];
  yPositions.forEach((y, i) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.33, 0.23, 32), boneMat);
    body.scale.set(1.08, 1, 0.88);
    body.position.set(0, y, 0.14);
    body.userData.findingId = canalFindingId;
    group.add(body);
    clickables.push(body);

    const spinous = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.42), boneMat);
    spinous.position.set(0, y - 0.03, -0.28);
    spinous.rotation.x = 0.24;
    group.add(spinous);

    for (const side of [-1, 1]) {
      const transverse = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.36, 14), boneMat);
      transverse.rotation.z = Math.PI / 2;
      transverse.position.set(side * 0.32, y, -0.08);
      group.add(transverse);
    }

    if (i < yPositions.length - 1) {
      const isL4L5 = i === 3;
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(isL4L5 ? 0.35 : 0.32, isL4L5 ? 0.35 : 0.32, 0.11, 32),
        isL4L5 ? highlightMat : discMat
      );
      disc.scale.set(1.08, 1, isL4L5 ? 0.96 : 0.86);
      disc.position.set(0, y - 0.19, isL4L5 ? 0.1 : 0.14);
      disc.userData.findingId = isL4L5 ? discFindingId : canalFindingId;
      group.add(disc);
      clickables.push(disc);
    }
  });

  return { group, clickables };
}

export function Mri3DRegionViewer({
  region,
  regionTitle,
  findings,
  selectedFindingId,
  onSelectFinding,
  filmPreviewUrl,
  filmFileName,
  onUploadFilm,
  compact = false,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const [viewMode, setViewMode] = useState<"3d" | "film">("3d");
  const [filmZoom, setFilmZoom] = useState<number>(1);
  const [projectedPins, setProjectedPins] = useState<ProjectedPin[]>([]);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);

  const stateRef = useRef({
    yaw: -0.58,
    pitch: 0.2,
    autoSpin: true,
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    yaw0: -0.58,
    pitch0: 0.2,
    camera: null as THREE.PerspectiveCamera | null,
    clickables: [] as THREE.Object3D[],
    width: 360,
    height: 270,
  });

  const onSelectRef = useRef(onSelectFinding);
  onSelectRef.current = onSelectFinding;

  // Gently turn 3D camera toward selected finding
  useEffect(() => {
    if (!selectedFindingId) return;
    const f = findings.find((item) => item.id === selectedFindingId);
    if (!f) return;
    stateRef.current.autoSpin = false;
    stateRef.current.yaw = Math.atan2(-f.pin.x, f.pin.z || 0.25) * 0.72;
  }, [selectedFindingId, findings]);

  const has3DModel = SUPPORTED_3D_REGIONS.has(region);

  // Resize renderer smoothly when sheet toggles compact <-> resting without recreating WebGL context
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = stateRef.current.camera;
    const container = mountRef.current;
    if (!renderer || !camera || !container) return;
    const width = container.clientWidth || 360;
    const height = compact ? 185 : 275;
    stateRef.current.width = width;
    stateRef.current.height = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }, [compact]);

  useEffect(() => {
    if (!has3DModel) return;
    const container = mountRef.current;
    if (!container) return;

    let disposed = false;

    // Pre-check WebGL availability before invoking THREE.WebGLRenderer so Three.js never logs a console.error
    const probeCanvas = document.createElement("canvas");
    const gl =
      probeCanvas.getContext("webgl2") ||
      probeCanvas.getContext("webgl") ||
      probeCanvas.getContext("experimental-webgl");
    if (!gl) {
      setWebglUnavailable(true);
      return;
    }
    setWebglUnavailable(false);

    const width = container.clientWidth || 360;
    const height = compact ? 185 : 275;
    stateRef.current.width = width;
    stateRef.current.height = height;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    camera.position.set(0, 0.08, 3.1);
    stateRef.current.camera = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: probeCanvas,
        antialias: true,
        alpha: true,
        powerPreference: "default",
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      if (!disposed) setWebglUnavailable(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost, false);

    // Studio medical lighting
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7cb0ae, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x0e4f4f, 0.75);
    rim.position.set(-4, -2, -3);
    scene.add(rim);

    const rootGroup = new THREE.Group();
    const { group: fallbackAnatomy, clickables } = buildDetailedAnatomy(region, findings);
    rootGroup.add(fallbackAnatomy);

    // Automatically load a real anatomical .glb digital twin from /public/models/{region}.glb if present
    const glbFile =
      region === "brain"
        ? "/models/brain.glb"
        : region === "knee"
          ? "/models/knee.glb"
          : null;
    if (glbFile) {
      const loader = new GLTFLoader();
      loader.load(
        glbFile,
        (gltf) => {
          if (disposed) return;
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const scale = 1.65 / maxDim;
          model.scale.setScalar(scale);
          model.position.sub(center.multiplyScalar(scale));
          rootGroup.remove(fallbackAnatomy);
          rootGroup.add(model);
        },
        undefined,
        () => {
          // Keep procedural model if .glb fails to load
        }
      );
    }

    // Clickable 3D Marker Spheres for every finding
    const pinMeshes: Array<{ id: string; mesh: THREE.Mesh; label: string; color: string }> = [];
    findings.forEach((f) => {
      const colHex =
        f.category === "prompt_attention"
          ? "#DC2626"
          : f.category === "discuss_with_doctor"
            ? "#D97706"
            : "#0E4F4F";
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.068, 20, 20),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(colHex),
          emissive: new THREE.Color(colHex),
          emissiveIntensity: 0.35,
        })
      );
      sphere.position.set(f.pin.x * 1.15, f.pin.y * 1.15, f.pin.z * 1.15);
      sphere.userData.findingId = f.id;
      rootGroup.add(sphere);
      clickables.push(sphere);
      pinMeshes.push({
        id: f.id,
        mesh: sphere,
        label: f.pin.anatomicalLabel,
        color: colHex,
      });
    });

    stateRef.current.clickables = clickables;
    scene.add(rootGroup);

    let rafId = 0;
    let frameCount = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const st = stateRef.current;

      if (st.autoSpin && !st.dragging) {
        st.yaw += 0.0045;
      }
      rootGroup.rotation.y += (st.yaw - rootGroup.rotation.y) * 0.12;
      rootGroup.rotation.x += (st.pitch - rootGroup.rotation.x) * 0.12;

      renderer.render(scene, camera);

      frameCount++;
      if (frameCount % 2 === 0) {
        rootGroup.updateMatrixWorld();
        const w = stateRef.current.width;
        const h = stateRef.current.height;
        const nextPins: ProjectedPin[] = pinMeshes.map((pm, idx) => {
          const v = new THREE.Vector3();
          pm.mesh.getWorldPosition(v);
          v.project(camera);
          return {
            id: pm.id,
            index: idx + 1,
            label: pm.label,
            x: (v.x * 0.5 + 0.5) * w,
            y: (-v.y * 0.5 + 0.5) * h,
            visible: v.z < 1,
            color: pm.color,
          };
        });
        setProjectedPins(nextPins);
      }
    };

    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [region, findings, has3DModel]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current;
    st.autoSpin = false;
    st.dragging = true;
    st.moved = false;
    st.startX = e.clientX;
    st.startY = e.clientY;
    st.yaw0 = st.yaw;
    st.pitch0 = st.pitch;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current;
    if (!st.dragging) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (Math.hypot(dx, dy) > 4) st.moved = true;
    st.yaw = st.yaw0 + dx * 0.012;
    st.pitch = Math.max(-0.75, Math.min(0.75, st.pitch0 + dy * 0.01));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = stateRef.current;
    const wasClick = !st.moved;
    st.dragging = false;

    // True Three.js Raycaster click selection on 3D anatomical meshes & pins!
    if (wasClick && st.camera && mountRef.current) {
      const rect = mountRef.current.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), st.camera);
      const hits = raycaster.intersectObjects(st.clickables, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData?.findingId;
        if (hitId) onSelectRef.current(hitId);
      }
    }
  };

  const activePin =
    projectedPins.find((p) => p.id === selectedFindingId) || projectedPins[0] || null;

  return (
    <div className="relative flex flex-col">
      {/* Top Floating Bar: 3D Model | View Film Toggle + Reset */}
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <div className="inline-flex rounded-full bg-white/90 p-0.5 border border-[#DCEAEA] text-[11px]">
          <button
            type="button"
            onClick={() => setViewMode("3d")}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              viewMode === "3d" ? "bg-[#0E4F4F] text-white" : "text-[#52525B]"
            }`}
          >
            3D Model
          </button>
          <button
            type="button"
            onClick={() => setViewMode("film")}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              viewMode === "film" ? "bg-[#0E4F4F] text-white" : "text-[#52525B]"
            }`}
          >
            View Film
          </button>
        </div>

        {viewMode === "3d" ? (
          <button
            type="button"
            onClick={() => {
              stateRef.current.yaw = -0.58;
              stateRef.current.pitch = 0.2;
              stateRef.current.autoSpin = true;
            }}
            className="inline-flex items-center gap-1 rounded-full bg-white/90 border border-[#DCEAEA] px-2.5 py-1 text-[11px] font-medium text-[#52525B] hover:text-[#0E4F4F]"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFilmZoom((z) => Math.max(1, z - 0.25))}
              aria-label="Zoom out film"
              className="rounded-full bg-white border border-[#DCEAEA] p-1 text-[#52525B]"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setFilmZoom((z) => Math.min(2.5, z + 0.25))}
              aria-label="Zoom in film"
              className="rounded-full bg-white border border-[#DCEAEA] p-1 text-[#52525B]"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* MODE 1: CLICKABLE THREE.JS 3D VIEWPORT (KEPT MOUNTED SO VIEW-FILM TOGGLE NEVER RECREATES WEBGL) */}
      <div className={viewMode === "3d" ? "block" : "hidden"}>
        {!has3DModel || webglUnavailable ? (
          <div
            style={{ height: compact ? 185 : 275 }}
            className="mx-4 my-1 flex flex-col items-center justify-center rounded-2xl border border-[#DCEAEA] bg-white/80 px-6 text-center space-y-2.5"
          >
            <p className="text-xs font-semibold text-[#18181B]">{regionTitle}</p>
            <p className="text-[11px] leading-relaxed text-[#52525B]">
              {webglUnavailable
                ? "Interactive 3D view is temporarily unavailable in this browser session. You can read every finding below or switch to View Film."
                : "No verified 3D reference model is available for this scan region yet. You can still read every finding below or view your attached MRI film directly."}
            </p>
            <button
              type="button"
              onClick={() => setViewMode("film")}
              className="rounded-full bg-[#0E4F4F] px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-[#115E59]"
            >
              View Film
            </button>
          </div>
        ) : (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ height: compact ? 185 : 275 }}
          className="relative w-full cursor-grab touch-none select-none active:cursor-grabbing"
          aria-label={`Interactive 3D anatomical model of ${regionTitle}`}
        >
          <div ref={mountRef} className="h-full w-full" />

          {/* Active Pointer Line Overlay */}
          {activePin && activePin.visible && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              {(() => {
                const labelX = activePin.x > 180 ? 18 : 210;
                const labelY = activePin.y > (compact ? 92 : 135) ? 20 : compact ? 145 : 230;
                const anchorX = activePin.x > 180 ? labelX + 120 : labelX;
                return (
                  <line
                    x1={anchorX}
                    y1={labelY + 12}
                    x2={activePin.x}
                    y2={activePin.y}
                    stroke={activePin.color}
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                );
              })()}
            </svg>
          )}

          {/* Clickable Numbered Badges for Every Finding Point */}
          {projectedPins.map((pin) => {
            if (!pin.visible) return null;
            const isSelected = pin.id === activePin?.id;
            return (
              <button
                key={pin.id}
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  stateRef.current.autoSpin = false;
                  onSelectFinding(pin.id);
                }}
                aria-label={`Focus finding ${pin.index}: ${pin.label}`}
                style={{
                  left: pin.x,
                  top: pin.y,
                  backgroundColor: isSelected ? pin.color : "#FFFFFF",
                  borderColor: pin.color,
                  color: isSelected ? "#FFFFFF" : pin.color,
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow-md transition-transform hover:scale-110 ${
                  isSelected ? "z-20 scale-110 ring-4 ring-white/70" : "z-10 opacity-90"
                }`}
              >
                {pin.index}
              </button>
            );
          })}

          {/* Active Pin Label */}
          {activePin && activePin.visible && (
            <div
              className="pointer-events-none absolute z-20 rounded-full border bg-white/95 px-3 py-1 text-[11px] font-semibold text-[#18181B] shadow-sm"
              style={{
                left: activePin.x > 180 ? 14 : undefined,
                right: activePin.x <= 180 ? 14 : undefined,
                top: activePin.y > (compact ? 92 : 135) ? 12 : undefined,
                bottom: activePin.y <= (compact ? 92 : 135) ? 14 : undefined,
                borderColor: activePin.color,
              }}
            >
              {activePin.label}
            </div>
          )}

          <p className="pointer-events-none absolute bottom-2 left-4 text-[10px] text-[#5F7878]">
            Drag to rotate · Tap any numbered point to focus
          </p>
        </div>
        )}
      </div>

      {/* MODE 2: DIRECT MRI FILM VIEWER (PDF or Image) */}
      {viewMode === "film" && (
        <div
          style={{ height: compact ? 185 : 275 }}
          className="mx-4 my-1 flex flex-col items-center justify-center overflow-auto rounded-2xl border border-[#DCEAEA] bg-[#18181B] text-white"
        >
          {filmPreviewUrl ? (
            filmFileName?.toLowerCase().endsWith(".pdf") ? (
              <iframe
                src={filmPreviewUrl}
                title="Uploaded MRI Film PDF"
                className="h-full w-full rounded-2xl"
              />
            ) : (
              <img
                src={filmPreviewUrl}
                alt="Uploaded MRI Film"
                style={{ transform: `scale(${filmZoom})` }}
                className="max-h-full max-w-full object-contain transition-transform"
              />
            )
          ) : (
            <div className="p-5 text-center space-y-2.5">
              <p className="text-xs text-white/80">
                No MRI film attached yet. Upload your scan film PDF or image to view it directly.
              </p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#0E4F4F]">
                <Upload className="h-3.5 w-3.5" />
                <span>Upload MRI Film</span>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFilm(f);
                  }}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
