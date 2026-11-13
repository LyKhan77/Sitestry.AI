/**
 * Sitestry.AI — 3D WebGL Digital Twin Engine (Three.js + three-bvh-csg + GLTFExporter) v3.0
 * Procedurally extrudes 2D topological CAD data into a real-time 3D Digital Twin:
 * - Solid Concrete Walls, Wiremesh Server Cages, & Glass Partitions
 * - Real CSG Boolean Cutouts (three-bvh-csg) for Single Doors, Double Doors, & Elevated Windows (with Sill & Lintel)
 * - 3D Door Frames, Semi-Open Swinging Door Leaves, & Mullioned Glass Windows
 * - 60x60cm Anti-Static Raised Floor Plenums + Pedestal Grid
 * - Steel H-Beam Structural Columns
 * - 3D Stepped Staircases with Safety Handrails
 * - Stage 5 Telco CME / MEP Assets (42U Racks, UPS, Battery Banks, Rectifiers, Panels, PAC, 3D Cable Trays)
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { SUBTRACTION, Brush, Evaluator } from "three-bvh-csg";
import { SceneSync } from "./sceneSync.js";
import { buildRoomFaces } from "./roomFaces.js";
import { isParametricStair, resolveStairGeometry } from "./stairGeometry.js";
import { buildFitting, buildTrayProfile, fittingCutM, FITTING_KINDS } from "./trayProfiles.js";
import { getEquipmentPreset } from "./equipmentCatalog.js";
import { trayColorForService, trayPoints } from "./trayNetwork.js";
import { PIPE_DEFAULT_COLOR, pipePoints } from "./pipeNetwork.js";
import { cableColorFor, resolveCableRoute } from "./cableRouter.js";
import { deriveFittings } from "./trayFittings.js";

export class Viewer3DEngine {
  constructor(containerId, labelsOverlayId, store) {
    this.container = document.getElementById(containerId);
    this.labelsOverlay = document.getElementById(labelsOverlayId);
    this.store = store;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16241f); // Deep architectural House Green-Slate backdrop
    this.scene.fog = new THREE.FogExp2(0x16241f, 0.0065);

    const w = this.container.clientWidth || 700;
    const h = this.container.clientHeight || 600;

    this.camera = new THREE.PerspectiveCamera(44, w / h, 0.2, 500);
    this.camera.position.set(0, 26, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;

    this.csgEvaluator = new Evaluator();
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = "SitestryDigitalTwinRoot";
    this.scene.add(this.rootGroup);

    this.selectableMeshes = [];
    this.labelAnchors = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.sceneSync = new SceneSync({
      rebuild: () => this._rebuildScene(),
      schedule: (fn) => setTimeout(fn, 0),
      cancel: (handle) => clearTimeout(handle),
    });
    this.builtRevision = -1;

    this.initLightingAndEnvironment();
    this.initSharedMaterials();
    this.bindEvents();
    this.animate();
  }

  initLightingAndEnvironment() {
    const hemi = new THREE.HemisphereLight(0xf7f5f0, 0x1e3932, 1.05);
    hemi.position.set(0, 50, 0);
    this.scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xfffbf2, 1.45);
    dirLight.position.set(24, 42, 26);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 140;
    const d = 42;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xd4e9e2, 0.55);
    fillLight.position.set(-28, 22, -20);
    this.scene.add(fillLight);

    // Base Architectural Ground Slab
    const baseSlabGeo = new THREE.PlaneGeometry(240, 240);
    const baseSlabMat = new THREE.MeshStandardMaterial({
      color: 0x1c2d27,
      roughness: 0.9,
      metalness: 0.08,
    });
    const baseSlab = new THREE.Mesh(baseSlabGeo, baseSlabMat);
    baseSlab.rotation.x = -Math.PI / 2;
    baseSlab.position.y = -0.02;
    baseSlab.receiveShadow = true;
    this.scene.add(baseSlab);

    const worldGrid = new THREE.GridHelper(140, 140, 0x2c4c41, 0x213830);
    worldGrid.position.y = -0.01;
    this.scene.add(worldGrid);
  }

  initSharedMaterials() {
    // Procedural 60x60cm Raised Floor Tile Canvas Texture
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = 128;
    tileCanvas.height = 128;
    const tCtx = tileCanvas.getContext("2d");
    tCtx.fillStyle = "#e6e3dc";
    tCtx.fillRect(0, 0, 128, 128);
    tCtx.strokeStyle = "#b8b2a6";
    tCtx.lineWidth = 4;
    tCtx.strokeRect(0, 0, 128, 128);
    tCtx.fillStyle = "#948e82";
    tCtx.fillRect(8, 8, 4, 4);
    tCtx.fillRect(116, 8, 4, 4);
    tCtx.fillRect(8, 116, 4, 4);
    tCtx.fillRect(116, 116, 4, 4);

    this.raisedFloorTex = new THREE.CanvasTexture(tileCanvas);
    this.raisedFloorTex.wrapS = THREE.RepeatWrapping;
    this.raisedFloorTex.wrapT = THREE.RepeatWrapping;

    // Procedural Wiremesh Server Cage Texture
    const cageCanvas = document.createElement("canvas");
    cageCanvas.width = 64;
    cageCanvas.height = 64;
    const cCtx = cageCanvas.getContext("2d");
    cCtx.clearRect(0, 0, 64, 64);
    cCtx.strokeStyle = "#cba258";
    cCtx.lineWidth = 3;
    cCtx.beginPath();
    cCtx.moveTo(0, 0);
    cCtx.lineTo(64, 64);
    cCtx.moveTo(64, 0);
    cCtx.lineTo(0, 64);
    cCtx.stroke();
    cCtx.strokeRect(0, 0, 64, 64);

    this.cageTex = new THREE.CanvasTexture(cageCanvas);
    this.cageTex.wrapS = THREE.RepeatWrapping;
    this.cageTex.wrapT = THREE.RepeatWrapping;
  }

  bindEvents() {
    this.store.addEventListener("geometryChanged", (event) => {
      // Stage 1-3 edits never touch 3D in the v4 workspace; Build 3D does.
      if (this.usesBuiltProject() && this.store.ui.step < 4) return;
      this.sceneSync.markDirty(event.detail?.revision ?? this.store.revision);
    });
    this.store.addEventListener("selectionChanged", () => {
      this.updateSelectionHighlight();
    });

    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.selectableMeshes, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.sitestryKind) {
          obj = obj.parent;
        }
        if (obj && obj.userData?.sitestryKind) {
          this.store.selectObject(obj.userData.sitestryKind, obj.userData.sitestryId);
        }
      }
    });
  }

  /**
   * In the v4 workspace the structure (walls, rooms, openings, columns, stairs) comes from the
   * snapshot taken by Build 3D; otherwise it is the live project. Equipment and cable trays are
   * always live. `null` means nothing has been built yet.
   */
  usesBuiltProject() {
    return document.body.dataset.ui === "v4" && document.body.dataset.workspace === "on";
  }

  structureProject() {
    return this.usesBuiltProject() ? this.store.builtProject : this.store.project;
  }

  metaProject() {
    return this.structureProject() || this.store.project;
  }

  // Convert 2D Blueprint Pixel (x_px, y_px) -> Centered 3D Meter Coordinates (X, Z)
  pxToMeter3D(x_px, y_px) {
    const meta = this.metaProject().metadata;
    const scale = meta.scale_px_per_meter || 30.68;
    const roi = meta.roi_px || { x: 0, y: 0, width: meta.image_width_px, height: meta.image_height_px };
    const centerPxX = roi.x + roi.width / 2;
    const centerPxY = roi.y + roi.height / 2;

    return {
      x: (x_px - centerPxX) / scale,
      z: (y_px - centerPxY) / scale,
    };
  }

  setCameraPreset(preset) {
    if (preset === "top") {
      this.camera.position.set(0, 44, 0.01);
      this.controls.target.set(0, 0, 0);
    } else if (preset === "walk") {
      this.camera.position.set(0, 1.75, 9);
      this.controls.target.set(0, 1.65, -5);
    } else {
      this.camera.position.set(0, 26, 30);
      this.controls.target.set(0, 0, 0);
    }
    this.controls.update();
  }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w > 10 && h > 10) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }

  // ==================== FULL 3D PROCEDURAL REBUILD ====================
  rebuildScene() {
    // Explicit view/layer/stage rebuilds must reflect visibility changes even
    // when the geometry revision is unchanged.
    this.sceneSync.lastBuiltRevision = -1;
    this.sceneSync.markDirty(this.store.revision);
    return this.sceneSync.ensureCurrent();
  }

  ensureSceneCurrent() {
    return this.sceneSync.ensureCurrent();
  }

  disposeGeneratedObjects() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this.rootGroup.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : object.material
        ? [object.material]
        : [];
      for (const material of objectMaterials) {
        for (const key of ["map", "alphaMap", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap"]) {
          const texture = material[key];
          if (texture && texture !== this.raisedFloorTex && texture !== this.cageTex) {
            textures.add(texture);
          }
        }
        materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    while (this.rootGroup.children.length > 0) {
      this.rootGroup.remove(this.rootGroup.children[0]);
    }
  }

  _rebuildScene() {
    this.disposeGeneratedObjects();
    this.builtRevision = this.store.revision;
    this.rootGroup.userData = { sitestryRevision: this.store.revision };
    this.selectableMeshes = [];
    this.labelAnchors = [];

    const layers = this.store.ui.layers;
    const sel = this.store.ui.selected;
    const scale = this.metaProject().metadata.scale_px_per_meter || 30.68;

    const hasStructure = Boolean(this.structureProject());

    // 0. Automatic thin base floor under every closed room (zones sit on top of it)
    if (hasStructure && layers.baseFloor) {
      this.buildBaseFloor3D();
    }

    // 1. Build Room Zones & 60x60cm Raised Floor Plenums
    if (hasStructure && layers.rooms) {
      this.buildRooms3D(scale, sel);
    }

    // 2. Build Topological Walls + CSG Door & Window Cutouts
    if (hasStructure && layers.walls) {
      this.buildWallsAndOpenings3D(scale, sel);
    }

    // 3. Build Steel H-Beam & Concrete Structural Columns
    if (hasStructure && layers.columns) {
      this.buildColumns3D(scale, sel);
    }

    // 4. Build Stage 5 Telco CME / MEP Equipments
    if (layers.equipments) {
      this.buildEquipments3D(scale, sel);
    }

    // 5. Build 3D Overhead/Underfloor Cable Trays, Cooling Pipes & Stepped Staircases
    if (layers.trays) {
      this.buildCableTrays3D(scale, sel);
      if (hasStructure) this.buildStairs3D(scale, sel);
    }
    if (layers.pipes !== false) {
      this.buildPipes3D(scale, sel);
    }
    if (layers.cables !== false) {
      this.buildCables3D(sel);
    }

    this.update3DLabelsOverlay();
    this.updateSelectionHighlight();
    this.sceneSync.lastBuiltRevision = this.store.revision;
  }

  updateSelectionHighlight() {
    const sel = this.store.ui.selected;
    for (const root of this.selectableMeshes) {
      const isSelected =
        Boolean(sel) &&
        root.userData?.sitestryKind === sel.kind &&
        root.userData?.sitestryId === sel.id;
      root.traverse?.((child) => {
        const objectMaterials = Array.isArray(child.material)
          ? child.material
          : child.material
          ? [child.material]
          : [];
        for (const material of objectMaterials) {
          if (material?.emissive) {
            material.emissive.setHex(isSelected ? 0x0b3d2c : 0x000000);
            material.emissiveIntensity = isSelected ? 0.55 : 0;
          }
        }
      });
    }
  }

  /**
   * One slab (0.02 m thick) per closed room found from the walls, so corridors and unnamed rooms
   * are not left as holes. Zones extrude at least 0.06 m, so their tops never share a plane with it.
   */
  buildBaseFloor3D() {
    const faces = buildRoomFaces(this.structureProject());
    if (!faces.length) return;
    const group = new THREE.Group();
    group.name = "BaseFloor";
    const material = new THREE.MeshStandardMaterial({ color: 0x8d9792, roughness: 0.9, metalness: 0.05 });
    for (const face of faces) {
      const pts3D = face.polygon.map(([px, py]) => this.pxToMeter3D(px, py));
      const shape = new THREE.Shape();
      shape.moveTo(pts3D[0].x, -pts3D[0].z);
      for (let i = 1; i < pts3D.length; i++) shape.lineTo(pts3D[i].x, -pts3D[i].z);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      mesh.userData = { role: "base_floor" };
      group.add(mesh);
    }
    this.rootGroup.add(group);
  }

  buildRooms3D(scale, sel) {
    for (const room of this.structureProject().rooms) {
      if (!room.polygon_px || room.polygon_px.length < 3) continue;
      const pts3D = room.polygon_px.map(([px, py]) => this.pxToMeter3D(px, py));

      const shape = new THREE.Shape();
      shape.moveTo(pts3D[0].x, -pts3D[0].z);
      for (let i = 1; i < pts3D.length; i++) {
        shape.lineTo(pts3D[i].x, -pts3D[i].z);
      }
      shape.closePath();

      const elev = Math.max(0.06, Number(room.elevation_m) || 0.25);
      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        depth: elev,
        bevelEnabled: false,
      });
      extrudeGeo.rotateX(-Math.PI / 2);

      const isSelected = sel?.kind === "room" && sel?.id === room.id;
      const isRaised = room.floor_type === "raised_floor_60cm";
      const floorXray = isRaised && Boolean(this.store.ui.transparentFloor);

      let mat;
      if (isRaised && this.store.ui.layers.grid) {
        const clonedTex = this.raisedFloorTex.clone();
        clonedTex.needsUpdate = true;
        clonedTex.repeat.set(1 / 0.6, 1 / 0.6);
        mat = new THREE.MeshStandardMaterial({
          map: clonedTex,
          color: isSelected ? 0xd4e9e2 : 0xf2f0eb,
          roughness: 0.65,
          metalness: 0.1,
          transparent: floorXray,
          opacity: floorXray ? 0.25 : 1.0,
          depthWrite: !floorXray,
        });
      } else {
        mat = new THREE.MeshStandardMaterial({
          color: isSelected ? 0x00754a : 0xd8d4cc,
          roughness: 0.8,
          metalness: 0.08,
          transparent: floorXray,
          opacity: floorXray ? 0.25 : 1.0,
          depthWrite: !floorXray,
        });
      }

      const mesh = new THREE.Mesh(extrudeGeo, mat);
      mesh.receiveShadow = true;
      mesh.userData = { sitestryKind: "room", sitestryId: room.id };
      this.rootGroup.add(mesh);
      this.selectableMeshes.push(mesh);

      let cx = 0;
      let cz = 0;
      pts3D.forEach((p) => {
        cx += p.x;
        cz += p.z;
      });
      cx /= pts3D.length;
      cz /= pts3D.length;

      this.labelAnchors.push({
        text: room.name,
        elevText: isRaised ? `+${elev.toFixed(2)}m` : "",
        pos: new THREE.Vector3(cx, elev + 0.45, cz),
      });
    }
  }

  buildWallsAndOpenings3D(scale, sel) {
    const xray = this.store.ui.xrayWalls;

    for (const wall of this.structureProject().walls) {
      const n1 = this.store.getNodeById(wall.start_node);
      const n2 = this.store.getNodeById(wall.end_node);
      if (!n1 || !n2) continue;

      const p1 = this.pxToMeter3D(n1.x_px, n1.y_px);
      const p2 = this.pxToMeter3D(n2.x_px, n2.y_px);

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const lenM = Math.hypot(dx, dz);
      if (lenM < 0.05) continue;

      const heightM = Number(wall.height_m) || 3.8;
      const thickM = Number(wall.thickness_m) || 0.2;
      const angle = Math.atan2(dz, dx);
      const midX = (p1.x + p2.x) / 2;
      const midZ = (p1.z + p2.z) / 2;

      const isSelected = sel?.kind === "wall" && sel?.id === wall.id;

      let wallMat;
      if (wall.type === "cage_mesh") {
        const cageTexClone = this.cageTex.clone();
        cageTexClone.needsUpdate = true;
        cageTexClone.repeat.set(Math.max(1, lenM * 2), Math.max(1, heightM * 2));
        wallMat = new THREE.MeshStandardMaterial({
          map: cageTexClone,
          color: isSelected ? 0xfbbf24 : 0xcba258,
          transparent: true,
          alphaTest: 0.15,
          opacity: xray ? 0.35 : 0.92,
          side: THREE.DoubleSide,
          roughness: 0.4,
          metalness: 0.6,
        });
      } else if (wall.type === "glass") {
        wallMat = new THREE.MeshPhysicalMaterial({
          color: isSelected ? 0x38bdf8 : 0xbae6fd,
          transparent: true,
          opacity: xray ? 0.2 : 0.42,
          roughness: 0.1,
          transmission: 0.6,
        });
      } else {
        // Warm Architectural Concrete / Limestone Wall
        wallMat = new THREE.MeshStandardMaterial({
          color: isSelected ? 0x00754a : 0xedeae2,
          roughness: 0.72,
          metalness: 0.08,
          transparent: xray,
          opacity: xray ? 0.32 : 1.0,
        });
      }

      const wallOpenings = this.structureProject().openings.filter((o) => o.wall_id === wall.id);
      let finalWallMesh;

      if (wallOpenings.length > 0 && wall.type === "solid") {
        try {
          let baseBrush = new Brush(new THREE.BoxGeometry(lenM, heightM, thickM), wallMat);
          baseBrush.position.set(midX, heightM / 2, midZ);
          baseBrush.rotation.y = -angle;
          baseBrush.updateMatrixWorld();

          for (const op of wallOpenings) {
            const ratio = Math.max(0.08, Math.min(0.92, Number(op.offset_ratio) || 0.5));
            const opW = Math.min(lenM * 0.88, Number(op.width_m) || 1.2);
            const isWin = op.type === "window";
            const opH = Math.min(heightM - 0.25, Number(op.height_m) || (isWin ? 1.25 : 2.15));
            const elevM = isWin ? Number(op.elevation_m) || 0.95 : 0.0;

            const ox = p1.x + dx * ratio;
            const oz = p1.z + dz * ratio;

            const cutterBrush = new Brush(new THREE.BoxGeometry(opW, opH + 0.04, thickM * 2.6));
            cutterBrush.position.set(ox, elevM + opH / 2, oz);
            cutterBrush.rotation.y = -angle;
            cutterBrush.updateMatrixWorld();

            baseBrush = this.csgEvaluator.evaluate(baseBrush, cutterBrush, SUBTRACTION);
          }
          finalWallMesh = baseBrush;
          finalWallMesh.material = wallMat;
        } catch (err) {
          const fallbackGeo = new THREE.BoxGeometry(lenM, heightM, thickM);
          finalWallMesh = new THREE.Mesh(fallbackGeo, wallMat);
          finalWallMesh.position.set(midX, heightM / 2, midZ);
          finalWallMesh.rotation.y = -angle;
        }
      } else {
        const boxGeo = new THREE.BoxGeometry(lenM, heightM, thickM);
        finalWallMesh = new THREE.Mesh(boxGeo, wallMat);
        finalWallMesh.position.set(midX, heightM / 2, midZ);
        finalWallMesh.rotation.y = -angle;
      }

      finalWallMesh.castShadow = true;
      finalWallMesh.receiveShadow = true;
      finalWallMesh.userData = { sitestryKind: "wall", sitestryId: wall.id };
      this.rootGroup.add(finalWallMesh);
      this.selectableMeshes.push(finalWallMesh);

      // Build 3D Door Frames, Swinging Door Leaves, or Mullioned Window Frames
      for (const op of wallOpenings) {
        this.buildOpening3D(op, p1, dx, dz, angle, thickM, sel);
      }
    }
  }

  buildOpening3D(op, p1, dx, dz, angle, wallThickM, sel) {
    const ratio = Number(op.offset_ratio) || 0.5;
    const ox = p1.x + dx * ratio;
    const oz = p1.z + dz * ratio;
    const opW = Number(op.width_m) || 1.2;
    const isWindow = op.type === "window";
    const opH = Number(op.height_m) || (isWindow ? 1.25 : 2.15);
    const elevM = isWindow ? Number(op.elevation_m) || 0.95 : 0.0;
    const isSelected = sel?.kind === "opening" && sel?.id === op.id;

    const group = new THREE.Group();
    group.position.set(ox, elevM, oz);
    group.rotation.y = -angle;
    group.userData = { sitestryKind: "opening", sitestryId: op.id };

    if (op.type === "ramp") {
      const rampGeo = new THREE.BoxGeometry(opW, 0.12, 1.3);
      const rampMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : 0x64748b,
        metalness: 0.4,
        roughness: 0.6,
      });
      const rampMesh = new THREE.Mesh(rampGeo, rampMat);
      rampMesh.position.set(0, 0.18, 0.55);
      rampMesh.rotation.x = 0.24;
      group.add(rampMesh);
    } else if (isWindow) {
      // 3D Architectural Window Frame + Mullion + Translucent Glazing
      const frameMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : 0x1e3932,
        roughness: 0.4,
        metalness: 0.5,
      });
      const fThick = 0.05;
      const fDepth = wallThickM + 0.04;

      // Top, Bottom, Left, Right frame bars + Center Mullion
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(opW, fThick, fDepth), frameMat);
      topBar.position.set(0, opH - fThick / 2, 0);
      const botBar = new THREE.Mesh(new THREE.BoxGeometry(opW, fThick + 0.02, fDepth + 0.04), frameMat);
      botBar.position.set(0, fThick / 2, 0);
      const leftBar = new THREE.Mesh(new THREE.BoxGeometry(fThick, opH, fDepth), frameMat);
      leftBar.position.set(-opW / 2 + fThick / 2, opH / 2, 0);
      const rightBar = new THREE.Mesh(new THREE.BoxGeometry(fThick, opH, fDepth), frameMat);
      rightBar.position.set(opW / 2 - fThick / 2, opH / 2, 0);
      const centerMullion = new THREE.Mesh(new THREE.BoxGeometry(fThick * 0.85, opH, fDepth * 0.9), frameMat);
      centerMullion.position.set(0, opH / 2, 0);

      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.38,
        roughness: 0.1,
        metalness: 0.1,
      });
      const glassPane = new THREE.Mesh(new THREE.BoxGeometry(opW - fThick * 2, opH - fThick * 2, 0.02), glassMat);
      glassPane.position.set(0, opH / 2, 0);

      group.add(topBar, botBar, leftBar, rightBar, centerMullion, glassPane);
    } else {
      // Single or Double Door: Frame + Semi-Open Door Leaf(s)
      const frameMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : 0x1e3932,
        roughness: 0.45,
        metalness: 0.4,
      });
      const leafMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0xcba258 : 0x8c6239,
        roughness: 0.55,
        metalness: 0.15,
      });

      const postGeo = new THREE.BoxGeometry(0.06, opH, wallThickM + 0.05);
      const leftPost = new THREE.Mesh(postGeo, frameMat);
      leftPost.position.set(-opW / 2, opH / 2, 0);
      const rightPost = new THREE.Mesh(postGeo, frameMat);
      rightPost.position.set(opW / 2, opH / 2, 0);
      const header = new THREE.Mesh(new THREE.BoxGeometry(opW + 0.08, 0.06, wallThickM + 0.05), frameMat);
      header.position.set(0, opH, 0);
      group.add(leftPost, rightPost, header);

      const swingSign = (op.swing_dir || "in-left").startsWith("out") ? -1 : 1;

      if (op.type === "double_door") {
        const leafW = opW * 0.48;
        const leafGeo = new THREE.BoxGeometry(leafW, opH - 0.04, 0.045);
        leafGeo.translate(leafW / 2, 0, 0);

        const leftPivot = new THREE.Group();
        leftPivot.position.set(-opW / 2 + 0.03, opH / 2, 0);
        leftPivot.rotation.y = swingSign * 0.48;
        leftPivot.add(new THREE.Mesh(leafGeo, leafMat));

        const rightGeo = new THREE.BoxGeometry(leafW, opH - 0.04, 0.045);
        rightGeo.translate(-leafW / 2, 0, 0);
        const rightPivot = new THREE.Group();
        rightPivot.position.set(opW / 2 - 0.03, opH / 2, 0);
        rightPivot.rotation.y = -swingSign * 0.48;
        rightPivot.add(new THREE.Mesh(rightGeo, leafMat));

        group.add(leftPivot, rightPivot);
      } else {
        const leafW = opW - 0.06;
        const hingeRight = (op.swing_dir || "in-left").endsWith("right");
        const leafGeo = new THREE.BoxGeometry(leafW, opH - 0.04, 0.045);
        leafGeo.translate(hingeRight ? -leafW / 2 : leafW / 2, 0, 0);

        const pivot = new THREE.Group();
        pivot.position.set(hingeRight ? opW / 2 - 0.03 : -opW / 2 + 0.03, opH / 2, 0);
        pivot.rotation.y = (hingeRight ? -1 : 1) * swingSign * 0.52;
        pivot.add(new THREE.Mesh(leafGeo, leafMat));
        group.add(pivot);
      }
    }

    this.rootGroup.add(group);
    this.selectableMeshes.push(group);
  }

  buildColumns3D(scale, sel) {
    for (const col of this.structureProject().columns) {
      const pos = this.pxToMeter3D(col.x_px, col.y_px);
      const w = Number(col.width_m) || 0.55;
      const d = Number(col.depth_m) || 0.55;
      const h = Number(col.height_m) || 3.8;
      const isSelected = sel?.kind === "column" && sel?.id === col.id;

      const colGroup = new THREE.Group();
      colGroup.position.set(pos.x, 0, pos.z);
      colGroup.userData = { sitestryKind: "column", sitestryId: col.id };

      const mat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0xcba258 : 0x00754a,
        metalness: 0.55,
        roughness: 0.38,
      });

      if (col.type === "h_beam") {
        const flangeThick = Math.max(0.06, d * 0.18);
        const webThick = Math.max(0.06, w * 0.18);

        const f1 = new THREE.Mesh(new THREE.BoxGeometry(w, h, flangeThick), mat);
        f1.position.set(0, h / 2, -d / 2 + flangeThick / 2);

        const f2 = new THREE.Mesh(new THREE.BoxGeometry(w, h, flangeThick), mat);
        f2.position.set(0, h / 2, d / 2 - flangeThick / 2);

        const web = new THREE.Mesh(new THREE.BoxGeometry(webThick, h, d - flangeThick * 2), mat);
        web.position.set(0, h / 2, 0);

        colGroup.add(f1, f2, web);
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        box.position.y = h / 2;
        colGroup.add(box);
      }

      this.rootGroup.add(colGroup);
      this.selectableMeshes.push(colGroup);
    }
  }

  buildEquipments3D(scale, sel) {
    const palette = {
      rack: { body: 0x1e293b, accent: 0x00754a },
      ups: { body: 0x4c1d95, accent: 0xc084fc },
      battery: { body: 0x78350f, accent: 0xf59e0b },
      rectifier: { body: 0x0c4a6e, accent: 0x38bdf8 },
      panel: { body: 0x7f1d1d, accent: 0xef4444 },
      pac: { body: 0x064e3b, accent: 0x10b981 },
    };

    for (const eq of this.store.project.equipments) {
      const pos = this.pxToMeter3D(eq.x_px, eq.y_px);
      const w = Number(eq.width_m) || 1.2;
      const d = Number(eq.depth_m) || 0.9;
      const h = Number(eq.height_m) || 2.0;
      const elev = Number(eq.elevation_m) || 0.0;
      const isSelected = sel?.kind === "equipment" && sel?.id === eq.id;
      const preset = getEquipmentPreset(eq.subtype || eq.category);
      const colors = palette[eq.category] || { body: new THREE.Color(preset.color), accent: 0xf8fafc };

      const eqGroup = new THREE.Group();
      eqGroup.position.set(pos.x, elev, pos.z);
      eqGroup.rotation.y = -THREE.MathUtils.degToRad(eq.rotation_deg || 0);
      eqGroup.userData = { sitestryKind: "equipment", sitestryId: eq.id };

      const bodyMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : colors.body,
        roughness: 0.4,
        metalness: 0.65,
      });

      const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      bodyMesh.position.y = h / 2;
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      eqGroup.add(bodyMesh);

      const stripMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0xcba258 : colors.accent });
      const stripMesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.08, 0.02), stripMat);
      stripMesh.position.set(0, h * 0.82, d / 2 + 0.01);
      eqGroup.add(stripMesh);

      this.rootGroup.add(eqGroup);
      this.selectableMeshes.push(eqGroup);

      this.labelAnchors.push({
        text: eq.name,
        elevText: "",
        pos: new THREE.Vector3(pos.x, elev + h + 0.35, pos.z),
      });
    }
  }

  buildCableTrays3D(scale, sel) {
    const project = this.store.project;
    const fittings = deriveFittings(project, scale);
    const trayById = new Map(project.cable_trays.map((t) => [t.id, t]));
    const materialFor = (tray, isSelected) =>
      new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : new THREE.Color(tray.color || trayColorForService(tray.service)),
        metalness: 0.7,
        roughness: 0.3,
      });

    for (const tray of project.cable_trays) {
      const pts = trayPoints(project, tray);
      if (pts.length < 2) continue;

      const isSelected = sel?.kind === "tray" && sel?.id === tray.id;
      const elev = Number(tray.elevation_m) || 2.65;
      const widthM = Number(tray.width_m) || 0.45;
      const heightM = Number(tray.height_m) || 0.1;

      const trayGroup = new THREE.Group();
      trayGroup.userData = { sitestryKind: "tray", sitestryId: tray.id, trayType: tray.type };
      const railMat = materialFor(tray, isSelected);

      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = this.pxToMeter3D(pts[i][0], pts[i][1]);
        const p2 = this.pxToMeter3D(pts[i + 1][0], pts[i + 1][1]);
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const fullLen = Math.hypot(dx, dz);
        if (fullLen < 0.1) continue;

        // Stop the straight run at the fitting plate instead of overlapping it.
        const startCut = fittingCutM(fittings.get(tray.node_ids[i]) || { kind: "end", arms: [] });
        const endCut = fittingCutM(fittings.get(tray.node_ids[i + 1]) || { kind: "end", arms: [] });
        const segLen = fullLen - startCut - endCut;
        if (segLen < 0.05) continue;

        const angle = Math.atan2(dz, dx);
        const midAlong = startCut + segLen / 2;
        const mx = p1.x + (dx / fullLen) * midAlong;
        const mz = p1.z + (dz / fullLen) * midAlong;

        const segGroup = buildTrayProfile(tray.type, segLen, widthM, heightM, railMat);
        segGroup.position.set(mx, elev, mz);
        segGroup.rotation.y = -angle;

        trayGroup.add(segGroup);
      }

      this.rootGroup.add(trayGroup);
      this.selectableMeshes.push(trayGroup);
    }

    for (const fitting of fittings.values()) {
      if (!FITTING_KINDS.has(fitting.kind)) continue;
      const first = trayById.get(fitting.arms[0].trayId);
      if (!first) continue;
      const isSelected =
        sel?.kind === "tray" && fitting.arms.some((a) => a.trayId === sel.id);
      const group = buildFitting(fitting, first.type, Number(first.height_m) || 0.1, materialFor(first, isSelected));
      const c = this.pxToMeter3D(fitting.x_px, fitting.y_px);
      group.position.set(c.x, Number(first.elevation_m) || 2.65, c.z);
      group.userData = {
        ...group.userData,
        sitestryKind: "tray",
        sitestryId: first.id,
        trayType: first.type,
        fittingKind: fitting.kind,
      };
      this.rootGroup.add(group);
      this.selectableMeshes.push(group);
    }
  }

  buildPipes3D(scale, sel) {
    void scale;
    const project = this.store.project;
    const nodeDegree = new Map();
    for (const pipe of project.pipe_runs || []) {
      const ids = pipe.node_ids || [];
      for (let i = 0; i < ids.length; i++) {
        const inc = (i > 0 ? 1 : 0) + (i < ids.length - 1 ? 1 : 0);
        nodeDegree.set(ids[i], (nodeDegree.get(ids[i]) || 0) + inc);
      }
    }

    for (const pipe of project.pipe_runs || []) {
      const pts = pipePoints(project, pipe);
      if (pts.length < 2) continue;
      const isSelected = sel?.kind === "pipe" && sel?.id === pipe.id;
      const elev = Number(pipe.elevation_m ?? 0.15);
      const radius = Math.max(0.03, (Number(pipe.diameter_m) || 0.1) / 2);
      const innerR = radius * 0.72;
      const outerMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : new THREE.Color(pipe.color || PIPE_DEFAULT_COLOR),
        metalness: 0.55,
        roughness: 0.35,
      });
      const boreMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.2,
        roughness: 0.85,
        side: THREE.BackSide,
      });
      const flangeMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0xcba258 : 0x334155,
        metalness: 0.65,
        roughness: 0.35,
      });

      // Hollow annular extrusion shape so pipe ends visibly show wall thickness and open bore
      const wallShape = new THREE.Shape();
      wallShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
      const holePath = new THREE.Path();
      holePath.absarc(0, 0, innerR, 0, Math.PI * 2, true);
      wallShape.holes.push(holePath);

      const pipeGroup = new THREE.Group();
      pipeGroup.userData = { sitestryKind: "pipe", sitestryId: pipe.id, mounting: pipe.mounting };

      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = this.pxToMeter3D(pts[i][0], pts[i][1]);
        const p2 = this.pxToMeter3D(pts[i + 1][0], pts[i + 1][1]);
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;

        const segGroup = new THREE.Group();
        segGroup.position.set(p1.x, elev, p1.z);
        segGroup.rotation.y = -Math.atan2(dz, dx) + Math.PI / 2;

        const shellGeo = new THREE.ExtrudeGeometry(wallShape, {
          depth: len,
          bevelEnabled: false,
          curveSegments: 16,
        });
        const shellMesh = new THREE.Mesh(shellGeo, outerMat);
        segGroup.add(shellMesh);

        // Dark interior liner so the open pipe bore is deeply legible
        const boreGeo = new THREE.CylinderGeometry(innerR, innerR, len, 16, 1, true);
        boreGeo.rotateX(Math.PI / 2);
        boreGeo.translate(0, 0, len / 2);
        const boreMesh = new THREE.Mesh(boreGeo, boreMat);
        segGroup.add(boreMesh);

        pipeGroup.add(segGroup);
      }

      const ids = pipe.node_ids || [];
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = pts[i];
        const p = this.pxToMeter3D(px, py);
        const deg = nodeDegree.get(ids[i]) || 1;
        if (deg <= 1) {
          // Open terminal flange rim (keeps bore open & hollow at pipe ends)
          const nextPt = pts[i === 0 ? 1 : pts.length - 2];
          const np = nextPt ? this.pxToMeter3D(nextPt[0], nextPt[1]) : p;
          const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.96, radius * 0.18, 8, 18), flangeMat);
          rim.position.set(p.x, elev, p.z);
          rim.rotation.y = -Math.atan2(np.z - p.z, np.x - p.x) + Math.PI / 2;
          pipeGroup.add(rim);
        } else {
          // Compact elbow/tee coupling sleeve
          const hub = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.18, 12, 12), flangeMat);
          hub.position.set(p.x, elev, p.z);
          pipeGroup.add(hub);
        }
      }

      this.rootGroup.add(pipeGroup);
      this.selectableMeshes.push(pipeGroup);
    }
  }

  buildTrayWaterfallChute3D(isSelected) {
    const chuteGroup = new THREE.Group();
    const chuteMat = new THREE.MeshStandardMaterial({
      color: isSelected ? 0x00754a : 0xf59e0b,
      roughness: 0.4,
      metalness: 0.35,
      side: THREE.DoubleSide,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      roughness: 0.45,
      metalness: 0.4,
    });

    // Quarter-round drop-out lip along +Z then curving down -Y
    const arcShape = new THREE.Shape();
    arcShape.moveTo(0, 0);
    arcShape.quadraticCurveTo(0.1, 0, 0.11, -0.1);
    arcShape.lineTo(0.095, -0.1);
    arcShape.quadraticCurveTo(0.085, -0.015, 0, -0.015);
    arcShape.closePath();

    const width = 0.14;
    const rampGeo = new THREE.ExtrudeGeometry(arcShape, { depth: width, bevelEnabled: false, curveSegments: 10 });
    rampGeo.translate(0, 0, -width / 2);
    // Rotate so ramp flows along +Z outward from tray center
    rampGeo.rotateY(-Math.PI / 2);
    chuteGroup.add(new THREE.Mesh(rampGeo, chuteMat));

    // Side guide ribs
    for (const sx of [-width / 2 - 0.004, width / 2 + 0.004]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.1), railMat);
      rib.position.set(sx, 0.01, 0.05);
      chuteGroup.add(rib);
    }
    return chuteGroup;
  }

  buildCables3D(sel) {
    const project = this.store.project;
    for (const cab of project.cables || []) {
      const route = resolveCableRoute(project, cab);
      if (route.points3d.length < 2) continue;

      const isSelected = sel?.kind === "cable" && sel?.id === cab.id;
      const color = isSelected ? 0x00754a : new THREE.Color(cableColorFor(cab));
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.25,
      });

      const cableGroup = new THREE.Group();
      cableGroup.userData = { sitestryKind: "cable", sitestryId: cab.id, system: cab.system };

      const vectors = [];
      for (const p of route.points3d) {
        const m = this.pxToMeter3D(p.x_px, p.y_px);
        const v = new THREE.Vector3(m.x, p.y_m, m.z);
        if (!vectors.length || vectors[vectors.length - 1].distanceTo(v) > 0.02) {
          vectors.push(v);
        }
      }
      if (vectors.length < 2) continue;

      const curve = new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.12);
      const radius = cab.system === "power" ? 0.022 : cab.system === "cooling" ? 0.02 : 0.015;
      const tubularSegments = Math.max(16, vectors.length * 8);
      const tubeMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false), mat);
      cableGroup.add(tubeMesh);

      // Waterfall drop-outs: Tray Waterfall Chute (default) or compact Direct Drop grommet collar
      for (const wf of route.waterfalls) {
        const wm = this.pxToMeter3D(wf.x_px, wf.y_px);
        if (wf.style === "tray_waterfall") {
          const chute = this.buildTrayWaterfallChute3D(isSelected);
          chute.position.set(wm.x, wf.z_top_m + 0.015, wm.z);
          chute.rotation.y = Math.atan2(wf.out_x || 0, wf.out_y ?? 1);
          cableGroup.add(chute);
        } else {
          const collar = new THREE.Mesh(
            new THREE.TorusGeometry(radius * 2.2, radius * 0.65, 8, 16),
            new THREE.MeshStandardMaterial({ color: 0xcba258, metalness: 0.7, roughness: 0.3 })
          );
          collar.rotation.x = Math.PI / 2;
          collar.position.set(wm.x, wf.z_top_m, wm.z);
          cableGroup.add(collar);
        }
      }

      this.rootGroup.add(cableGroup);
      this.selectableMeshes.push(cableGroup);
    }
  }

  buildParametricStair3D(st, scale, sel) {
    const geometry = resolveStairGeometry(st, scale);
    if (!geometry.ok) return;
    const isSelected = sel?.kind === "stair" && sel?.id === st.id;
    const group = new THREE.Group();
    group.name = `Stair_${st.id}`;
    group.userData = {
      sitestryKind: "stair",
      sitestryId: st.id,
      role: "staircase",
      template_version: 1,
      shape: st.shape,
      flights: geometry.flights.length,
      landings: geometry.landings.length,
      steps: st.steps,
    };

    const treadMat = new THREE.MeshStandardMaterial({
      color: isSelected ? 0x00754a : 0xd6d1c4,
      roughness: 0.65,
      metalness: 0.15,
    });
    const landingMat = new THREE.MeshStandardMaterial({
      color: isSelected ? 0x00754a : 0xc9c3b5,
      roughness: 0.6,
      metalness: 0.12,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xcba258,
      roughness: 0.35,
      metalness: 0.65,
    });

    const riserHeight = Number(st.height_m) / Number(st.steps);
    const shapeFromPolygon = (polygon) => {
      const points3D = polygon.map((point) => this.pxToMeter3D(point.x_px, point.y_px));
      const shape = new THREE.Shape();
      shape.moveTo(points3D[0].x, -points3D[0].z);
      for (let i = 1; i < points3D.length; i += 1) {
        shape.lineTo(points3D[i].x, -points3D[i].z);
      }
      shape.closePath();
      return shape;
    };

    for (const flight of geometry.flights) {
      for (const tread of flight.treads) {
        const extrude = new THREE.ExtrudeGeometry(shapeFromPolygon(tread.footprint_px), {
          depth: riserHeight,
          bevelEnabled: false,
        });
        extrude.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(extrude, treadMat);
        mesh.position.y = Math.max(0, tread.elevation_m - riserHeight);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `Stair_${st.id}_F${flight.index}_Tread_${tread.index}`;
        mesh.userData = {
          sitestryKind: "stair",
          sitestryId: st.id,
          role: "tread",
          flight_index: flight.index,
          tread_index: tread.index,
          elevation_m: tread.elevation_m,
        };
        group.add(mesh);
      }
    }

    for (const landing of geometry.landings) {
      const thickness = Math.min(0.2, Math.max(0.08, riserHeight));
      const extrude = new THREE.ExtrudeGeometry(shapeFromPolygon(landing.footprint_px), {
        depth: thickness,
        bevelEnabled: false,
      });
      extrude.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(extrude, landingMat);
      mesh.position.y = Math.max(0, landing.elevation_m - thickness);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Stair_${st.id}_Landing_${landing.index}`;
      mesh.userData = {
        sitestryKind: "stair",
        sitestryId: st.id,
        role: "landing",
        landing_index: landing.index,
        elevation_m: landing.elevation_m,
      };
      group.add(mesh);
    }

    for (const edge of geometry.guardrail_edges) {
      const a = this.pxToMeter3D(edge.start_px.x_px, edge.start_px.y_px);
      const b = this.pxToMeter3D(edge.end_px.x_px, edge.end_px.y_px);
      const startY = (edge.start_elevation_m ?? 0) + 0.9;
      const endY = (edge.end_elevation_m ?? 0) + 0.9;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(a.x, startY, a.z),
        new THREE.Vector3(b.x, endY, b.z),
      ]);
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.03, 6, false), railMat);
      rail.castShadow = true;
      rail.name = `Stair_${st.id}_Guardrail`;
      rail.userData = { sitestryKind: "stair", sitestryId: st.id, role: "guardrail" };
      group.add(rail);
    }

    this.rootGroup.add(group);
    this.selectableMeshes.push(group);
  }

  buildStairs3D(scale, sel) {
    for (const st of this.structureProject().stairs) {
      if (st.template_version !== undefined) {
        this.buildParametricStair3D(st, scale, sel);
        continue;
      }
      const pos = this.pxToMeter3D(st.x_px, st.y_px);
      const w = Number(st.width_m) || 2.4;
      const d = Number(st.depth_m) || 3.2;
      const h = Number(st.height_m) || 3.6;
      const steps = Math.max(6, Number(st.steps) || 12);
      const isSelected = sel?.kind === "stair" && sel?.id === st.id;

      const stGroup = new THREE.Group();
      stGroup.position.set(pos.x, 0, pos.z);
      if (st.direction === "east" || st.direction === "west") {
        stGroup.rotation.y = Math.PI / 2;
      }
      stGroup.userData = { sitestryKind: "stair", sitestryId: st.id };

      const mat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x00754a : 0xd6d1c4,
        roughness: 0.65,
        metalness: 0.15,
      });
      const railMat = new THREE.MeshStandardMaterial({
        color: 0xcba258,
        roughness: 0.35,
        metalness: 0.65,
      });

      const runSpan = st.direction === "east" || st.direction === "west" ? w : d;
      const treadW = st.direction === "east" || st.direction === "west" ? d : w;
      const stepD = runSpan / steps;
      const stepH = h / steps;

      for (let i = 0; i < steps; i++) {
        const curH = stepH * (i + 1);
        const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(treadW, curH, stepD * 0.96), mat);
        stepMesh.position.set(0, curH / 2, -runSpan / 2 + stepD * (i + 0.5));
        stepMesh.castShadow = true;
        stepMesh.receiveShadow = true;
        stGroup.add(stepMesh);
      }

      // Dual Safety Handrails
      const diagLen = Math.hypot(runSpan, h);
      const pitch = Math.atan2(h, runSpan);
      const handrailGeo = new THREE.BoxGeometry(0.05, 0.05, diagLen);
      const hrLeft = new THREE.Mesh(handrailGeo, railMat);
      hrLeft.position.set(-treadW / 2 + 0.05, h / 2 + 0.85, 0);
      hrLeft.rotation.x = pitch;
      const hrRight = new THREE.Mesh(handrailGeo, railMat);
      hrRight.position.set(treadW / 2 - 0.05, h / 2 + 0.85, 0);
      hrRight.rotation.x = pitch;
      stGroup.add(hrLeft, hrRight);

      this.rootGroup.add(stGroup);
      this.selectableMeshes.push(stGroup);
    }
  }

  // ==================== FLOATING 3D HTML LABELS OVERLAY ====================
  update3DLabelsOverlay() {
    if (!this.labelsOverlay) return;
    this.labelsOverlay.innerHTML = "";
    if (!this.store.ui.show3DLabels) return;

    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 20 || h < 20) return;

    for (const item of this.labelAnchors) {
      const proj = item.pos.clone().project(this.camera);
      if (proj.z > 1) continue;

      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-(proj.y * 0.5) + 0.5) * h;
      if (x < 10 || x > w - 10 || y < 10 || y > h - 10) continue;

      const div = document.createElement("div");
      div.className = "label-3d-tag";
      div.style.left = `${x}px`;
      div.style.top = `${y}px`;
      div.innerHTML = `${item.text}${
        item.elevText ? `<span class="elev-pill">${item.elevText}</span>` : ""
      }`;
      this.labelsOverlay.appendChild(div);
    }
  }

  // ==================== BINARY .GLB 3D EXPORT ====================
  exportGLB(filename = "sitestry_digital_twin.glb", options = {}) {
    if (this.store.activeTransaction) {
      const message = "Selesaikan atau batalkan edit yang aktif sebelum mengekspor.";
      this.store.emit("toast", { message });
      return Promise.resolve(null);
    }
    this.ensureSceneCurrent();
    const exporter = new GLTFExporter();
    const download = options.download !== false;
    return new Promise((resolve, reject) => {
      exporter.parse(
        this.rootGroup,
        (result) => {
          if (download) {
            const blob = new Blob([result], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
          }
          resolve(result);
        },
        (err) => {
          console.error("[Viewer3DEngine] GLB Export Error:", err);
          reject(err);
        },
        { binary: true }
      );
    });
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.store.ui.show3DLabels && this.labelAnchors.length > 0) {
      this.update3DLabelsOverlay();
    }
  }
}
