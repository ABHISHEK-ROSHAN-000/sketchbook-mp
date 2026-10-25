import * as THREE from 'three';
import * as CANNON from 'cannon';
import { createNoise2D } from 'simplex-noise';
import seedrandom from 'seedrandom';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { TrimeshCollider } from '../physics/colliders/TrimeshCollider';

interface ChunkData {
	mesh: THREE.Mesh;
	physBody: CANNON.Body;
	props: THREE.Object3D[];
	propBodies: CANNON.Body[];
}

export class SeededWorldGenerator implements IUpdatable
{
	public updateOrder: number = 5;

	private world: World;
	private noise2D: (x: number, y: number) => number;
	private seed: string;

	// Chunk settings
	private chunkSize: number = 60;
	private chunkResolution: number = 20;
	private renderDistance: number = 2;
	private chunks: Map<string, ChunkData> = new Map();

	private terrainMaterial: THREE.MeshLambertMaterial;
	private lastPlayerChunkX: number = NaN;
	private lastPlayerChunkZ: number = NaN;

	constructor(world: World)
	{
		this.world = world;

		const params = new URLSearchParams(window.location.search);
		this.seed = params.get('seed') || 'sketchbook-world';

		const rng = seedrandom(this.seed);
		this.noise2D = createNoise2D(rng);

		this.terrainMaterial = new THREE.MeshLambertMaterial({
			vertexColors: THREE.VertexColors,
			flatShading: true
		});

		if (this.world.sky?.csm)
		{
			this.world.sky.csm.setupMaterial(this.terrainMaterial);
		}

		this.updateChunksAround(0, 0);
		this.world.registerUpdatable(this);
	}

	public getHeightAt(x: number, z: number): number
	{
		const distFromCenter = Math.sqrt(x * x + z * z);
		if (distFromCenter < 85) return -0.5;
		const spawnFlattenFactor = Math.min(1, (distFromCenter - 85) / 35);

		const baseHills = this.noise2D(x * 0.006, z * 0.006) * 22;
		const mediumDetails = this.noise2D(x * 0.02, z * 0.02) * 4.5;
		const fineRoughness = this.noise2D(x * 0.06, z * 0.06) * 0.8;

		return -0.5 + (baseHills + mediumDetails + fineRoughness + 0.5) * spawnFlattenFactor;
	}

	public update(timeStep: number, unscaledTimeStep: number): void
	{
		const camPos = this.world.camera.position;
		const currentChunkX = Math.floor((camPos.x + this.chunkSize / 2) / this.chunkSize);
		const currentChunkZ = Math.floor((camPos.z + this.chunkSize / 2) / this.chunkSize);

		if (currentChunkX !== this.lastPlayerChunkX || currentChunkZ !== this.lastPlayerChunkZ)
		{
			this.lastPlayerChunkX = currentChunkX;
			this.lastPlayerChunkZ = currentChunkZ;
			this.updateChunksAround(currentChunkX, currentChunkZ);
		}
	}

