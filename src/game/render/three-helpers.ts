import * as THREE from 'three';
import { ROOM, UNITS_PER_METRE } from '../config.ts';

/**
 * Small helpers shared by every model builder: primitive shapes, a material
 * cache, and the mapping from room units onto the 3D ground plane.
 *
 * Room coordinates are 2D (x across, y "down" the floor plan) because that is
 * what walking and collision use. Here, room y becomes world **z**, and world
 * **y** is height off the floor.
 */

/** One room unit in world units. */
export const U = 1 / UNITS_PER_METRE;

/** Room x -> world x, centred on the room. */
export const kx = (x: number): number => (x - ROOM.width / 2) * U;
/** Room y -> world z, centred on the room. */
export const kz = (y: number): number => (y - ROOM.depth / 2) * U;
/** A room length -> a world length. */
export const ku = (value: number): number => value * U;

const materialCache = new Map<string, THREE.MeshLambertMaterial>();

export interface MaterialOptions {
  opacity?: number;
  emissive?: number;
  emissiveIntensity?: number;
  /** Render both faces; needed for flat single-sided pieces like capes. */
  doubleSided?: boolean;
}

/**
 * A cached Lambert material. Lambert is cheap, takes shadows, and gives the
 * flat cartoon look we want. Call `.clone()` if you need to animate one.
 */
export function mat(color: number, options: MaterialOptions = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${options.opacity ?? 1}|${options.emissive ?? -1}|${
    options.emissiveIntensity ?? 1
  }|${options.doubleSided ? 'd' : 's'}`;

  const cached = materialCache.get(key);
  if (cached) return cached;

  const material = new THREE.MeshLambertMaterial({
    color,
    transparent: (options.opacity ?? 1) < 1,
    opacity: options.opacity ?? 1,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (options.emissive !== undefined) {
    material.emissive = new THREE.Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }

  materialCache.set(key, material);
  return material;
}

/* --------------------------------------------------------------- shapes */

export function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  options?: MaterialOptions,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat(color, options));
}

export function ball(radius: number, color: number, options?: MaterialOptions): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14), mat(color, options));
}

/** Half a sphere, flat side down. Used for caps, beanies and mushroom tops. */
export function dome(radius: number, color: number, options?: MaterialOptions): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(color, options),
  );
}

export function cyl(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  color: number,
  options?: MaterialOptions,
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20),
    mat(color, options),
  );
}

export function cone(
  radius: number,
  height: number,
  color: number,
  options?: MaterialOptions,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(radius, height, 18), mat(color, options));
}

/** A triangular prism — a 3-sided cylinder. Perfect for a wedge of cheese. */
export function wedge(
  radius: number,
  depth: number,
  color: number,
  options?: MaterialOptions,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, depth, 3),
    mat(color, options),
  );
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

export function torus(
  radius: number,
  tube: number,
  color: number,
  options?: MaterialOptions,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 24), mat(color, options));
}

/* ---------------------------------------------------------------- utils */

/** Position a mesh in one call. */
export function at<T extends THREE.Object3D>(object: T, x: number, y: number, z: number): T {
  object.position.set(x, y, z);
  return object;
}

/** Turn shadows on for a whole subtree. */
export function castShadows(root: THREE.Object3D, cast = true, receive = false): void {
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

/** Free every geometry and unique material under a subtree. */
export function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    // Cached materials are shared, so only dispose ones that were cloned.
    const material = mesh.material as THREE.Material & { userData: { cloned?: boolean } };
    if (material?.userData?.cloned) material.dispose();
  });
}

/** Clone a cached material so it can be animated without affecting others. */
export function cloneMaterial(material: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  const copy = material.clone();
  copy.userData.cloned = true;
  return copy;
}
