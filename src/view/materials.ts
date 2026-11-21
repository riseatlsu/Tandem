import * as THREE from 'three';

/** Tandem's glossy "Aero" plastic. */
export function glossy(color: string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.18, ...opts });
}