	private updateChunksAround(centerX: number, centerZ: number): void
	{
		const activeKeys = new Set<string>();

		for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++)
		{
			for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++)
			{
				const cx = centerX + dx;
				const cz = centerZ + dz;
				const key = `${cx},${cz}`;
				activeKeys.add(key);

				if (!this.chunks.has(key))
				{
					this.generateChunk(cx, cz, key);
				}
			}
		}

		this.chunks.forEach((chunk, key) =>
		{
			if (!activeKeys.has(key))
			{
				this.world.graphicsWorld.remove(chunk.mesh);
				chunk.mesh.geometry.dispose();
				this.world.physicsWorld.remove(chunk.physBody);

				chunk.props.forEach((p) => this.world.graphicsWorld.remove(p));
				chunk.propBodies.forEach((b) => this.world.physicsWorld.remove(b));
				this.chunks.delete(key);
			}
		});
	}

	private generateChunk(cx: number, cz: number, key: string): void
	{
		const geom = new THREE.PlaneGeometry(
			this.chunkSize,
			this.chunkSize,
			this.chunkResolution,
			this.chunkResolution
		);
		geom.rotateX(-Math.PI / 2);

		const worldOffsetX = cx * this.chunkSize;
		const worldOffsetZ = cz * this.chunkSize;

		// Displace vertices using seeded noise
		for (let i = 0; i < geom.vertices.length; i++)
		{
			const v = geom.vertices[i];
			const wx = v.x + worldOffsetX;
			const wz = v.z + worldOffsetZ;
			v.y = this.getHeightAt(wx, wz);
		}

		const grassColor = new THREE.Color(0x74b859);
		const lushGrass = new THREE.Color(0x63a649);
		const rockColor = new THREE.Color(0x8c9398);
		const sandColor = new THREE.Color(0xe6d296);
		const snowColor = new THREE.Color(0xf5f7fa);

		for (let i = 0; i < geom.faces.length; i++)
		{
			const face = geom.faces[i];
			const va = geom.vertices[face.a];
			const vb = geom.vertices[face.b];
			const vc = geom.vertices[face.c];
			const avgY = (va.y + vb.y + vc.y) / 3;
			const maxDiff = Math.max(Math.abs(va.y - vb.y), Math.abs(vb.y - vc.y));

			if (maxDiff > 1.6)
			{
				face.color.copy(rockColor);
			}
			else if (avgY < -3.5)
			{
				face.color.copy(sandColor);
			}
			else if (avgY > 9.5)
			{
				face.color.copy(snowColor);
			}
			else
			{
				face.color.copy((i % 2 === 0) ? grassColor : lushGrass);
			}
		}

		geom.computeVertexNormals();
		geom.computeFaceNormals();

		const mesh = new THREE.Mesh(geom, this.terrainMaterial);
		mesh.position.set(worldOffsetX, 0, worldOffsetZ);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		this.world.graphicsWorld.add(mesh);

		const trimeshCollider = new TrimeshCollider(mesh, {});
		this.world.physicsWorld.addBody(trimeshCollider.body);

		const { props, propBodies } = this.populateChunkProps(cx, cz, worldOffsetX, worldOffsetZ);

		this.chunks.set(key, {
			mesh,
			physBody: trimeshCollider.body,
			props,
			propBodies
		});
	}

	private populateChunkProps(cx: number, cz: number, offsetX: number, offsetZ: number)
	{
		const props: THREE.Object3D[] = [];
		const propBodies: CANNON.Body[] = [];

		const rng = seedrandom(`${this.seed}_chunk_${cx}_${cz}`);

		const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230, flatShading: true });
		const leavesMat = new THREE.MeshLambertMaterial({ color: 0x4d9440, flatShading: true });
		if (this.world.sky?.csm)
		{
			this.world.sky.csm.setupMaterial(trunkMat);
			this.world.sky.csm.setupMaterial(leavesMat);
		}

		const treeCount = Math.floor(rng() * 8) + 2;
		for (let i = 0; i < treeCount; i++)
		{
			const wx = offsetX + (rng() - 0.5) * (this.chunkSize - 8);
			const wz = offsetZ + (rng() - 0.5) * (this.chunkSize - 8);

			if (Math.sqrt(wx * wx + wz * wz) < 90) continue;

			const wy = this.getHeightAt(wx, wz);
			if (wy < -2 || wy > 9) continue;

			const treeGroup = new THREE.Group();
			treeGroup.position.set(wx, wy, wz);

			const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6), trunkMat);
			trunk.position.y = 1.2;
			trunk.castShadow = true;
			trunk.receiveShadow = true;

			const crown = new THREE.Mesh(new THREE.ConeGeometry(2.0, 4.5, 6), leavesMat);
			crown.position.y = 3.8;
			crown.castShadow = true;
			crown.receiveShadow = true;

			treeGroup.add(trunk, crown);
			this.world.graphicsWorld.add(treeGroup);
			props.push(treeGroup);

			const body = new CANNON.Body({ mass: 0 });
			body.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 2.0, 0.4)), new CANNON.Vec3(0, 2.0, 0));
			body.position.set(wx, wy, wz);
			this.world.physicsWorld.addBody(body);
			propBodies.push(body);
		}

		return { props, propBodies };
	}
}
