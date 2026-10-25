import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
export declare class SeededWorldGenerator implements IUpdatable {
    updateOrder: number;
    private world;
    private noise2D;
    private seed;
    private chunkSize;
    private chunkResolution;
    private renderDistance;
    private chunks;
    private terrainMaterial;
    private lastPlayerChunkX;
    private lastPlayerChunkZ;
    constructor(world: World);
    getHeightAt(x: number, z: number): number;
    update(timeStep: number, unscaledTimeStep: number): void;
    private updateChunksAround;
    private generateChunk;
    private populateChunkProps;
}
