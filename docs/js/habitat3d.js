// habitat3d.js
// Modelo 3D del habitat, hecho con piezas de Three.js (sin archivos externos, funciona sin internet).
// Escala real en metros: el conjunto mide unos 34 x 26 m. Lo usan la Mesa 3D (agrandado para que
// se vea desde lejos) y el casco (tamano real: el astronauta sale por la esclusa).
// Ejes: +x = este, +y = arriba, -z = norte. La esclusa mira hacia +z (local); se gira con rotation.y.

import * as THREE from "three";

const blanco = () => new THREE.MeshStandardMaterial({ color: "#e9e6e1", roughness: 0.55, metalness: 0.1 });
const gris = () => new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.6, metalness: 0.4 });
const oscuro = () => new THREE.MeshStandardMaterial({ color: "#2b2f36", roughness: 0.8, metalness: 0.2 });
const naranja = () => new THREE.MeshStandardMaterial({ color: "#f26b3a", roughness: 0.5, metalness: 0.1 });

function malla(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function crearHabitat() {
  const g = new THREE.Group();
  g.name = "habitat";

  // --- Plataforma (suelo compactado) ---
  const piso = malla(new THREE.CylinderGeometry(17, 17.5, 0.3, 48), new THREE.MeshStandardMaterial({ color: "#8a5a3c", roughness: 1 }), 0, 0.15, 0);
  g.add(piso);
  const aro = malla(new THREE.TorusGeometry(16.6, 0.15, 6, 64), naranja(), 0, 0.32, 0);
  aro.rotation.x = Math.PI / 2;
  g.add(aro);

  // --- Domo principal: cilindro de 2.6 m + media esfera de 6 m de radio, con costillas ---
  const base = malla(new THREE.CylinderGeometry(6, 6.2, 2.6, 40), blanco(), 0, 1.6, 0);
  g.add(base);
  const domo = malla(new THREE.SphereGeometry(6, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), blanco(), 0, 2.9, 0);
  g.add(domo);
  const costilla = gris();
  for (let k = 0; k < 8; k++) {
    const c = malla(new THREE.TorusGeometry(6.05, 0.08, 6, 32, Math.PI), costilla, 0, 2.9, 0);
    c.rotation.y = (k / 8) * Math.PI;
    g.add(c);
  }
  // franja de ventanas
  const ventanas = malla(new THREE.CylinderGeometry(6.22, 6.22, 0.5, 40, 1, true), new THREE.MeshStandardMaterial({
    color: "#1c3f55", emissive: "#4fd1e8", emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.6, side: THREE.DoubleSide,
  }), 0, 2.2, 0);
  g.add(ventanas);

  // --- Esclusa (hacia +z): cilindro horizontal con puerta naranja ---
  const esclusa = malla(new THREE.CylinderGeometry(1.4, 1.4, 4, 24), blanco(), 0, 1.7, 7.6);
  esclusa.rotation.x = Math.PI / 2;
  g.add(esclusa);
  g.add(malla(new THREE.CylinderGeometry(1.1, 1.1, 0.2, 24), naranja(), 0, 1.7, 9.7).rotateX(Math.PI / 2));
  g.add(malla(new THREE.BoxGeometry(2.2, 0.15, 2.4), gris(), 0, 0.35, 10.6)); // escalon

  // --- Modulo laboratorio (hacia el este) unido con un tunel ---
  const tunel = malla(new THREE.CylinderGeometry(0.9, 0.9, 4, 16), gris(), 8, 1.6, 0);
  tunel.rotation.z = Math.PI / 2;
  g.add(tunel);
  const lab = malla(new THREE.CapsuleGeometry(2.4, 7, 8, 24), blanco(), 14, 2.6, 0);
  lab.rotation.x = Math.PI / 2;
  g.add(lab);
  for (const z of [-3, 0, 3]) {
    g.add(malla(new THREE.TorusGeometry(2.45, 0.07, 6, 24), costilla, 14, 2.6, z));
  }
  g.add(malla(new THREE.BoxGeometry(0.6, 1.2, 9), oscuro(), 14, 0.6, 0)); // patas del lab

  // --- Paneles solares (al oeste): 2 filas de 3, inclinados hacia el sol ---
  const celda = new THREE.MeshStandardMaterial({ color: "#1d2c5a", roughness: 0.3, metalness: 0.7, emissive: "#0b1430", emissiveIntensity: 0.4 });
  for (let fila = 0; fila < 2; fila++) {
    for (let k = 0; k < 3; k++) {
      const x = -11 - fila * 4.2, z = -5 + k * 5;
      const poste = malla(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 6), gris(), x, 0.8, z);
      const panel = malla(new THREE.BoxGeometry(3.4, 0.08, 4.4), celda, x, 1.6, z);
      panel.rotation.z = 0.45;
      g.add(poste, panel);
    }
  }

  // --- Antena parabolica + mastil con baliza ---
  const mastil = malla(new THREE.CylinderGeometry(0.12, 0.16, 7, 8), gris(), -4, 3.8, -8);
  g.add(mastil);
  const plato = malla(new THREE.SphereGeometry(1.6, 24, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), blanco(), -4, 7.2, -8);
  plato.material.side = THREE.DoubleSide;
  plato.rotation.x = -0.9;
  g.add(plato);
  const luz = malla(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: "#ff5a5f" }), 0, 9.15, 0);
  g.add(malla(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), gris(), 0, 8.5, 0));
  g.add(luz);
  g.userData.baliza = luz;

  // --- Rover presurizado estacionado ---
  const rover = new THREE.Group();
  rover.add(malla(new THREE.BoxGeometry(3, 1.6, 5), blanco(), 0, 1.6, 0));
  rover.add(malla(new THREE.BoxGeometry(2.6, 0.7, 1.2), new THREE.MeshStandardMaterial({ color: "#1c3f55", emissive: "#4fd1e8", emissiveIntensity: 0.25 }), 0, 2.0, 2.2));
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    rover.add(malla(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 14), oscuro(), x, 0.6, z).rotateZ(Math.PI / 2));
  }
  rover.position.set(7, 0.3, 11);
  rover.rotation.y = -0.5;
  g.add(rover);

  return g;
}

// La baliza parpadea (llamar en cada cuadro)
export function animarHabitat(g, ahora = performance.now()) {
  if (!g || !g.userData.baliza) return;
  const on = (ahora % 1600) < 250;
  g.userData.baliza.material.color.set(on ? "#ff5a5f" : "#5a1c1e");
}
